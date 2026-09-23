# Catalog service integration

Chat searches the Catalog HTTP service and then fetches details for up to ten selected products before generating an answer. The Catalog service owns EKT authentication, paginated list access and direct `/api/products/detail?id=...` access; EKT credentials never enter the frontend or Assistant. A numeric product-ID message can resolve directly even outside the cached search pages. Live list and detail access were verified on 23 September 2026.

| Operation | Request | Response |
|---|---|---|
| Search | `GET /api/catalog/products?query=кабель` | `{items: Product[], metadata: Metadata}` |
| Detail | `GET /api/catalog/products/45357` | `{product: Product, metadata: Metadata}` |

The base URL is the origin (do not append `/api/catalog`). Query encoding is handled by httpx; product IDs are path-encoded. No unconfirmed pagination or limit parameters are sent by Assistant. Pagination and cache limits are controlled in the Catalog service; cached search coverage is not proof of a complete EKT catalog. Each search returns at most five candidates to Assistant, and a message selects at most ten across its queries. Optional configured internal Bearer authentication is retained.

Wire validation lives in `app/integrations/catalog_schema.py`. Products preserve `id`, `sku`, `name`, nullable `price`, `images`, nullable `pageUrl`, and `availability`. Detail fields such as description, stock, attributes and certificates are retained when supplied. Envelope metadata is copied to each returned product as `catalog_metadata` and to chat source records as `metadata`.

The project owner confirmed that EKT prices are always tenge: Assistant sets `price.currency` to `KZT` without changing amounts or fabricating a missing price. Actual quantities, including zero, take precedence over simulation. Where quantity is omitted/null and status does not explicitly mean unavailable, Assistant supplies a stable pseudorandom integer from 1 to 100 derived from the product ID, with `availability.status: IN_STOCK`, `simulated: true`, and `source: assistant_simulation`. Other availability values carry `simulated: false` and `source: catalog`. Explicit `OUT_OF_STOCK`/`UNAVAILABLE` without quantity is preserved.

Simulation is a prototype display feature, not verified EKT stock: template/model answers label it “демо” and the frontend labels it in RU/KZ. No warehouse, unit, reservation or purchase eligibility is fabricated. Simulation is stable across requests/workers/restarts and is replaced whenever real detail quantity becomes available. Catalog detail failures keep the list candidate with an explicit detail-unavailable notice; they do not fabricate verified facts.

The two generic partial-catalog/list-summary notices were removed from chat output at the owner's request; underlying source metadata remains available. Old messages are filtered by the frontend when rendered. Snapshot load time is not a warehouse stock observation, and extra fields do not establish compatibility rules.

There is no confirmed alternatives or availability-check endpoint in this contract. HTTP mode returns no verified analogs and rejects availability checks; cart operations remain disabled. The standalone `demo` mode retains its existing three breaker fixtures and confirmed demo-cart workflow.

## Offline development

Set these values in `assistant-service/.env` while preserving your existing model settings:

```dotenv
ASSISTANT_CATALOG_MODE=http
ASSISTANT_CATALOG_BASE_URL=http://catalog-service:8000
ASSISTANT_CATALOG_MOCK_ON_UNAVAILABLE=true
ASSISTANT_CART_MODE=disabled
```

For the integrated root stack, rebuild the catalog, Assistant API/worker and frontend together:

```sh
docker compose up -d --build --wait ekt-catalog-service assistant-service assistant-worker frontend
```

For the separate Assistant-only Compose setup:

```sh
docker compose --env-file assistant-service/.env -f assistant-service/compose.yaml up -d --build
```

The port/hostname above is configurable, not a verified running deployment. This change does not switch the existing running demo containers to HTTP mode automatically.

Fallback is off by default and prohibited in production. When enabled, transport failures (including connection/timeouts) use `app/integrations/fixtures/catalog.json`. HTTP errors, malformed payloads and detail ID mismatches remain errors. Successful empty results never trigger fallback. Unknown fixture IDs return 404.

The fixture contains 12 entries: five cables, two breakers, three lighting products, one socket and one junction box. It incorporates supplied example values and additional invented examples. All are labelled `SYNTHETIC_TEST_FIXTURE` and carry `fallbackReason: catalog_connection_unavailable` when served. Assistant applies the same KZT/simulated-availability presentation to missing fields while retaining synthetic provenance. Search filters fixture SKU/name/ID. Try `кабель`, `CABLE-001`, `LED`, `розетка`, or detail ID `45357`. No fixture is purchasable through a live cart.

## Verification

```sh
.venv/bin/python -m pytest -q -c assistant-service/pyproject.toml assistant-service/tests
```

Contract tests check exact paths/query names, envelopes, nullable values and metadata, connection fallback, fail-closed HTTP/schema errors, production restrictions, and complete offline chat output. They do not verify a live Catalog deployment.
