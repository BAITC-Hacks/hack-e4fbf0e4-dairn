"""Regression checks against the live Catalog service's documented wire behavior."""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from app.core.config import Settings
from app.core.errors import DomainError
from app.integrations.catalog import Catalog, CatalogResults
from app.integrations.catalog_schema import Metadata, is_stale


FIXTURE = Path(__file__).parents[1] / 'app/integrations/fixtures/catalog.json'


def live_response():
    data = json.loads(FIXTURE.read_text())
    now = datetime.now(timezone.utc)
    data['metadata'].update(source='EKT_PRODUCT_LIST', mode='LIVE', freshness='RECENTLY_FETCHED',
        observedAt=now.isoformat(), loadedAt=now.isoformat(), expiresAt=(now + timedelta(minutes=1)).isoformat())
    return data


async def catalog(handler):
    client = Catalog(Settings(environment='test', catalog_mode='http', cart_mode='disabled'), None)
    await client.client.aclose()
    client.client = httpx.AsyncClient(base_url='http://catalog/', transport=httpx.MockTransport(handler))
    return client


@pytest.mark.asyncio
async def test_recent_live_search_and_detail_keep_unknown_sku_and_stable_simulation():
    data = live_response()
    data['items'][0]['sku'] = None

    def handler(request):
        if request.url.path == '/api/catalog/products':
            return httpx.Response(200, json=data)
        return httpx.Response(200, json={'product': data['items'][0], 'metadata': data['metadata']})

    client = await catalog(handler)
    try:
        products = await client.search('кабель')
        assert isinstance(products, list) and isinstance(products, CatalogResults)
        assert products.metadata == data['metadata']
        detail = await client.detail(data['items'][0]['id'])
        repeated = (await client.search('кабель'))[0]
        for product in (products[0], detail, repeated):
            assert product['sku'] is None
            assert not product['stale']
            assert product['price'] == {'amount': data['items'][0]['price']['amount'], 'currency': 'KZT'}
            assert product['availability']['status'] == 'IN_STOCK'
            assert isinstance(product['availability']['quantity'], int)
            assert 1 <= product['availability']['quantity'] <= 100
            assert product['availability']['simulated'] is True
            assert product['availability']['source'] == 'assistant_simulation'
            assert product['stock'] == []
            assert product['catalog_metadata']['coverage'] == 'PARTIAL'
        assert products[0]['availability'] == detail['availability'] == repeated['availability']
    finally:
        await client.close()
    # A fresh adapter must not invent a different stock figure for the same ID.
    restarted = await catalog(handler)
    try:
        assert (await restarted.detail(data['items'][0]['id']))['availability'] == detail['availability']
    finally:
        await restarted.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('quantity,status', [(0, 'OUT_OF_STOCK'), ('0', 'OUT_OF_STOCK'), (7, 'IN_STOCK'), ('12.50', 'LIMITED')])
async def test_catalog_quantity_and_status_are_preserved_without_simulation(quantity, status):
    data = live_response()
    supplied = data['items'][0]
    supplied['availability'] = {'status': status, 'quantity': quantity}
    supplied['price'] = {'amount': '0012.500', 'currency': None}
    client = await catalog(lambda _: httpx.Response(200, json={'product': supplied, 'metadata': data['metadata']}))
    try:
        product = await client.detail(supplied['id'])
        assert product['availability'] == {'status': status, 'quantity': quantity, 'simulated': False, 'source': 'catalog'}
        assert product['price'] == {'amount': '0012.500', 'currency': 'KZT'}
        assert product['stock'] == []
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('availability', [{'status': 'UNKNOWN'}, {'status': 'UNKNOWN', 'quantity': None}])
async def test_missing_or_null_quantity_gets_explicitly_simulated_stock(availability):
    data = live_response()
    supplied = data['items'][0]
    supplied['availability'] = availability
    client = await catalog(lambda _: httpx.Response(200, json={'product': supplied, 'metadata': data['metadata']}))
    try:
        product = await client.detail(supplied['id'])
        assert product['availability']['status'] == 'IN_STOCK'
        assert 1 <= product['availability']['quantity'] <= 100
        assert product['availability']['simulated'] is True
        assert product['availability']['source'] == 'assistant_simulation'
        assert product['stock'] == []
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_explicit_out_of_stock_without_quantity_is_not_made_purchasable():
    data = live_response()
    supplied = data['items'][0]
    supplied['availability'] = {'status': 'OUT_OF_STOCK', 'quantity': None}
    client = await catalog(lambda _: httpx.Response(200, json={'product': supplied, 'metadata': data['metadata']}))
    try:
        product = await client.detail(supplied['id'])
        assert product['availability'] == {'status': 'OUT_OF_STOCK', 'quantity': None, 'simulated': False, 'source': 'catalog'}
        assert product['stock'] == []
    finally:
        await client.close()


@pytest.mark.parametrize('freshness,expiry,expected', [
    ('RECENTLY_FETCHED', '2999-01-01T00:00:00Z', False),
    ('RECENTLY_FETCHED', '2000-01-01T00:00:00Z', True),
    ('RECENTLY_FETCHED', None, True),
    ('RECENTLY_FETCHED', 'invalid', True),
    ('RECENTLY_FETCHED', '2999-01-01T00:00:00', True),
    ('UNKNOWN', '2999-01-01T00:00:00Z', True),
])
def test_freshness_needs_known_unexpired_timestamp(freshness, expiry, expected):
    metadata = live_response()['metadata']
    metadata.update(freshness=freshness, expiresAt=expiry)
    assert is_stale(Metadata.model_validate(metadata)) is expected


@pytest.mark.asyncio
async def test_empty_search_keeps_metadata_isolated_across_concurrent_requests():
    async def handler(request):
        data = live_response()
        data['items'] = []
        data['metadata']['loadedProducts'] = 20 if request.url.params['query'] == 'first' else 30
        await asyncio.sleep(0)
        return httpx.Response(200, json=data)

    client = await catalog(handler)
    try:
        first, second = await asyncio.gather(client.search('first'), client.search('second'))
        assert first == second == []
        assert first.metadata['coverage'] == 'PARTIAL'
        assert first.metadata['loadedProducts'] == 20
        assert second.metadata['loadedProducts'] == 30
        second.metadata['loadedProducts'] = 40
        assert first.metadata['loadedProducts'] == 20
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_partial_sample_404_preserves_existence_uncertainty():
    client = await catalog(lambda _: httpx.Response(404, json={
        'error': {'code': 'PRODUCT_NOT_IN_LOADED_SAMPLE', 'message': 'Untrusted upstream text'}}))
    try:
        with pytest.raises(DomainError) as raised:
            await client.detail('not-loaded')
        assert raised.value.status == 404
        assert raised.value.code == 'product_not_in_loaded_sample'
        assert 'full catalog is unknown' in raised.value.message
        assert 'Untrusted' not in raised.value.message
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_queries_are_normalized_before_upstream_request():
    observed = []

    def handler(request):
        observed.append(request.url.params['query'])
        data = live_response()
        data['items'] = []
        return httpx.Response(200, json=data)

    client = await catalog(handler)
    try:
        await client.search('  Кабель\n\tВВГ\x00\x85  3×2.5  ')
        await client.search('я' * 301)
        await client.search('a' + '😀' * 200)
        assert observed == ['Кабель ВВГ 3×2.5', 'я' * 200, 'a' + '😀' * 99]
        assert all(len(value.encode('utf-16-le')) <= 400 for value in observed)
        with pytest.raises(DomainError) as raised:
            await client.search(' \n\x00\t ')
        assert raised.value.code == 'invalid_catalog_query'
        assert len(observed) == 3
    finally:
        await client.close()
