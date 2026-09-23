from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ASSISTANT_", extra="ignore")

    environment: Literal['development', 'production', 'test'] = 'development'
    data_dir: Path = Path('./data')
    allow_demo_sessions: bool = True
    bootstrap_token: SecretStr | None = None
    session_ttl_seconds: int = Field(default=86400, ge=60, le=86400)
    auth_token_ttl_seconds: int = Field(default=86400, ge=60, le=2592000)
    user_history_ttl_days: int = Field(default=30, ge=1, le=365)
    catalog_mode: Literal['demo', 'http'] = 'demo'
    catalog_base_url: str = 'http://catalog-service:8000'
    catalog_service_token: SecretStr | None = None
    catalog_timeout_seconds: float = Field(default=3, gt=0, le=30)
    catalog_mock_on_unavailable: bool = False
    catalog_concurrency: int = Field(default=4, ge=1, le=16)
    cart_mode: Literal['demo', 'disabled'] = 'demo'
    frontend_base_url: str = 'http://localhost:3000'
    cors_origins: list[str] = ['http://localhost:3000', 'http://localhost:5173']
    upload_max_bytes: int = Field(default=10 * 1024 * 1024, gt=0)
    max_session_attachments: int = Field(default=20, ge=1)
    max_pending_jobs: int = Field(default=200, ge=1)
    message_wait_seconds: float = Field(default=1.5, ge=0, le=3)
    worker_concurrency: int = Field(default=2, ge=1, le=8)
    ocr_languages: str = 'rus+eng'
    model_api_key: SecretStr | None = None
    model_name: str | None = None
    model_timeout_seconds: float = Field(default=12, gt=0, le=30)
    policy_file: Path | None = None

    @model_validator(mode='after')
    def validate_modes(self):
        if self.environment == 'production' and self.allow_demo_sessions:
            raise ValueError('Production requires disabled demo sessions; use account authentication or optional backend bootstrap')
        if self.environment == 'production' and self.catalog_mock_on_unavailable:
            raise ValueError('Synthetic catalog fallback is for development/test only')
        if self.catalog_mode == 'http' and self.cart_mode == 'demo':
            raise ValueError('HTTP catalog requires cart_mode=disabled until a partner cart adapter exists')
        if self.model_api_key and not self.model_name:
            raise ValueError('Set model_name explicitly when configuring model_api_key')
        if not self.frontend_base_url.startswith(('http://', 'https://')):
            raise ValueError('frontend_base_url must be an HTTP(S) URL')
        return self
