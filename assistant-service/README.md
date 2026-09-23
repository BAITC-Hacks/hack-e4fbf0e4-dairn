# EKT Assistant service

Implemented FastAPI business API with persistent sessions, asynchronous document extraction/messages, optional single-call model generation, and explicit demo-cart confirmation. **No RAG or embeddings** are used. See [FRONTEND_AGENT.md](FRONTEND_AGENT.md) for the frontend integration contract and [openapi.json](openapi.json) for the generated API schema.

## Run

```sh
# From the repository root:
docker compose -f assistant-service/compose.yaml up --build
```

API: http://localhost:8000/docs. Compose starts API and worker from the same image, sharing a SQLite/data volume. The catalog defaults to labelled synthetic fixtures; no credentials or external services are needed for the demo. `DEMO-C16`, `DEMO-C16-OLD` and `DEMO-C16-ALT` are example SKUs.

To customize settings, copy `.env.example` to `.env` in this directory and run:

```sh
docker compose --env-file assistant-service/.env -f assistant-service/compose.yaml up --build
```

For live chat, keep both model settings in the service `.env` and use the `--env-file` command above when recreating containers. Send a natural-language question through the existing message endpoint, then poll its status URL or subscribe to SSE; `answer_mode: model` confirms hosted generation. Exact SKU-only requests intentionally return `grounded_template` for speed.

To use the Catalog service, set `ASSISTANT_CATALOG_MODE=http`, configure `ASSISTANT_CATALOG_BASE_URL` and its internal service token, and set `ASSISTANT_CART_MODE=disabled`. Partner Basic Auth belongs in the Catalog service, not here. Live cart endpoints and website cart identity have not been supplied; real cart writes deliberately remain unavailable.

Optional model generation uses the Responses API. Set both `ASSISTANT_MODEL_API_KEY` and `ASSISTANT_MODEL_NAME` explicitly. No model is silently chosen. Exact SKU-only queries bypass the model. Other requests use at most one answer-generation call, with bounded context, `store:false`, no tools and no cart access. On model failure the service falls back to catalog-grounded templates. Live generation was verified with `gpt-4.1-mini` on 2026-09-23: a natural-language product question returned `answer_mode: model`, with a 1.55-second acknowledgment and a completed answer observed after 3.08 seconds. This single request used synthetic catalog evidence and does not establish p95 latency. The local `.env` is gitignored, excluded from Docker builds, and readable only by its owner; never copy the key into frontend configuration or Postman. The selected model is documented in the [official OpenAI documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini). See the [official Responses API documentation](https://developers.openai.com/api/docs/guides/migrate-to-responses).

Add approved payment/delivery/minimum-order policies to `config/policies.json`. It is an array of objects with `id`, `text`, `source`, and `version`; the current empty file causes an honest unavailable-policy answer. Restart the worker after changes. Do not invent partner policies for the demo.

Production configuration requires `ASSISTANT_ALLOW_DEMO_SESSIONS=false` and a nonempty `ASSISTANT_BOOTSTRAP_TOKEN`. Only a trusted website backend should know this token. The bootstrap authenticates the backend, but mapping to a real website/cart user is still a partner integration task. The current implementation is a single-host prototype, not a multi-host production deployment.

## Local development

Requires Python 3.12+, plus Tesseract with Russian/English language data, Poppler (`pdftoppm`) and LibreOffice Writer for all file formats. The Docker image installs these tools.

```sh
cd assistant-service
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[test]'
# Terminal 1:
.venv/bin/uvicorn app.main:app --reload --port 8000
# Terminal 2, same directory/environment/data directory:
.venv/bin/python -m app.worker
# Verification:
.venv/bin/python -m pytest -q
```

Local settings read exported `ASSISTANT_*` variables; `.env` is loaded by Compose's `--env-file`, not implicitly by local processes. Do not run only the API and expect processing to complete.

## Catalog wire contract and offline tests

The HTTP adapter follows the supplied `/api/catalog/products?query=…` and `/api/catalog/products/{id}` envelopes. See [CATALOG_INTEGRATION.md](CATALOG_INTEGRATION.md) for mappings, sample fixtures, and offline configuration. The old `/v1/products`, alternatives and availability-check calls are no longer used in HTTP mode.

## Code map

- `app/api/v1/router.py`: sessions, uploads, messages/history/status/SSE and cart endpoints.
- `app/api/models.py`: request/response schemas, explicit boolean confirmation and positive decimal quantities.
- `app/domain/attachments/parser.py`: bounded file-signature-aware extraction for Excel/Word/PDF/JPEG/PNG; OCR for scans/photos.
- `app/domain/chat/service.py`: short conversation context, attachment reuse, bounded concurrent product matching and one optional model call.
- `app/domain/cart/service.py`: proposals, one-use confirmation, idempotency and atomic demo inventory updates.
- `app/integrations/catalog.py`: demo fixtures and HTTP adapter for the agreed catalog contract.
- `app/integrations/knowledge.py`: `KnowledgeProvider` interface and direct approved-policy lookup. A future session-aware retrieval provider can implement this interface without changing HTTP endpoints.
- `app/integrations/model.py`: replaceable answer generation; no tool loop.
- `app/storage/store.py`: SQLite WAL storage, transactional idempotency, leased queue and expiry cleanup.
- `app/worker.py`: bounded workers, separate timed parser processes and restart recovery.

## Response-time behavior

A message POST waits up to 1.5 seconds for completion, then returns 202 and durable status/event URLs. This is an acknowledgment deadline, not a promise that OCR or a remote model finishes in 1.5 seconds. SSE sends status snapshots and a final answer, not token deltas. Catalog calls use pooled connections, a concurrency limit of four and a three-second request timeout. Up to 20 distinct search queries are evaluated and 10 products are returned; truncation/unmatched-data warnings are explicit.

Extraction begins as soon as the file is uploaded and is reused by follow-up messages. Each parser runs outside the API process with a 75-second deadline; complete job execution is bounded at 90 seconds. Queue recovery uses 180-second leases. A pending message waiting for attachments or earlier conversation turns fails after a bounded wait. SQLite persists jobs through API/worker restarts. Expired data is removed by worker housekeeping.

`Server-Timing` reports API handling time; worker logs record message execution time and answer mode without message content. The container smoke check completed a message with an already processed attachment in about 0.08 seconds on this machine using synthetic data and no model. This does not establish real-catalog/model p95 latency or OCR performance under load.

## Data and functional limits

Raw uploads are deleted after extraction or failure. Extracted content, session tokens (stored as hashes), messages and proposals expire with the session, at most 24 hours by default. Tokens never belong in URLs. Basic card-like-number/IBAN filtering runs before extracted text or message text is persisted or sent to the model; this is heuristic filtering, not a complete sensitive-data classifier. Do not collect payment data.

Files are limited to 10 MiB, PDFs to 20 pages, spreadsheets/documents to 500 blocks/rows and 40,000 extracted characters. Excessive extraction is rejected; long individual blocks produce shortening warnings. Photos currently use OCR only, not visual object recognition. Extraction of formulas uses saved values rather than executing formulas/macros. Catalog matching is bounded and can require clarification; an entire large specification is not guaranteed to be resolved automatically.

The demo cart decrements its own synthetic inventory atomically and returns a link to the frontend `/cart` route. It does not reserve real EKT inventory or submit orders. Implement that frontend route using the guide, and keep the demo label visible. A future partner adapter must provide equivalent stock, idempotency, authorization and uncertain-outcome reconciliation guarantees before live writes are enabled.

## Verification

The API integration suite covers session isolation/expiry, attachment-only requests and failures, context, idempotent messages, SSE, worker recovery, model timeout fallback, exact-SKU fast path, remote catalog failure, explicit cart confirmation and concurrent oversell prevention. It also validates generated OpenAPI.

To run real HTTP/worker/OCR/legacy-Office checks in a temporary container after building:

```sh
docker compose -f assistant-service/compose.yaml run --rm --no-deps -T \
  -v "$PWD/assistant-service/tests:/checks:ro" \
  assistant-service python /checks/container_smoke.py
```

The smoke check generates temporary documents and uses isolated temporary state. Its legacy XLS fixture is synthetic. No partner API writes or live model calls are made.
