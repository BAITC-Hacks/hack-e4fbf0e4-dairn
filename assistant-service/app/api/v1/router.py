import asyncio
import hashlib
import hmac
import json
import secrets
import time
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Header, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials

from app.api.dependencies import bearer, current_user, runtime, session
from app.api.models import (AttachmentResponse, CartCommit, CartResponse, Confirmation,
    Conversation, MessageRequest, MessageResponse, ProposalRequest, ProposalResponse, SessionRequest, SessionResponse)
from app.core.errors import DomainError
from app.domain.attachments.parser import SUPPORTED, redact
from app.domain.cart.service import digest, iso
from app.storage.store import dump, uid

router=APIRouter(prefix='/v1')


def public(data):
    return {k:v for k,v in data.items() if not k.startswith('_')}


@router.post('/sessions',response_model=SessionResponse,status_code=201,tags=['sessions'])
def create_session(body: SessionRequest,request: Request,credentials: HTTPAuthorizationCredentials | None=Depends(bearer)):
    rt=runtime(request); settings=rt.settings
    user = None
    is_bootstrap = bool(credentials and settings.bootstrap_token and hmac.compare_digest(
        credentials.credentials, settings.bootstrap_token.get_secret_value()))
    if credentials and not is_bootstrap:
        user = rt.auth.authenticate(credentials.credentials)
    if not user and not settings.allow_demo_sessions and not is_bootstrap:
        raise DomainError(401,'bootstrap_required','Account or trusted backend credential required')
    sid=uid(); token=secrets.token_urlsafe(32)
    ttl = settings.user_history_ttl_days*86400 if user else settings.session_ttl_seconds
    expires=time.time()+ttl
    data={'session_id':sid,'expires_at':iso(expires),'locale':body.locale,
          'mode':'authenticated' if user or is_bootstrap else 'demo',
          'user_id':user['user_id'] if user else None, 'created_at':iso(time.time()),
          '_token_hash':None if user else digest(token),'_expires':expires}
    with rt.store.transaction() as con:
        rt.store.put(con,sid,'session',sid,data,expires)
        if user:
            con.execute('INSERT INTO user_sessions VALUES(?,?)', (sid,user['user_id']))
    return public(data)|{'session_token':None if user else token}


@router.get('/sessions',response_model=list[Conversation],tags=['sessions'])
def conversations(request: Request, limit: int=Query(default=50,ge=1,le=200),
                  offset: int=Query(default=0,ge=0), user=Depends(current_user)):
    with runtime(request).store.connect() as con:
        rows = con.execute("""SELECT o.data FROM objects o JOIN user_sessions s ON s.session_id=o.id
            WHERE s.user_id=? AND o.kind='session' AND o.expires>?
            ORDER BY o.created DESC, o.id DESC LIMIT ? OFFSET ?""",
            (user['user_id'],time.time(),limit,offset)).fetchall()
    return [public(json.loads(r['data'])) for r in rows]


@router.delete('/sessions/{session_id}',status_code=204,tags=['sessions'])
def delete_conversation(session_id: str,request: Request,user=Depends(current_user),auth=Depends(session)):
    if auth.get('user_id') != user['user_id']:
        raise DomainError(404,'not_found','Conversation not found')
    store = runtime(request).store
    with store.transaction() as con:
        rows = con.execute("SELECT data FROM objects WHERE session=? AND kind='attachment'", (session_id,)).fetchall()
        for row in rows:
            path = json.loads(row['data']).get('_path')
            if path:
                Path(path).unlink(missing_ok=True)
        con.execute('DELETE FROM jobs WHERE id IN (SELECT id FROM objects WHERE session=?)', (session_id,))
        con.execute('DELETE FROM dedup WHERE session=?', (session_id,))
        con.execute('DELETE FROM user_sessions WHERE session_id=?', (session_id,))
        con.execute('DELETE FROM objects WHERE session=?', (session_id,))
    return Response(status_code=204)


@router.post('/sessions/{session_id}/attachments',response_model=AttachmentResponse,status_code=202,tags=['attachments'])
async def upload(session_id: str, request: Request, file: Annotated[UploadFile, File()], auth=Depends(session)):
    rt=runtime(request); extension=Path(file.filename or '').suffix.lower()
    if extension not in SUPPORTED:
        await file.close(); raise DomainError(415,'unsupported_media','Supported: XLSX, XLS, DOCX, DOC, PDF, JPEG/JPG, PNG')
    if len(rt.store.list(session_id,'attachment',rt.settings.max_session_attachments))>=rt.settings.max_session_attachments:
        await file.close(); raise DomainError(429,'attachment_limit','Session attachment limit reached')
    aid=uid(); folder=rt.settings.data_dir/'uploads'; folder.mkdir(exist_ok=True)
    path=folder/(aid+extension); size=0
    try:
        with path.open('wb') as target:
            while chunk:=await file.read(65536):
                size+=len(chunk)
                if size>rt.settings.upload_max_bytes:
                    raise DomainError(413,'file_too_large','Maximum file size is 10 MiB')
                target.write(chunk)
        if size==0: raise DomainError(422,'empty_file','File is empty')
        attachment_expires=min(auth['_expires'],time.time()+86400)
        data={'attachment_id':aid,'filename':Path(file.filename).name[:200],
              'media_type':SUPPORTED[extension],'status':'queued','expires_at':iso(attachment_expires),
              'warnings':[],'error':None,'blocks_count':0,'_path':str(path.resolve()),'_session':session_id}
        with rt.store.transaction() as con:
            if con.execute("SELECT count(*) FROM objects WHERE session=? AND kind='attachment' AND expires>?",(session_id,time.time())).fetchone()[0]>=rt.settings.max_session_attachments:
                raise DomainError(429,'attachment_limit','Session attachment limit reached')
            rt.store.put(con,aid,'attachment',session_id,data,attachment_expires)
            rt.store.enqueue(con,aid,'attachment',rt.settings.max_pending_jobs)
        return public(data)
    except BaseException:
        path.unlink(missing_ok=True); raise
    finally:
        await file.close()


@router.get('/sessions/{session_id}/attachments/{attachment_id}',response_model=AttachmentResponse,tags=['attachments'])
def get_attachment(session_id: str,attachment_id: str,request: Request,auth=Depends(session)):
    return public(runtime(request).store.get(attachment_id,'attachment',session_id))


@router.post('/sessions/{session_id}/messages',response_model=MessageResponse,
             responses={202:{'model':MessageResponse,'description':'Queued; poll or stream'}},tags=['messages'])
async def send_message(session_id: str,body: MessageRequest,request: Request,response: Response,auth=Depends(session)):
    rt=runtime(request)
    for aid in body.attachment_ids: rt.store.get(aid,'attachment',session_id)
    clean=body.model_dump(); clean['text']=redact(clean['text'])
    fingerprint=hashlib.sha256(dump(clean).encode()).hexdigest()
    with rt.store.transaction() as con:
        previous=con.execute("SELECT * FROM dedup WHERE session=? AND scope='message' AND key=?",(session_id,body.client_message_id)).fetchone()
        if previous:
            if previous['fingerprint']!=fingerprint:
                raise DomainError(409,'idempotency_conflict','client_message_id already used for a different message')
            mid=previous['object_id']
        else:
            if con.execute("SELECT count(*) FROM objects WHERE session=? AND kind='message'",(session_id,)).fetchone()[0]>=200:
                raise DomainError(429,'message_limit','Session message limit reached')
            mid=uid(); prefix=f'/v1/sessions/{session_id}/messages/{mid}'
            data={'message_id':mid,**clean,'status':'queued','answer':None,'products':[],'alternatives':[],
                  'sources':[],'warnings':[],'proposal_id':None,'error':None,'answer_mode':None,
                  'created_at':iso(time.time()),'status_url':prefix,'events_url':prefix+'/events','_session':session_id,'_queued_at':time.time()}
            rt.store.put(con,mid,'message',session_id,data,auth['_expires'])
            rt.store.enqueue(con,mid,'message',rt.settings.max_pending_jobs)
            con.execute('INSERT INTO dedup VALUES(?,?,?,?,?)',(session_id,'message',body.client_message_id,fingerprint,mid))
    deadline=time.monotonic()+rt.settings.message_wait_seconds
    while True:
        data=rt.store.get(mid,'message',session_id)
        if data['status'] in ('completed','failed') or time.monotonic()>=deadline: break
        await asyncio.sleep(0.05)
    response.status_code=200 if data['status'] in ('completed','failed') else 202
    response.headers['Location']=data['status_url']
    if response.status_code==202: response.headers['Retry-After']='1'
    return public(data)


@router.get('/sessions/{session_id}/messages',response_model=list[MessageResponse],tags=['messages'])
def history(session_id: str,request: Request,limit: int=Query(default=50,ge=1,le=200),offset: int=Query(default=0,ge=0),auth=Depends(session)):
    return [public(m) for m in runtime(request).store.list(session_id,'message',limit,offset)]


@router.get('/sessions/{session_id}/messages/{message_id}',response_model=MessageResponse,tags=['messages'])
def get_message(session_id: str,message_id: str,request: Request,auth=Depends(session)):
    return public(runtime(request).store.get(message_id,'message',session_id))


@router.get('/sessions/{session_id}/messages/{message_id}/events',tags=['messages'],
            response_class=StreamingResponse,responses={200:{'content':{'text/event-stream':{}},'description':'SSE status snapshots; completed or failed is terminal'}})
async def events(session_id: str,message_id: str,request: Request,auth=Depends(session),credentials=Depends(bearer)):
    rt=runtime(request); rt.store.get(message_id,'message',session_id)
    async def stream():
        previous=None; deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            if await request.is_disconnected(): return
            try:
                session(session_id,request,credentials)
                data=public(rt.store.get(message_id,'message',session_id))
            except DomainError as exc:
                yield 'event: error\ndata: '+json.dumps(exc.body())+'\n\n'; return
            payload=json.dumps(data,ensure_ascii=False)
            if payload!=previous:
                event=data['status'] if data['status'] in ('completed','failed') else 'status'
                yield f'event: {event}\ndata: {payload}\n\n'; previous=payload
            else: yield ': heartbeat\n\n'
            if data['status'] in ('completed','failed'): return
            await asyncio.sleep(1)
    return StreamingResponse(stream(),media_type='text/event-stream',headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})


@router.post('/sessions/{session_id}/cart/proposals',response_model=ProposalResponse,status_code=201,tags=['cart'])
async def propose(session_id: str,body: ProposalRequest,request: Request,auth=Depends(session)):
    return await runtime(request).cart.propose(session_id,[i.model_dump() for i in body.items],auth['_expires'])


@router.post('/sessions/{session_id}/cart/proposals/{proposal_id}/confirm',response_model=CartCommit,tags=['cart'])
def confirm(session_id: str,proposal_id: str,body: Confirmation,request: Request,
            idempotency_key: Annotated[str,Header(min_length=1,max_length=128)],auth=Depends(session)):
    return runtime(request).cart.confirm(session_id,proposal_id,body.model_dump(),idempotency_key,auth['_expires'])


@router.get('/sessions/{session_id}/cart/operations/{operation_id}',response_model=CartCommit,tags=['cart'])
def operation(session_id: str,operation_id: str,request: Request,auth=Depends(session)):
    return runtime(request).store.get(operation_id,'operation',session_id)


@router.get('/sessions/{session_id}/cart',response_model=CartResponse,tags=['cart'])
def cart(session_id: str,request: Request,auth=Depends(session)):
    return runtime(request).cart.read(session_id)
