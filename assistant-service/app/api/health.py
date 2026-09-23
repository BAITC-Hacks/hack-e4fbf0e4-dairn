from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["assistant-service"] = "assistant-service"


@router.get("/health/live", response_model=HealthResponse)
async def liveness() -> HealthResponse:
    """Process liveness only; does not claim catalog, model or cart readiness."""
    return HealthResponse()
