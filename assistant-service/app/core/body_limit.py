"""Enforce upload/body limits before multipart parsing, including chunked requests."""
from starlette.responses import JSONResponse

from app.core.errors import DomainError


class BodyTooLarge(Exception):
    pass


class BodyLimitMiddleware:
    def __init__(self, app, upload_limit):
        self.app,self.upload_limit=app,upload_limit

    async def __call__(self, scope, receive, send):
        if scope['type']!='http':
            return await self.app(scope,receive,send)
        limit=self.upload_limit+65536 if scope['path'].endswith('/attachments') else 65536
        size=0
        started=False
        async def bounded_receive():
            nonlocal size
            message=await receive()
            if message['type']=='http.request':
                size+=len(message.get('body',b''))
                if size>limit: raise BodyTooLarge()
            return message
        async def tracked_send(message):
            nonlocal started
            if message['type']=='http.response.start': started=True
            await send(message)
        headers=dict(scope.get('headers',[]))
        try:
            if int(headers.get(b'content-length',b'0'))>limit: raise BodyTooLarge()
            await self.app(scope,bounded_receive,tracked_send)
        except BodyTooLarge:
            if not started:
                await JSONResponse(DomainError(413,'file_too_large','Request exceeds size limit').body(),status_code=413)(scope,receive,send)
