import json
import time

import httpx
import pytest

from app.core.config import Settings
from app.main import create_app
from app.worker import process_one


@pytest.fixture
async def api(tmp_path):
    app = create_app(Settings(environment='test', data_dir=tmp_path, message_wait_seconds=0))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            yield client, app.state.runtime


async def register(client, username='alice'):
    response = await client.post('/v1/auth/register', json={'username': username, 'password': 'test-password-long', 'display_name': username})
    assert response.status_code == 201, response.text
    data = response.json()
    return data, {'Authorization': 'Bearer '+data['access_token']}


@pytest.mark.asyncio
async def test_accounts_password_storage_and_revocation(api):
    client, rt = api
    data, headers = await register(client, 'ALICE')
    assert data['user']['username'] == 'alice'
    assert (await client.get('/v1/auth/me', headers=headers)).json() == data['user']
    with rt.store.connect() as con:
        user = dict(con.execute('SELECT * FROM users').fetchone())
        token = dict(con.execute('SELECT * FROM auth_tokens').fetchone())
    assert user['password_hash'].startswith('scrypt$')
    assert 'test-password-long' not in json.dumps(user)
    assert data['access_token'] not in json.dumps(token)
    assert (await client.post('/v1/auth/register', json={'username':'alice','password':'test-password-long','display_name':'A'})).status_code == 409
    for username in ('alice', 'unknown'):
        r = await client.post('/v1/auth/login', json={'username':username,'password':'wrong-password-long'})
        assert r.status_code == 401 and r.json()['code'] == 'invalid_credentials'
    assert (await client.post('/v1/auth/logout',headers=headers)).status_code == 204
    assert (await client.get('/v1/auth/me',headers=headers)).status_code == 401
    new = (await client.post('/v1/auth/login',json={'username':'alice','password':'test-password-long'})).json()
    assert new['user'] == data['user'] and new['access_token'] != data['access_token']


@pytest.mark.asyncio
async def test_user_history_ownership_pagination_restart_and_delete(api):
    client, rt = api
    user, alice = await register(client)
    _, bob = await register(client, 'bob')
    s = (await client.post('/v1/sessions',json={},headers=alice)).json()
    assert s['session_token'] is None and s['user_id'] == user['user']['user_id']
    base = '/v1/sessions/'+s['session_id']
    for i in range(2):
        r = await client.post(base+'/messages',headers=alice,json={'client_message_id':str(i),'text':'DEMO-C16'})
        assert r.status_code == 202
        assert await process_one(rt)
    assert len((await client.get(base+'/messages',headers=alice)).json()) == 2
    older = (await client.get(base+'/messages?limit=1&offset=1',headers=alice)).json()
    assert older[0]['client_message_id'] == '0'
    assert len((await client.get('/v1/sessions',headers=alice)).json()) == 1
    assert (await client.get('/v1/sessions',headers=bob)).json() == []
    assert (await client.get(base+'/messages',headers=bob)).status_code == 404
    assert (await client.post(base+'/messages',headers=bob,json={'client_message_id':'bad','text':'hi'})).status_code == 404
    assert (await client.delete(base,headers=bob)).status_code == 404
    # Logout does not delete history; re-login after constructing a fresh runtime.
    await client.post('/v1/auth/logout',headers=alice)
    app = create_app(rt.settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as other:
            login = (await other.post('/v1/auth/login',json={'username':'alice','password':'test-password-long'})).json()
            headers = {'Authorization':'Bearer '+login['access_token']}
            assert len((await other.get(base+'/messages',headers=headers)).json()) == 2
            assert (await other.get(base+'/messages',headers=alice)).status_code == 401
            assert (await other.delete(base,headers=headers)).status_code == 204
            assert (await other.get('/v1/sessions',headers=headers)).json() == []
            assert (await other.get(base+'/messages',headers=headers)).status_code == 401


@pytest.mark.asyncio
async def test_auth_expiry_invalid_tokens_guest_and_throttle(api):
    client, rt = api
    _, headers = await register(client)
    guest = (await client.post('/v1/sessions',json={})).json()
    assert guest['session_token'] and guest['user_id'] is None
    gh = {'Authorization':'Bearer '+guest['session_token']}
    assert (await client.get('/v1/sessions',headers=gh)).status_code == 401
    assert (await client.get('/v1/sessions')).status_code == 401
    assert (await client.post('/v1/sessions',json={},headers={'Authorization':'Bearer invalid'})).status_code == 401
    with rt.store.transaction() as con:
        con.execute('UPDATE auth_tokens SET expires=0')
    assert (await client.get('/v1/auth/me',headers=headers)).status_code == 401
    for _ in range(19):
        rt.auth.throttle('another-address', 'alice')
    response = await client.post('/v1/auth/login',json={'username':'alice','password':'test-password-long'})
    assert response.status_code == 429
    response = await client.post('/v1/auth/register',json={'username':'x','password':'short','display_name':'X'})
    assert response.status_code == 422 and 'short' not in response.text


@pytest.mark.asyncio
async def test_attachment_expiry_separate_from_history_and_cleanup(api):
    client, rt = api
    _, headers = await register(client)
    s = (await client.post('/v1/sessions',json={},headers=headers)).json()
    base = '/v1/sessions/'+s['session_id']
    upload = await client.post(base+'/attachments',headers=headers,files={'file':('scan.jpg',b'fake','image/jpeg')})
    assert upload.status_code == 202
    with rt.store.connect() as con:
        attachment = con.execute("SELECT expires FROM objects WHERE kind='attachment'").fetchone()[0]
        history = con.execute("SELECT expires FROM objects WHERE kind='session'").fetchone()[0]
    assert attachment <= time.time()+86400 and history > time.time()+29*86400
    with rt.store.transaction() as con:
        con.execute('UPDATE objects SET expires=0')
    rt.store.cleanup()
    assert (await client.get('/v1/sessions',headers=headers)).json() == []
    with rt.store.connect() as con:
        assert con.execute('SELECT count(*) FROM user_sessions').fetchone()[0] == 0
        assert con.execute('SELECT count(*) FROM users').fetchone()[0] == 1
