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
        q=request.url.params['query'];calls.append(q)
        return httpx.Response(200,json={'items':[p for p in data['items'] if p['sku']==q], 'metadata':data['metadata']})
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
                assert any('часть каталога' in w for w in done['warnings'])
                if not expected:
                    assert 'полном каталоге' in done['answer']
    assert calls==['ярп4520','несуществующийтовар']
