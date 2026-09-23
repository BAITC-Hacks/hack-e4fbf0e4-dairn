import json
from pathlib import Path

import httpx
import pytest

from app.core.config import Settings
from app.domain.chat.service import catalog_queries
from app.main import create_app
from app.worker import process_one


def test_bounded_literal_search_queries():
    assert catalog_queries('Расскажите о товаре ярп4520: цена и наличие?') == ['ярп4520']
    assert catalog_queries('Найдите кабель пожалуйста') == ['кабель']
    assert len(catalog_queries('Найдите лампы светильники светодиодные потолочные белые')) <= 4


@pytest.mark.asyncio
async def test_natural_message_retrieves_sku_and_empty_search_keeps_metadata(tmp_path):
    data=json.loads((Path(__file__).parents[1]/'app/integrations/fixtures/catalog.json').read_text())
    data['metadata']['source']='EKT_PRODUCT_LIST'
    calls=[]
    def handler(request):
        if request.url.path == '/api/catalog/products':
            q=request.url.params['query'];calls.append(('search',q))
            return httpx.Response(200,json={'items':[p for p in data['items'] if p['sku']==q], 'metadata':data['metadata']})
        product_id = request.url.path.rsplit('/', 1)[-1]
        calls.append(('detail', product_id))
        product = next(p for p in data['items'] if p['id'] == product_id)
        return httpx.Response(200,json={'product':product, 'metadata':data['metadata']})
    settings=Settings(environment='test',data_dir=tmp_path,catalog_mode='http',cart_mode='disabled',message_wait_seconds=0)
    app=create_app(settings)
    async with app.router.lifespan_context(app):
        rt=app.state.runtime
        await rt.catalog.client.aclose()
        rt.catalog.client=httpx.AsyncClient(base_url='http://catalog/',transport=httpx.MockTransport(handler))
        async with httpx.AsyncClient(base_url='http://test',transport=httpx.ASGITransport(app=app)) as client:
            for text,expected in [('Расскажите о товаре ярп4520: цена и наличие?', ['45357']),('несуществующийтовар',[])]:
                s=(await client.post('/v1/sessions',json={})).json();headers={'Authorization':'Bearer '+s['session_token']}
                msg=(await client.post('/v1/sessions/'+s['session_id']+'/messages',headers=headers,json={'client_message_id':'a','text':text})).json()
                assert await process_one(rt)
                done=(await client.get(msg['status_url'],headers=headers)).json()
                assert done['status']=='completed'
                assert [p['id'] for p in done['products']]==expected
                assert any(source['metadata']['coverage']=='PARTIAL' for source in done['sources'])
                assert 'Доступна только часть каталога; отсутствие результата не означает отсутствие товара.' not in done['warnings']
                assert 'Доступны данные списка; наличие и валюта цены не подтверждены.' not in done['warnings']
                assert any('Актуальность цены и наличия' in w for w in done['warnings'])
                if expected:
                    product = done['products'][0]
                    assert product['price'] == {'amount': '1810', 'currency': 'KZT'}
                    assert product['availability']['simulated'] is True
                    assert f"{product['availability']['quantity']} (демо)" in done['answer']
                if not expected:
                    assert 'полном каталоге' in done['answer']
    assert calls==[('search','ярп4520'),('detail','45357'),('search','несуществующийтовар')]


@pytest.mark.asyncio
@pytest.mark.parametrize('quantity,status', [(0, 'OUT_OF_STOCK'), (7, 'IN_STOCK')])
async def test_chat_uses_real_detail_stock_instead_of_simulated_search_stock(tmp_path, quantity, status):
    data=json.loads((Path(__file__).parents[1]/'app/integrations/fixtures/catalog.json').read_text())
    data['metadata']['source']='EKT_PRODUCT_LIST'
    summary=data['items'][0]
    detail={**summary, 'availability':{'status':status, 'quantity':quantity},
            'attributes':{'rated_voltage':'220 V'}}
    def handler(request):
        if request.url.path == '/api/catalog/products':
            return httpx.Response(200,json={'items':[summary], 'metadata':data['metadata']})
        assert request.url.path == '/api/catalog/products/'+summary['id']
        return httpx.Response(200,json={'product':detail, 'metadata':data['metadata']})
    settings=Settings(environment='test',data_dir=tmp_path,catalog_mode='http',cart_mode='disabled',message_wait_seconds=0)
    app=create_app(settings)
    async with app.router.lifespan_context(app):
        rt=app.state.runtime
        await rt.catalog.client.aclose()
        rt.catalog.client=httpx.AsyncClient(base_url='http://catalog/',transport=httpx.MockTransport(handler))
        async with httpx.AsyncClient(base_url='http://test',transport=httpx.ASGITransport(app=app)) as client:
            session=(await client.post('/v1/sessions',json={})).json()
            headers={'Authorization':'Bearer '+session['session_token']}
            response=await client.post('/v1/sessions/'+session['session_id']+'/messages',headers=headers,
                json={'client_message_id':'real-stock','text':summary['sku']})
            assert await process_one(rt)
            done=(await client.get(response.json()['status_url'],headers=headers)).json()
            assert done['status']=='completed'
            assert done['products'][0]['availability']=={'status':status,'quantity':quantity,'simulated':False,'source':'catalog'}
            assert done['products'][0]['attributes']==detail['attributes']
            assert f'Остаток: {quantity}.' in done['answer']
            assert '(демо)' not in done['answer']


@pytest.mark.asyncio
async def test_numeric_product_id_resolves_detail_outside_search_sample(tmp_path):
    data=json.loads((Path(__file__).parents[1]/'app/integrations/fixtures/catalog.json').read_text())
    data['metadata']['source']='EKT_PRODUCT_LIST'
    product={**data['items'][0], 'id':'999999', 'sku':None,
             'availability':{'status':'IN_STOCK','quantity':3}}
    calls=[]
    def handler(request):
        calls.append(request.url.path)
        if request.url.path == '/api/catalog/products':
            assert request.url.params['query'] == product['id']
            return httpx.Response(200,json={'items':[], 'metadata':data['metadata']})
        assert request.url.path == '/api/catalog/products/'+product['id']
        return httpx.Response(200,json={'product':product,
            'metadata':{**data['metadata'], 'detailLevel':'PRODUCT_DETAIL'}})
    settings=Settings(environment='test',data_dir=tmp_path,catalog_mode='http',cart_mode='disabled',message_wait_seconds=0)
    app=create_app(settings)
    async with app.router.lifespan_context(app):
        rt=app.state.runtime
        await rt.catalog.client.aclose()
        rt.catalog.client=httpx.AsyncClient(base_url='http://catalog/',transport=httpx.MockTransport(handler))
        async with httpx.AsyncClient(base_url='http://test',transport=httpx.ASGITransport(app=app)) as client:
            session=(await client.post('/v1/sessions',json={})).json()
            headers={'Authorization':'Bearer '+session['session_token']}
            response=await client.post('/v1/sessions/'+session['session_id']+'/messages',headers=headers,
                json={'client_message_id':'direct-id','text':product['id']})
            assert await process_one(rt)
            done=(await client.get(response.json()['status_url'],headers=headers)).json()
            assert done['status']=='completed'
            assert done['products'][0]['id']==product['id']
            assert done['products'][0]['availability']=={'status':'IN_STOCK','quantity':3,'simulated':False,'source':'catalog'}
            assert 'Остаток: 3.' in done['answer']
            assert 'товар не найден' not in done['answer']
    assert calls==['/api/catalog/products','/api/catalog/products/'+product['id']]
