import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from pydantic import ValidationError
from app.integrations.catalog_schema import SearchResponse, DetailResponse, normalize
from decimal import Decimal
from urllib.parse import quote

import httpx

from app.core.errors import DomainError
from app.storage.store import dump


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def product(id, sku, name, stock, price):
    return {'id': id, 'sku': sku, 'name': name, 'category': 'Автоматические выключатели',
            'attributes': {'rated_current': '16 A', 'poles': '1', 'curve': 'C'},
            'certificates': [], 'price': {'amount': price, 'currency': 'KZT'},
            'unit': 'шт', 'quantity_step': '1', 'minimum_quantity': '1',
            'stock': [{'warehouse_id': 'demo-almaty', 'available_quantity': stock}],
            'availability': 'in_stock' if Decimal(stock) > 0 else 'out_of_stock',
            'observed_at': now_iso(), 'source': 'synthetic', 'stale': False}


DEMO_PRODUCTS = [product('demo-1', 'DEMO-C16', 'Демонстрационный автомат C16', '20', '1500'),
                 product('demo-2', 'DEMO-C16-OLD', 'Демонстрационный автомат C16 старой серии', '0', '1400'),
                 product('demo-3', 'DEMO-C16-ALT', 'Демонстрационный аналог C16', '30', '1700')]


def quantity_valid(p, selection):
    try:
        amount = Decimal(selection['quantity'])
        step, minimum = Decimal(p['quantity_step']), Decimal(p['minimum_quantity'])
        return amount > 0 and step > 0 and amount >= minimum and amount % step == 0
    except (KeyError, TypeError, ArithmeticError):
        return False


class Catalog:
    def __init__(self, settings, store):
        self.settings, self.store = settings, store
        self.semaphore = asyncio.Semaphore(settings.catalog_concurrency)
        token = settings.catalog_service_token
        self.client = httpx.AsyncClient(base_url=settings.catalog_base_url.rstrip('/')+'/',
            timeout=settings.catalog_timeout_seconds, limits=httpx.Limits(max_connections=settings.catalog_concurrency),
            headers={'Authorization': 'Bearer '+token.get_secret_value()} if token else {})
        if settings.catalog_mode == 'demo':
            with store.transaction() as con:
                for p in DEMO_PRODUCTS:
                    con.execute('INSERT OR IGNORE INTO inventory VALUES(?,?)', (p['id'], dump(p)))

    async def close(self):
        await self.client.aclose()

    async def request(self, method, path, **kwargs):
        try:
            async with self.semaphore:
                response = await self.client.request(method, path, **kwargs)
            if response.status_code == 404:
                raise DomainError(404, 'product_not_found', 'Product not found')
            response.raise_for_status()
            return response.json()
        except httpx.TransportError as exc:
            if self.settings.catalog_mock_on_unavailable:
                return self.mock_response(path, kwargs.get('params', {}))
            raise DomainError(503, 'catalog_unavailable', 'Catalog connection unavailable', True) from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise DomainError(503, 'catalog_unavailable', 'Catalog unavailable; price and stock were not inferred', True) from exc

    def mock_response(self, path, params):
        data = json.loads(Path(__file__).with_name('fixtures').joinpath('catalog.json').read_text())
        data['metadata']['fallbackReason'] = 'catalog_connection_unavailable'
        if path == 'api/catalog/products':
            query = params.get('query', '').casefold()
            words = [w for w in query.split() if len(w) > 2]
            data['items'] = [p for p in data['items'] if not query or
                any(w in (p['sku']+' '+p['name']).casefold() for w in words) or query == p['id']]
            return data
        from urllib.parse import unquote
        id = unquote(path.rsplit('/', 1)[-1])
        for p in data['items']:
            if p['id'] == id:
                return {'product': p, 'metadata': data['metadata']}
        raise DomainError(404, 'product_not_found', 'Product not found in synthetic test fixtures')

    def demo_products(self, con=None):
        if con is None:
            with self.store.connect() as conn:
                return self.demo_products(conn)
        result = [json.loads(row['data']) for row in con.execute('SELECT data FROM inventory')]
        for p in result:
            p['observed_at'] = now_iso()
        return result

    async def search(self, query):
        if self.settings.catalog_mode == 'http':
            data = await self.request('GET', 'api/catalog/products', params={'query': query})
            try:
                response = SearchResponse.model_validate(data)
            except ValidationError as exc:
                raise DomainError(503, 'catalog_schema', 'Invalid catalog search response') from exc
            return [normalize(p, response.metadata) for p in response.items[:5]]
        words = query.lower().split()
        products = self.demo_products()
        exact = [p for p in products if p['sku'].lower() in query.lower() or p['id'] == query]
        if exact:
            # Longest SKU first avoids confusing DEMO-C16-OLD with DEMO-C16.
            return sorted(exact, key=lambda p: len(p['sku']), reverse=True)[:5]
        scored = [(sum(w in (p['sku']+' '+p['name']).lower() for w in words if len(w)>2), p) for p in products]
        return [p for score,p in sorted(scored, key=lambda pair: pair[0], reverse=True) if score][:5]

    async def detail(self, id):
        if self.settings.catalog_mode == 'http':
            data = await self.request('GET', 'api/catalog/products/'+quote(id, safe=''))
            try:
                response = DetailResponse.model_validate(data)
                if response.product.id != id:
                    raise ValueError('Mismatched product ID')
            except ValueError as exc:
                raise DomainError(503, 'catalog_schema', 'Invalid catalog detail response') from exc
            return normalize(response.product, response.metadata)
        for p in self.demo_products():
            if p['id'] == id:
                return p
        raise DomainError(404, 'product_not_found', 'Product not found')

    async def alternatives(self, id):
        if self.settings.catalog_mode == 'http':
            # No confirmed analog endpoint or compatibility data in this contract.
            return []
        return [{'product':p, 'reason':'Совпадают ток 16 A, характеристика C и число полюсов (синтетический пример).',
                 'matched_attributes':['rated_current','poles','curve'], 'differences':[], 'compatibility':'verified'}
                for p in self.demo_products() if p['id'] != id and p['availability']=='in_stock'][:3]

    async def availability(self, items):
        if self.settings.catalog_mode == 'http':
            raise DomainError(503, 'availability_unsupported', 'Catalog contract has no verified availability check')
        result=[]
        for selection in items:
            p = await self.detail(selection['product_id'])
            stock = next((s['available_quantity'] for s in p['stock'] if s['warehouse_id']==selection['warehouse_id']), None)
            valid = quantity_valid(p, selection)
            ok = valid and stock is not None and Decimal(stock) >= Decimal(selection['quantity'])
            result.append({**selection,'requested_quantity':selection['quantity'],'available_quantity':stock,
                'purchasable':ok,'reason':'available' if ok else ('invalid_quantity' if not valid else 'insufficient_stock'), 'observed_at':now_iso()})
        return {'items':result, 'reservation_created':False}
