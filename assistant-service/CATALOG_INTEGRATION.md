# Catalog service integration

The supplied examples define the current communication contract. `catalog-service/docs/api-findings.md` documents upstream research and cautions about missing currency, stock, compatibility and detail evidence; it does not confirm a running Catalog HTTP service. This update was tested with HTTP mock transports, without contacting that service.

| Operation | Request | Response |
|---|---|---|
| Search | `GET /api/catalog/products?query=кабель` | `{items: Product[], metadata: Metadata}` |
| Detail | `GET /api/catalog/products/45357` | `{product: Product, metadata: Metadata}` |

The base URL is the origin (do not append `/api/catalog`). Query encoding is handled by httpx; product IDs are path-encoded. No unconfirmed pagination or limit parameters are sent. Assistant currently presents at most five search results. Optional configured internal Bearer authentication is retained; upstream EKT Basic Auth does not belong in Assistant.

Wire validation lives in `app/integrations/catalog_schema.py`. Products preserve `id`, `sku`, `name`, nullable `price` with nullable currency, `images`, nullable `pageUrl`, and `availability: {status, quantity}`. Envelope metadata is copied to each returned product as `catalog_metadata` and to chat source records as `metadata`.

Unknown quantity is not zero; unknown currency is not KZT. Snapshot load time is not stock observation time. No warehouse, characteristics, certificates, units or compatibility facts are invented. Internal `stock`, `attributes`, and `certificates` are empty, `observed_at` uses only `observedAt`, and unconfirmed freshness sets the conservative internal `stale` flag. Extra upstream fields are retained, but do not establish compatibility rules.

There is no confirmed alternatives or availability-check endpoint in this contract. HTTP mode returns no verified analogs and rejects availability checks; cart operations remain disabled. The standalone `demo` mode retains its existing three breaker fixtures and confirmed demo-cart workflow.

## Offline development

Set these values in `assistant-service/.env` while preserving your existing model settings:

```dotenv
ASSISTANT_CATALOG_MODE=http
ASSISTANT_CATALOG_BASE_URL=http://catalog-service:8000
ASSISTANT_CATALOG_MOCK_ON_UNAVAILABLE=true
ASSISTANT_CART_MODE=disabled
```

Rebuild to include the updated client and bundled fixture:

```sh
docker compose --env-file assistant-service/.env -f assistant-service/compose.yaml up -d --build
```

The port/hostname above is configurable, not a verified running deployment. This change does not switch the existing running demo containers to HTTP mode automatically.

Fallback is off by default and prohibited in production. When enabled, transport failures (including connection/timeouts) use `app/integrations/fixtures/catalog.json`. HTTP errors, malformed payloads and detail ID mismatches remain errors. Successful empty results never trigger fallback. Unknown fixture IDs return 404.

The fixture contains 12 entries: five cables, two breakers, three lighting products, one socket and one junction box. It incorporates the supplied example values and additional invented examples. All are labelled `SYNTHETIC_TEST_FIXTURE`, retain unknown stock/currency/freshness, and carry `fallbackReason: catalog_connection_unavailable` when served. Search filters fixture SKU/name/ID. Try `кабель`, `CABLE-001`, `LED`, `розетка`, or detail ID `45357`. No fixture is purchasable through a live cart.

## Verification

```sh
.venv/bin/python -m pytest -q -c assistant-service/pyproject.toml assistant-service/tests
```

Contract tests check exact paths/query names, envelopes, nullable values and metadata, connection fallback, fail-closed HTTP/schema errors, production restrictions, and complete offline chat output. They do not verify a live Catalog deployment.
