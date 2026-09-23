import asyncio
import logging
import re
import time

import httpx

from app.core.errors import DomainError
from app.domain.attachments.parser import redact

logger=logging.getLogger(__name__)


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
    if query and not policies: queries.insert(0,query[:300])
    unique=list(dict.fromkeys(queries))
    if len(unique)>20: warnings.append(f'Поиск ограничен первыми 20 из {len(unique)} запросов. Остальные позиции требуют отдельной проверки.')
    queries=unique[:20]
    products={}; unresolved=[]
    async def search(q):
        try: return q,await rt.catalog.search(q),None
        except DomainError as exc: return q,[],exc.code
    results=await asyncio.gather(*(search(q) for q in queries))
    for q,items,error in results:
        if error: warnings.append('Каталог временно недоступен; данные не выдумывались.')
        elif not items: unresolved.append(q)
        for p in items:
            if p.get('id'): products[p['id']]=p
    # A short contextual follow-up can reuse IDs, but re-fetch facts rather than old stock.
    if not products and not blocks and history and len(query)<120:
        ids=[p['id'] for p in history[-1].get('products',[])][:5]
        for id in ids:
            try: products[id]=await rt.catalog.detail(id)
            except DomainError: pass
    selected=list(products.values())[:10]
    if any(p.get('stale') for p in selected):
        warnings.append('Данные каталога устарели; цену и наличие необходимо обновить перед покупкой.')
    if len(products)>10: warnings.append('Показаны первые 10 товаров; уточните выбор для остальных.')
    alternatives=[]
    for p in selected[:3]:
        if p.get('availability')=='out_of_stock':
            try: alternatives.extend(await rt.catalog.alternatives(p['id']))
            except DomainError: warnings.append('Аналоги сейчас недоступны.')
    if unresolved and blocks: warnings.append(f'Не найдено запросов из документа: {len(unresolved)}. Проверьте распознанные артикулы.')
    sources=[{'kind':'catalog','reference':p['sku'],'observed_at':p.get('observed_at')} for p in selected]
    sources += [{'kind':'attachment','reference':a['attachment_id']} for a in attachments]
    sources += [{'kind':'purchase_policy','reference':p['source'],'version':p['version']} for p in policies]
    lines=[]
    if any(p.get('source')=='synthetic' for p in selected): lines.append('Демонстрационные данные, не реальные цены и остатки ekt.kz.')
    for p in selected:
        price=p.get('price'); price_text=f"{price['amount']} {price['currency']}" if price else 'цена неизвестна'
        stock=', '.join(f"{s['warehouse_id']}: {s.get('available_quantity') or 'неизвестно'} {p.get('unit','')}" for s in p.get('stock',[]))
        lines.append(f"{p['sku']} — {p['name']}. {price_text}. Остаток: {stock or 'неизвестен'}.")
        if p.get('attributes'): lines.append('; '.join(f'{k}: {v}' for k,v in p['attributes'].items()))
        if p.get('certificates'): lines.append('Сертификаты: '+', '.join(c['url'] for c in p['certificates']))
    for alt in alternatives: lines.append(f"Аналог: {alt['product']['sku']}. {alt['reason']}")
    if policies: lines.extend(p['text'] for p in policies)
    elif any(t in query.lower() for t in ('оплат','достав','парт','payment','delivery')):
        lines.append('Подтверждённые условия покупки пока не загружены; уточните их у менеджера.')
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
              'documents':document_context,'products':selected,'alternatives':alternatives,'policies':policies,'warnings':warnings}
    model_answer=None
    # Exact identifier questions use the factual fast path without a model round trip.
    exact_query = not blocks and any(query.casefold() in (p.get('sku','').casefold(),p.get('id','').casefold()) for p in selected)
    try:
        model_answer=None if exact_query else await rt.model.answer(evidence)
    except (httpx.HTTPError,ValueError,KeyError):
        warnings.append('Модель недоступна; показан ответ по данным каталога.')
    result={**message,'status':'completed','answer':redact(model_answer or '\n'.join(lines)),
            'products':selected,'alternatives':alternatives,'sources':sources,'warnings':list(dict.fromkeys(warnings)),
            'answer_mode':'model' if model_answer else 'grounded_template','error':None}
    logger.info('message_complete id=%s elapsed_ms=%d mode=%s',message['message_id'],int((time.monotonic()-started)*1000),result['answer_mode'])
    return result
