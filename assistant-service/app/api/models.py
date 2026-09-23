from typing import Any, Literal
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid')


class SessionRequest(Model):
    locale: Literal['ru'] = 'ru'


class SessionResponse(Model):
    session_id: str
    session_token: str
    expires_at: str
    locale: str
    mode: str


class MessageRequest(Model):
    client_message_id: str = Field(min_length=1, max_length=128)
    text: str = Field(default='', max_length=16000)
    attachment_ids: list[str] = Field(default_factory=list, max_length=10)

    @model_validator(mode='after')
    def content_required(self):
        if not self.text.strip() and not self.attachment_ids:
            raise ValueError('Provide text or attachment_ids')
        if len(set(self.attachment_ids)) != len(self.attachment_ids):
            raise ValueError('Duplicate attachment_ids are not allowed')
        return self


class MessageResponse(Model):
    message_id: str
    client_message_id: str
    text: str
    attachment_ids: list[str]
    status: Literal['queued', 'waiting_for_attachments', 'processing', 'completed', 'failed']
    answer: str | None = None
    products: list[dict[str, Any]] = Field(default_factory=list)
    alternatives: list[dict[str, Any]] = Field(default_factory=list)
    sources: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    proposal_id: str | None = None
    error: dict[str, Any] | None = None
    answer_mode: str | None = None
    created_at: str
    status_url: str
    events_url: str


class AttachmentResponse(Model):
    attachment_id: str
    filename: str
    media_type: str
    status: Literal['queued', 'processing', 'ready', 'failed']
    expires_at: str
    error: dict[str, Any] | None = None
    warnings: list[str] = Field(default_factory=list)
    blocks_count: int = 0


class Selection(Model):
    product_id: str = Field(min_length=1, max_length=128)
    warehouse_id: str = Field(min_length=1, max_length=128)
    quantity: str = Field(pattern=r'^(0|[1-9][0-9]*)(\.[0-9]+)?$', max_length=30)

    @field_validator('quantity')
    @classmethod
    def positive(cls, value):
        if Decimal(value) <= 0:
            raise ValueError('Quantity must be positive')
        return format(Decimal(value), 'f')


class ProposalRequest(Model):
    items: list[Selection] = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def unique_items(self):
        keys = [(i.product_id, i.warehouse_id) for i in self.items]
        if len(set(keys)) != len(keys):
            raise ValueError('Combine duplicate product/warehouse selections first')
        return self


class Confirmation(Model):
    proposal_version: int = Field(ge=1)
    confirmation_token: str = Field(min_length=1, max_length=256)
    confirmed: Literal[True]

    @field_validator('confirmed', mode='before')
    @classmethod
    def explicit_boolean(cls, value):
        if value is not True:
            raise ValueError('confirmed must be the JSON boolean true')
        return value


class ProposalResponse(Model):
    proposal_id: str
    version: int
    items: list[dict[str, Any]]
    expires_at: str
    confirmation_token: str
    status: str


class CartResponse(Model):
    cart_id: str
    version: str
    items: list[dict[str, Any]]
    cart_url: str
    mode: Literal['demo']


class CartCommit(Model):
    operation_id: str
    proposal_id: str
    status: Literal['committed']
    cart: CartResponse


class ErrorResponse(Model):
    code: str
    message: str
    retryable: bool
    request_id: str
