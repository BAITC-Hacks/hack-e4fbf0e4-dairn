import hmac

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.errors import DomainError
from app.domain.cart.service import digest

bearer=HTTPBearer(auto_error=False)


def runtime(request: Request):
    return request.app.state.runtime


def session(session_id: str, request: Request, credentials: HTTPAuthorizationCredentials | None=Depends(bearer)):
    if not credentials:
        raise DomainError(401,'unauthorized','Bearer session token required')
    rt=runtime(request)
    try: data=rt.store.get(session_id,'session',session_id)
    except DomainError as exc:
        raise DomainError(401,'session_expired','Session is missing or expired') from exc
    if not hmac.compare_digest(data['_token_hash'],digest(credentials.credentials)):
        raise DomainError(403,'session_mismatch','Token does not belong to this session')
    return data
