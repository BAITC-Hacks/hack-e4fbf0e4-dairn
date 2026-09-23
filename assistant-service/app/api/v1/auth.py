from fastapi import APIRouter, Depends, Request, Response
from fastapi.security import HTTPAuthorizationCredentials

from app.api.dependencies import bearer, current_user, runtime
from app.api.models import AuthResponse, LoginRequest, RegisterRequest, User

router = APIRouter(prefix='/v1/auth', tags=['auth'])


@router.post('/register', response_model=AuthResponse, status_code=201)
def register(body: RegisterRequest, request: Request):
    auth = runtime(request).auth
    auth.throttle(request.client.host if request.client else 'unknown', body.username)
    return auth.register(body)


@router.post('/login', response_model=AuthResponse)
def login(body: LoginRequest, request: Request):
    auth = runtime(request).auth
    auth.throttle(request.client.host if request.client else 'unknown', body.username)
    return auth.login(body)


@router.get('/me', response_model=User)
def me(user=Depends(current_user)):
    return user


@router.post('/logout', status_code=204)
def logout(request: Request, user=Depends(current_user), credentials: HTTPAuthorizationCredentials=Depends(bearer)):
    runtime(request).auth.logout(credentials.credentials)
    return Response(status_code=204)
