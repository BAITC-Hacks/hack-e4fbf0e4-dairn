# Live full-stack verification

Tested: 2026-09-23T11:53:39.145420+00:00

All four root Compose services are running and healthy. The final live smoke passed all 73 checks across six message scenarios; the Assistant automated suite passed 40 tests. The frontend production build passed. Live requests went through nginx `/assistant` proxy, with actual EKT catalog and OpenAI generation. No synthetic fallback was enabled.

## Running services

| Service | Address |
|---|---|
| Frontend | http://localhost:5173 |
| Assistant API | http://localhost:8000/docs |
| Catalog API | http://localhost:8081/api/catalog/products?query=LED |
| Assistant worker | Background process on the Compose network |

Catalog uses internal port 8080. Host port 8081 avoids an unrelated Airflow container. Older standalone project containers were stopped; their data volumes were preserved. Root Compose uses its separate `ekt_assistant-data` volume, so old standalone accounts/history are not automatically migrated. Credentials are kept in the ignored root `.env`, not this report.

## Measured message timings

| Scenario | Acknowledgment (s) | Answer observed (s) | Mode |
|---|---:|---:|---|
| exact SKU | 0.114 | 0.114 | grounded_template |
| natural-language SKU | 1.553 | 4.959 | model |
| follow-up detail refresh | 1.513 | 1.513 | model |
| long question | 1.541 | 1.746 | model |
| empty result | 0.972 | 0.972 | model |
| spreadsheet attachment | 1.530 | 1.948 | model |

These are individual smoke measurements, not load-test or p95 guarantees. Exact SKU queries use the factual fast path. Other tested requests used real model answers.

## Verified communication

1. Frontend nginx /assistant proxy -> Assistant API:8000
2. Assistant API -> shared SQLite job queue -> Assistant worker
3. Assistant worker -> GET http://ekt-catalog-service:8080/api/catalog/products?query=<extracted term>
4. Assistant worker -> GET http://ekt-catalog-service:8080/api/catalog/products/45357 for contextual detail refresh
5. Catalog service -> authenticated GET https://ekt.kz/api/products (page 1)
6. Assistant worker -> POST https://api.openai.com/v1/responses -> stored answer -> polling/SSE

Worker HTTP logs confirmed successful Catalog search/detail calls and OpenAI Responses calls. Metadata reported source `EKT_PRODUCT_LIST`, mode `LIVE`, freshness `RECENTLY_FETCHED`, and no synthetic source. Product `45357` / SKU `ярп4520` matched the direct Catalog response, including decimal price `1810`, null currency and unknown availability.

SSE final snapshots, XLSX processing, user history, cross-account denial, logout revocation, and disabled live-cart access passed. The test created and deleted its own temporary chats/accounts. The final frontend was checked by production build, HTTP serving and proxy tests; this report does not claim a full interactive-browser UI suite.

## Corrections made during testing

- Extract bounded SKU/keyword searches from natural-language messages; normalize upstream queries to the provider limit. The original full question still reaches answer generation.
- Accept nullable SKU and distinguish recently fetched data from expired/unknown data.
- Preserve metadata for empty searches and the `PRODUCT_NOT_IN_LOADED_SAMPLE` error.
- Clarify that missing characteristics/certificates are missing data, and avoid inventing quantity units.
- Repair frontend translation imports and the duplicated restored-state variable that blocked production builds.

## Remaining limits

- Catalog currently loads only page 1: 20 products in this run, `coverage: PARTIAL`, `detailLevel: LIST_SUMMARY`. `кабель` returning no results does not prove cables are absent from the full catalog.
- Currency, stock, structured characteristics, certificates and compatibility remain unverified or unavailable in the normalized list response. Real cart writes stay disabled.
- Retrieval is bounded literal search, not semantic search; catalog AI search remains disabled.
- Spreadsheet headers and instruction text can produce unmatched-query warnings even when the SKU row resolves; this does not change the matched item.
- These tests cover live XLSX processing; other file formats retain automated/mock/container evidence from earlier tests, not new live-model verification here.

## Repeat the live smoke

This performs real external calls and consumes model usage. Run from the repository root:

```sh
docker compose --env-file .env -f docker-compose.yml up -d --build
docker compose --env-file .env -f docker-compose.yml exec -T -e LIVE_STACK_TEST=1 assistant-service python - < assistant-service/tests/live_stack_smoke.py
docker compose --env-file .env -f docker-compose.yml cp assistant-service:/tmp/ekt-live-report.json assistant-service/LIVE_TEST_RESULTS.json
```

Detailed credential-free results: [LIVE_TEST_RESULTS.json](LIVE_TEST_RESULTS.json).
