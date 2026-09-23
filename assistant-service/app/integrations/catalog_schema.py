"""Catalog wire envelopes supplied by the Catalog team; nullable facts stay unknown."""
from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict


class WireModel(BaseModel):
    model_config = ConfigDict(extra='allow')


class Price(WireModel):
    amount: str
    currency: str | None


class Availability(WireModel):
    status: str
    quantity: str | int | float | None


class CatalogProduct(WireModel):
    id: str
    sku: str | None
    name: str
    price: Price | None
    images: list
    pageUrl: str | None
    availability: Availability


class Metadata(WireModel):
    source: str
    mode: str
    coverage: str
    pages: list[int]
    loadedProducts: int
    totalProducts: int | None
    observedAt: str | None
    loadedAt: str
    expiresAt: str | None
    freshness: str
    detailLevel: str


class SearchResponse(WireModel):
    items: list[CatalogProduct]
    metadata: Metadata


class DetailResponse(WireModel):
    product: CatalogProduct
    metadata: Metadata


def is_stale(metadata: Metadata):
    # RECENTLY_FETCHED describes transport freshness, not verified stock/currency.
    if metadata.freshness not in {'RECENTLY_FETCHED', 'FRESH'} or not metadata.expiresAt:
        return True
    try:
        expires_at = datetime.fromisoformat(metadata.expiresAt.replace('Z', '+00:00'))
        return expires_at.tzinfo is None or expires_at <= datetime.now(timezone.utc)
    except ValueError:
        return True


def normalize(product: CatalogProduct, metadata: Metadata):
    result = product.model_dump()
    # Keep wire fields for consumers, plus Assistant's existing internal aliases.
    result.update(stock=[], attributes={}, certificates=[], observed_at=metadata.observedAt,
                  source='synthetic' if metadata.source == 'SYNTHETIC_TEST_FIXTURE' else metadata.source,
                  stale=is_stale(metadata), catalog_metadata=metadata.model_dump())
    return result
