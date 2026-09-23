"""Opt-in live smoke: creates temporary users/chats; uses real catalog and model.
Run inside the root Compose assistant-service container; never prints credentials.
"""
import io
import json
import os
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from openpyxl import Workbook

from app.core.config import Settings
from app.storage.store import Store

if os.environ.get('LIVE_STACK_TEST') != '1':
    raise SystemExit('Set LIVE_STACK_TEST=1 explicitly; this test calls the real model/catalog.')

report = {'tested_at': datetime.now(timezone.utc).isoformat(), 'checks': [], 'messages': []}
created_sessions = []
created_users = []

def check(name, condition, **details):
    report['checks'].append({'name': name, 'passed': bool(condition), **details})
    if not condition:
        raise AssertionError(name)

with httpx.Client(base_url='http://frontend:8080/assistant', timeout=40) as api, httpx.Client(base_url='http://ekt-catalog-service:8080', timeout=35) as catalog:
    try:
        check('frontend page', api.get('http://frontend:8080/').status_code == 200)
        check('frontend proxy to assistant', api.get('/health/live').status_code == 200)
        check('catalog readiness', catalog.get('/health/ready').status_code == 200)
        started=time.monotonic()
        response=catalog.get('/api/catalog/products', params={'query':'LED'})
        check('live catalog search HTTP', response.status_code == 200)
        data=response.json(); report['catalog']={'latency_seconds':round(time.monotonic()-started,3),'metadata':data['metadata']}
        check('real upstream source, partial coverage', data['metadata']['source']=='EKT_PRODUCT_LIST' and data['metadata']['mode']=='LIVE' and data['items'])
        product=next(p for p in data['items'] if p['sku'])
        sku=product['sku'];pid=product['id'];report['product']={'id':pid,'sku':sku,'price':product['price'],'availability':product['availability']}
        detail=catalog.get('/api/catalog/products/'+pid)
        check('catalog detail wrapper and identity',detail.status_code==200 and detail.json()['product']==product)
        missing=catalog.get('/api/catalog/products/nonexistent-live-smoke')
        check('missing ID preserves sample scope',missing.status_code==404 and missing.json()['error']['code']=='PRODUCT_NOT_IN_LOADED_SAMPLE')

        def register():
            r=api.post('/v1/auth/register',json={'username':'live_'+secrets.token_hex(6),'password':secrets.token_urlsafe(24),'display_name':'Temporary integration test'})
            check('account registration',r.status_code==201)
            auth=r.json();created_users.append(auth['user']['user_id'])
            return {'Authorization':'Bearer '+auth['access_token']}
        headers=register()
        def conversation():
            r=api.post('/v1/sessions',json={},headers=headers);check('owned conversation creation',r.status_code==201)
            base='/v1/sessions/'+r.json()['session_id'];created_sessions.append(base);return base
        def send(label, text, base=None, attachments=None, expected=True, expect_model=True):
            base=base or conversation();started=time.monotonic()
            r=api.post(base+'/messages',headers=headers,json={'client_message_id':secrets.token_hex(8),'text':text,'attachment_ids':attachments or []})
            check(label+' accepted',r.status_code in (200,202))
            ack=time.monotonic()-started;m=r.json()
            deadline=time.monotonic()+100
            while m['status'] not in ('completed','failed') and time.monotonic()<deadline:
                time.sleep(.2);r=api.get(base+'/messages/'+m['message_id'],headers=headers);r.raise_for_status();m=r.json()
            metrics={'case':label,'ack_seconds':round(ack,3),'complete_seconds':round(time.monotonic()-started,3),'status':m['status'],'answer_mode':m['answer_mode'],'message_id':m['message_id'],'product_ids':[p['id'] for p in m['products']],'answer':m['answer'],'warnings':m['warnings']}
            report['messages'].append(metrics)
            print(json.dumps({k:v for k,v in metrics.items() if k not in ('answer','warnings')},ensure_ascii=False),flush=True)
            check(label+' completed',m['status']=='completed')
            check(label+' expected retrieval',(pid in metrics['product_ids']) if expected else not metrics['product_ids'])
            check(label+' expected answer mode',m['answer_mode']==('model' if expect_model else 'grounded_template'))
            check(label+' provenance',any(s.get('metadata',{}).get('mode')=='LIVE' for s in m['sources']))
            check(label+' no synthetic fallback',all(p['source']!='synthetic' for p in m['products']))
            check(label+' no false stale warning',not any('устарели' in w for w in m['warnings']))
            for p in m['products']:
                if p['id']==pid:
                    check(label+' source facts unchanged',p['price']==product['price'] and p['availability']==product['availability'])
            events=api.get(base+'/messages/'+m['message_id']+'/events',headers=headers)
            check(label+' SSE final response',events.status_code==200 and 'event: completed' in events.text)
            return base,m

        send('exact SKU',sku,expect_model=False)
        base,_=send('natural-language SKU','Расскажите о товаре '+sku+': цена и наличие?')
        send('follow-up detail refresh','А какие характеристики и сертификаты?',base=base)
        send('long question','Пожалуйста, расскажите о товаре '+sku+'. '+('Мне важны подтвержденные сведения о наличии и условиях покупки. '*5))
        send('empty result','несуществующийтовар',expected=False)
        base=conversation();book=Workbook();book.active.append(['Артикул','Количество']);book.active.append([sku,2]);content=io.BytesIO();book.save(content)
        upload=api.post(base+'/attachments',headers=headers,files={'file':('live-smoke.xlsx',content.getvalue(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')})
        check('upload XLSX',upload.status_code==202)
        send('spreadsheet attachment','Проверьте позиции из спецификации.',base=base,attachments=[upload.json()['attachment_id']])
        history=api.get(base+'/messages',headers=headers)
        check('user chat history',history.status_code==200 and len(history.json())==1)
        other=register()
        check('cross-user access denied',api.get(base+'/messages',headers=other).status_code==404)
        check('real cart stays disabled',api.get(base+'/cart',headers=headers).status_code==503)
        check('logout',api.post('/v1/auth/logout',headers=other).status_code==204)
        check('revoked token rejected',api.get('/v1/auth/me',headers=other).status_code==401)
        report['passed']=True
    except Exception as exc:
        report['passed']=False;report['failure_type']=type(exc).__name__
        print('Live smoke failed: '+type(exc).__name__,flush=True)
        raise
    finally:
        # Delete only IDs created by this run. Never touch another user's data.
        if 'headers' in locals():
            for base in created_sessions:
                api.delete(base,headers=headers)
            api.post('/v1/auth/logout',headers=headers)
        store=Store(Settings().data_dir)
        with store.transaction() as con:
            for user_id in created_users:
                con.execute('DELETE FROM auth_tokens WHERE user_id=?',(user_id,))
                con.execute('DELETE FROM users WHERE user_id=?',(user_id,))
        Path('/tmp/ekt-live-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'passed':report.get('passed',False),'checks':len(report['checks']),'report':'/tmp/ekt-live-report.json'}),flush=True)
