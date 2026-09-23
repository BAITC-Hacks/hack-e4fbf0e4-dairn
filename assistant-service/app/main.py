import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.api.v1.auth import router as auth_router
from app.api.health import router as health_router
from app.api.models import ErrorResponse
from app.api.v1.router import router as v1_router
from app.core.body_limit import BodyLimitMiddleware
from app.core.config import Settings
from app.core.errors import DomainError
from app.runtime import Runtime


def create_app(settings: Settings | None = None) -> FastAPI:
    settings=settings or Settings()
    @asynccontextmanager
    async def lifespan(application):
        application.state.runtime=Runtime(settings)
        try: yield
        finally: await application.state.runtime.close()
    application=FastAPI(title='EKT Assistant Service',version='0.2.0',lifespan=lifespan,
        description='Persistent asynchronous chat and attachments, optional model generation, and explicit demo cart confirmation. No RAG. Business data is synthetic in demo mode.')
    application.state.settings=settings
    application.add_middleware(BodyLimitMiddleware,upload_limit=settings.upload_max_bytes)
    application.add_middleware(CORSMiddleware,allow_origins=settings.cors_origins,
        allow_methods=['GET','POST','DELETE'],allow_headers=['Authorization','Content-Type','Idempotency-Key'],
        expose_headers=['Location','Retry-After','Server-Timing'])

    @application.exception_handler(DomainError)
    async def domain_error(request,exc):
        return JSONResponse(exc.body(),status_code=exc.status,headers={'Retry-After':'1'} if exc.retryable else {})

    @application.exception_handler(RequestValidationError)
    async def validation_error(request,exc):
        # Do not echo submitted values, document content or credentials.
        return JSONResponse(DomainError(422,'validation_error','Invalid request fields; check the API schema').body(),status_code=422)

    @application.exception_handler(HTTPException)
    async def http_error(request,exc):
        return JSONResponse(DomainError(exc.status_code,'http_error',str(exc.detail)).body(),status_code=exc.status_code)

    @application.middleware('http')
    async def timing(request: Request,call_next):
        start=time.monotonic()
        response=await call_next(request)
        response.headers['Server-Timing']=f'api;dur={(time.monotonic()-start)*1000:.1f}'
        response.headers['Cache-Control']='no-store'
        return response

    application.include_router(health_router)
    application.include_router(auth_router,responses={code:{'model':ErrorResponse} for code in (401,409,422,429)})
    application.include_router(v1_router,responses={code:{'model':ErrorResponse} for code in (400,401,403,404,409,410,413,415,422,429,503)})
    return application


app=create_app()
