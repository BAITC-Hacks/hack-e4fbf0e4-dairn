import json
from pathlib import Path

import httpx
import pytest

from app.core.config import Settings
from app.core.errors import DomainError
from app.integrations.catalog import Catalog
from app.integrations.catalog_schema import SearchResponse


FIXTURE = Path(__file__).parents[1] / 'app/integrations/fixtures/catalog.json'


def settings(**kwargs):
    return Settings(environment='test', catalog_mode='http', cart_mode='disabled', **kwargs)


async def catalog(handler, **kwargs):
    c = Catalog(settings(**kwargs), None)
    await c.client.aclose()
    c.client = httpx.AsyncClient(base_url='http://catalog/', transport=httpx.MockTransport(handler))
    return c


@pytest.mark.asyncio
async def test_wire_paths_envelopes_and_unknown_values():
    data = json.loads(FIXTURE.read_text())
    data['metadata']['source'] = 'EKT_PRODUCT_LIST'
    calls = []
    def handler(request):
        calls.append(request)
        if request.url.path == '/api/catalog/products':
            assert dict(request.url.params) == {'query': 'кабель'}
            return httpx.Response(200, json=data)
        assert request.url.path == '/api/catalog/products/1001'
        return httpx.Response(200, json={'product': data['items'][0], 'metadata': data['metadata']})
    c = await catalog(handler)
    try:
        results = await c.search('кабель')
        assert results[0]['availability'] == {'status': 'UNKNOWN', 'quantity': None}
        assert results[0]['price']['currency'] is None
        assert results[1]['price'] is None
        assert results[0]['stock'] == []
        assert results[0]['catalog_metadata'] == data['metadata']
        assert results[0]['observed_at'] is None and results[0]['stale']
        assert (await c.detail('1001'))['id'] == '1001'
        assert await c.alternatives('1001') == []
        with pytest.raises(DomainError, match='no verified availability'):
            await c.availability([])
        assert len(calls) == 2
    finally:
        await c.close()


@pytest.mark.asyncio
async def test_opt_in_offline_fixtures_and_detail():
    def offline(request):
        raise httpx.ConnectError('offline', request=request)
    c = await catalog(offline, catalog_mock_on_unavailable=True)
    try:
        products = await c.search('кабель')
        assert len(products) == 5
        assert all(p['source'] == 'synthetic' for p in products)
        assert products[0]['catalog_metadata']['fallbackReason'] == 'catalog_connection_unavailable'
        assert (await c.detail('45357'))['sku'] == 'ярп4520'
        assert await c.search('несуществующийартикул') == []
        with pytest.raises(DomainError) as error:
            await c.detail('missing')
        assert error.value.status == 404
    finally:
        await c.close()
    c = await catalog(offline)
    try:
        with pytest.raises(DomainError) as error:
            await c.search('кабель')
        assert error.value.code == 'catalog_unavailable'
    finally:
        await c.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('status,payload,code', [(401, {}, 'catalog_unavailable'), (500, {}, 'catalog_unavailable'), (404, {}, 'product_not_found'), (200, {'items': []}, 'catalog_schema')])
async def test_errors_never_silently_switch_to_mock(status, payload, code):
    c = await catalog(lambda request: httpx.Response(status, json=payload), catalog_mock_on_unavailable=True)
    try:
        with pytest.raises(DomainError) as error:
            await c.search('кабель')
        assert error.value.code == code
    finally:
        await c.close()


def test_fixture_contract_and_production_guard():
    assert len(SearchResponse.model_validate_json(FIXTURE.read_text()).items) == 12
    with pytest.raises(ValueError, match='development/test only'):
        Settings(environment='production', allow_demo_sessions=False, bootstrap_token='test', catalog_mock_on_unavailable=True)


@pytest.mark.asyncio
async def test_offline_chat_labels_unknown_currency_stock_and_provenance(tmp_path):
    from app.main import create_app
    from app.worker import process_one
    app = create_app(settings(data_dir=tmp_path, message_wait_seconds=0, catalog_mock_on_unavailable=True))
    async with app.router.lifespan_context(app):
        rt = app.state.runtime
        await rt.catalog.client.aclose()
        def offline(request):
            raise httpx.ConnectError('offline', request=request)
        rt.catalog.client = httpx.AsyncClient(base_url='http://catalog/', transport=httpx.MockTransport(offline))
        async with httpx.AsyncClient(base_url='http://test', transport=httpx.ASGITransport(app=app)) as client:
            s = (await client.post('/v1/sessions', json={})).json()
            headers = {'Authorization': 'Bearer '+s['session_token']}
            response = await client.post('/v1/sessions/'+s['session_id']+'/messages', headers=headers,
                json={'client_message_id': 'offline', 'text': 'CABLE-001'})
            assert await process_one(rt)
            result = (await client.get(response.json()['status_url'], headers=headers)).json()
            assert result['status'] == 'completed'
            assert 'валюта неизвестна' in result['answer']
            assert 'Остаток: неизвестен' in result['answer']
            assert 'Демонстрационные данные' in result['answer']
            assert 'None' not in result['answer']
            assert result['sources'][0]['metadata']['source'] == 'SYNTHETIC_TEST_FIXTURE'
            assert any('синтетические' in w for w in result['warnings'])
