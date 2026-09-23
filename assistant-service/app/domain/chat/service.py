import asyncio
import logging
import re
import time

import httpx

from app.core.errors import DomainError
from app.domain.attachments.parser import redact

logger=logging.getLogger(__name__)


_SEARCH_STOPWORDS = set('расскажите расскажи покажи покажите найдите найди подберите подобрать пожалуйста товар товаре товары нужен нужна нужно мне для есть сколько стоит цена цене наличие наличии про этот этого какой какая какие характеристики купить артикул артикулу'.split())


def catalog_queries(text):
    """Turn chat wording into bounded literal searches; no extra model round trip."""
    clean = ' '.join(text.split())
    tokens = re.findall(r'[\w-]+', clean, flags=re.UNICODE)
    # Marked alphanumeric SKUs are stronger than generic question words or numbers.
    identifiers = [t for t in tokens if any(c.isalpha() for c in t) and any(c.isdigit() for c in t)]
    quoted = re.findall(r'["«]([^"»]+)["»]', clean)
    if quoted or identifiers:
        return list(dict.fromkeys(quoted+identifiers))[:4]
    words = [w for w in tokens if len(w)>2 and w.casefold() not in _SEARCH_STOPWORDS]
    if not words:
        return [clean] if clean else []
    phrase = ' '.join(words)
    # At most four queries; exact phrase first, then a few useful terms.
    return list(dict.fromkeys([phrase]+words))[:4]


async def answer_message(rt, message):
    started=time.monotonic(); sid=message['_session']
    attachments=[rt.store.get(a,'attachment',sid) for a in message['attachment_ids']]
    blocks=[{'attachment_id':a['attachment_id'],**b} for a in attachments for b in a.get('_blocks',[])]
    warnings=[w for a in attachments for w in a.get('warnings',[])]
    history=[m for m in rt.store.list(sid,'message',200) if m['created_at']<message['created_at'] and m['status']=='completed'][-6:]
    query=message['text'].strip()
    policies=await rt.knowledge.lookup(query,sid)
    queries=[]
    # Preserve every row for the model, and explicitly report catalog search limits.
    for b in blocks:
        matches=re.findall(r'\b[A-Za-zА-Яа-я0-9][A-Za-zА-Яа-я0-9_-]*\d[A-Za-zА-Яа-я0-9_-]*\b',b['text'])
        if matches: queries.extend(matches[:3])
        elif b['text'].strip(): queries.append(b['text'][:200])
    if query and not policies:
        queries[0:0] = catalog_queries(query) if rt.settings.catalog_mode == 'http' else [query[:300]]
    unique=list(dict.fromkeys(queries))
    if len(unique)>20: warnings.append(f'Поиск ограничен первыми 20 из {len(unique)} запросов. Остальные позиции требуют отдельной проверки.')
    queries=unique[:20]
    products={}; unresolved=[]; search_metadata=[]
    async def search(q):
        try: return q,await rt.catalog.search(q),None
        except DomainError as exc: return q,[],exc.code
    results=await asyncio.gather(*(search(q) for q in queries))
    for q,items,error in results:
        if getattr(items, 'metadata', None):
            search_metadata.append({'kind':'catalog_search','reference':q,'metadata':items.metadata})
        if error: warnings.append('Каталог временно недоступен; данные не выдумывались.')
        elif not items: unresolved.append(q)
        for p in items:
            if p.get('id'): products[p['id']]=p
    if not products and rt.settings.catalog_mode == 'http' and query.isascii() and query.isdecimal():
        # Product IDs can resolve directly even outside the cached search pages.
        try: products[query]=await rt.catalog.detail(query)
        except DomainError: pass
    # A short contextual follow-up can reuse IDs, but re-fetch facts rather than old stock.
    if not products and not blocks and history and len(query)<120:
        ids=[p['id'] for p in history[-1].get('products',[])][:5]
        for id in ids:
            try: products[id]=await rt.catalog.detail(id)
            except DomainError: pass
    selected=list(products.values())[:10]
    if rt.settings.catalog_mode == 'http':
        async def enrich(product):
            if product.get('catalog_metadata', {}).get('detailLevel') == 'PRODUCT_DETAIL':
                return product
            try:
                return await rt.catalog.detail(product['id'])
            except DomainError:
                warnings.append('Подробные данные товара временно недоступны.')
                return product
        # The HTTP client's semaphore also bounds upstream detail concurrency.
        selected = list(await asyncio.gather(*(enrich(p) for p in selected)))
    if any(p.get('stale') for p in selected):
        warnings.append('Данные каталога устарели; цену и наличие необходимо обновить перед покупкой.')
    if len(products)>10: warnings.append('Показаны первые 10 товаров; уточните выбор для остальных.')
    alternatives=[]
    for p in selected[:3]:
        if p.get('availability')=='out_of_stock':
            try: alternatives.extend(await rt.catalog.alternatives(p['id']))
            except DomainError: warnings.append('Аналоги сейчас недоступны.')
    if unresolved and blocks: warnings.append(f'Не найдено запросов из документа: {len(unresolved)}. Проверьте распознанные артикулы.')
    metadata_entries = [p.get('catalog_metadata') for p in selected]+[s['metadata'] for s in search_metadata]
    for metadata in metadata_entries:
        if metadata:
            if metadata.get('source') == 'SYNTHETIC_TEST_FIXTURE':
                warnings.append('Каталог недоступен; используются синтетические тестовые данные.')
            if metadata.get('freshness') not in ('FRESH', 'RECENTLY_FETCHED'):
                warnings.append('Актуальность цены и наличия не подтверждена.')
    sources=[{'kind':'catalog','reference':p.get('sku') or p['id'],'observed_at':p.get('observed_at'), 'metadata':p.get('catalog_metadata')} for p in selected]
    sources += search_metadata
    sources += [{'kind':'attachment','reference':a['attachment_id']} for a in attachments]
    sources += [{'kind':'purchase_policy','reference':p['source'],'version':p['version']} for p in policies]
    lines=[]
    if any(p.get('source')=='synthetic' for p in selected): lines.append('Демонстрационные данные, не реальные цены и остатки ekt.kz.')
    for p in selected:
        price=p.get('price'); price_text=f"{price['amount']} {price.get('currency') or '(валюта неизвестна)'}" if price else 'цена неизвестна'
        stock=', '.join(f"{s.get('warehouse_name') or s['warehouse_id']}: {s.get('available_quantity') if s.get('available_quantity') is not None else 'неизвестно'} {p.get('unit','')}" for s in p.get('stock',[]))
        availability = p.get('availability')
        if isinstance(availability, dict):
            quantity = availability.get('quantity')
            if quantity is not None:
                stock = str(quantity) + (' (демо)' if availability.get('simulated') else '')
            elif not stock and availability.get('status') in {'OUT_OF_STOCK', 'UNAVAILABLE'}:
                stock = 'нет в наличии'
        lines.append(f"{p.get('sku') or p['id']} — {p['name']}. {price_text}. Остаток: {stock or 'неизвестен'}.")
        if p.get('attributes'): lines.append('; '.join(f'{k}: {v}' for k,v in p['attributes'].items()))
        if p.get('certificates'): lines.append('Сертификаты: '+', '.join(c['url'] for c in p['certificates']))
    for alt in alternatives: lines.append(f"Аналог: {alt['product']['sku']}. {alt['reason']}")
    if policies: lines.extend(p['text'] for p in policies)
    elif any(t in query.lower() for t in ('оплат','достав','парт','payment','delivery')):
        lines.append('Подтверждённые условия покупки пока не загружены; уточните их у менеджера.')
    if not lines and search_metadata and any(s['metadata'].get('coverage') == 'PARTIAL' for s in search_metadata):
        lines.append('В загруженной части каталога товар не найден. Это не означает его отсутствия в полном каталоге; уточните артикул или обратитесь к менеджеру.')
    if not lines: lines.append('Уточните артикул, маркировку или характеристики товара. По имеющимся данным точный товар не определён.')
    if any(t in query.lower() for t in ('добав','корзин','add','cart')):
        lines.append('Корзина не изменена. Выберите точные товары и количество, затем подтвердите предложение кнопкой добавления.')
    document_context=[]; remaining=12000
    for block in blocks:
        if remaining<=0: break
        text=block['text'][:remaining]
        document_context.append({**block,'text':text}); remaining-=len(text)
    if sum(len(b['text']) for b in blocks)>12000:
        warnings.append('Контекст модели ограничен 12000 символами документов; для полного разбора разделите запрос.')
    evidence={'question':query[:8000],'history':[{'question':m['text'][:1200],'answer':(m['answer'] or '')[:2000]} for m in history],
              'documents':document_context,'catalog_searches':search_metadata,'products':selected,'alternatives':alternatives,'policies':policies,'warnings':warnings}
    model_answer=None
    # Exact identifier questions use the factual fast path without a model round trip.
    exact_query = not blocks and any(query.casefold() in ((p.get('sku') or '').casefold(),p.get('id','').casefold()) for p in selected)
    try:
        model_answer=None if exact_query else await rt.model.answer(evidence)
    except (httpx.HTTPError,ValueError,KeyError):
        warnings.append('Модель недоступна; показан ответ по данным каталога.')
    result={**message,'status':'completed','answer':redact(model_answer or '\n'.join(lines)),
            'products':selected,'alternatives':alternatives,'sources':sources,'warnings':list(dict.fromkeys(warnings)),
            'answer_mode':'model' if model_answer else 'grounded_template','error':None}
    logger.info('message_complete id=%s elapsed_ms=%d mode=%s',message['message_id'],int((time.monotonic()-started)*1000),result['answer_mode'])
    return result
