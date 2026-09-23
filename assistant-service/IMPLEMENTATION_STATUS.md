> Latest live stack verification: [LIVE_TEST_REPORT.md](LIVE_TEST_REPORT.md) (40 Assistant tests and 73 live checks passed). The endpoint/task audit below predates the now-running `ekt-catalog-service`; its old catalog-provider status is historical.

# EKT implementation status

Assistant currently implements **18 HTTP operations across 16 paths**. All originally planned Assistant routes exist; history, message polling and SSE were added. No additional core Assistant route is waiting to be created. Several routes still need live integration behind them.

## Implemented Assistant endpoints

| Method | Path | Status / limitation |
|---|---|---|
| GET | `/health/live` | Implemented |
| POST | `/v1/auth/register` | SQLite user creation, salted password hash, account token. |
| POST | `/v1/auth/login` | Rate-limited account login. |
| GET | `/v1/auth/me` | Current account profile. |
| POST | `/v1/auth/logout` | Revoke current token; history persists. |
| GET | `/v1/sessions` | Paginated per-user conversations. |
| DELETE | `/v1/sessions/{session_id}` | Delete owned conversation and related records. |
| POST | `/v1/sessions` | Local accounts own persistent conversations; guest/backend bootstrap tokens remain supported. Real EKT identity/cart mapping is pending. |
| POST | `/v1/sessions/{session_id}/attachments` | OCR for photos/scans; visual recognition beyond text is not implemented. |
| GET | `/v1/sessions/{session_id}/attachments/{attachment_id}` | OCR for photos/scans; visual recognition beyond text is not implemented. |
| POST | `/v1/sessions/{session_id}/messages` | Template/demo and live OpenAI generation tested; HTTP catalog remains unverified against the live provider. Policies are currently empty. |
| GET | `/v1/sessions/{session_id}/messages` | Implemented |
| GET | `/v1/sessions/{session_id}/messages/{message_id}` | Implemented |
| GET | `/v1/sessions/{session_id}/messages/{message_id}/events` | SSE status snapshots and final result; not model token streaming. |
| POST | `/v1/sessions/{session_id}/cart/proposals` | Demo adapter only. Real EKT cart integration is not implemented. |
| POST | `/v1/sessions/{session_id}/cart/proposals/{proposal_id}/confirm` | Demo adapter only. Real EKT cart integration is not implemented. |
| GET | `/v1/sessions/{session_id}/cart/operations/{operation_id}` | Demo adapter only. Real EKT cart integration is not implemented. Returns committed demo operations only; pending/failed upstream reconciliation is not implemented. |
| GET | `/v1/sessions/{session_id}/cart` | Demo adapter only. Real EKT cart integration is not implemented. |

`GET /docs`, `GET /redoc` and `GET /openapi.json` are FastAPI documentation routes and are not counted among the 18 business/health operations.

## Catalog provider endpoints still missing

The Assistant has an HTTP client for these interfaces and synthetic fixtures for local use. Neither is an implementation of the Catalog service. The current `catalog-service/` directory contains documentation rather than provider code.

| Method | Path | Status |
|---|---|---|
| GET | `/v1/products` | Not implemented |
| GET | `/v1/products/{product_id}` | Not implemented |
| GET | `/v1/products/{product_id}/alternatives` | Not implemented |
| POST | `/v1/availability/check` | Not implemented |

## Remaining work behind existing endpoints

- Real EKT cart authorization/identity, mutation, stock enforcement and checkout link. The implemented cart is labelled demo; HTTP catalog mode disables cart operations.
- Pending/failed partner-write reconciliation. The operation-read endpoint currently returns only committed demo operations.
- Live Catalog integration verification. OpenAI generation is verified with gpt-4.1-mini; catalog and cart still use synthetic data.
- Approved payment, delivery and minimum-order policy data; the provider exists but the configured policy file is empty.
- Additional adversarial-file/privacy checks and representative p95 latency/load measurements. Photos currently use OCR; visual recognition without markings and model token streaming are optional enhancements.
- RAG is explicitly deferred; KnowledgeProvider preserves an extension point.

## Harness task status

| ID | Task | Status | Implementation |
|---|---|---|
| EKT-01 | Review and freeze catalog and assistant contracts | in_progress | schemas_validated_review_pending |
| EKT-02 | Implement partner catalog ingestion and normalized product lookup | planned | not_implemented |
| EKT-03 | Implement search and explainable analog selection | planned | not_implemented |
| EKT-04 | Implement fresh availability and quantity validation | planned | not_implemented |
| EKT-05 | Implement session isolation and chat orchestration | in_progress | implemented_with_integration_gaps |
| EKT-06 | Implement policy answers and recommendation presentation | in_progress | partial |
| EKT-07 | Implement attachment extraction and expiry | in_progress | implemented_with_validation_gaps |
| EKT-08 | Implement deterministic cart proposal and confirmed commit | in_progress | demo_complete_live_pending |
| EKT-09 | Build embedded responsive chat and confirmation UI | in_progress | source_present_unverified |
| EKT-10 | Integrate services and demonstrate acceptance and latency | in_progress | demo_verified |
| EKT-11 | Document architecture, data and prototype deployment | in_progress | assistant_documented |
| EKT-12 | Implement Assistant runtime, durable worker and Docker deployment | complete | complete |
| EKT-13 | Publish Assistant API and frontend/Postman integration artifacts | complete | complete |

Catalog tasks may appear `blocked` in generated harness state because their contracts are not formally approved. Progress states are now preserved separately from `contract_gate`; structural validation is not treated as developer approval.

## Verification evidence

- 2026-09-23: Docker API/worker live OpenAI smoke passed with `gpt-4.1-mini`, `answer_mode: model`, 1.55-second acknowledgment and answer observed at 3.08 seconds. Single natural-language request using synthetic catalog evidence; no p95 claim.

- Current Assistant verification: 28 integration tests pass, including account ownership, restart persistence, revocation, expiry, retention and history deletion. Earlier harness verification: 11 tests passed.
- Earlier implementation turn: Docker HTTP/API/worker smoke passed for XLSX, XLS, DOCX, DOC, text PDF, scanned PDF, JPEG and PNG, followed by confirmed demo-cart addition.
- Earlier Postman turn: all implemented operations covered; automatic capture, retry keys and session resets checked by executing the scripts with mocked Postman state.
- Frontend source exists under `frontend-service/` and was preserved. Its tests and end-to-end acceptance were not run in this audit; it is not marked complete.

## Synchronized artifacts

- `planning/ekt-plan.json`: 13 tasks, actual paths, completed work and remaining work.
- `planning/endpoint-status.json`: machine-readable route inventory and limitations.
- `planning/ekt-runtime.json`: Assistant API/worker Compose metadata, isolated from root harness tooling.
- `planning/implementation-progress.json`: implementation/evidence snapshot.
- `contracts/assistant.openapi.json`: synchronized with `assistant-service/openapi.json`, version 0.2.0.
- `.harness/`: refreshed requirements, tasks, ownership, services, contract registry/dependencies, repository analysis, deployment, verification and final report.

The Assistant contract remains under review and the Catalog contract remains a draft; neither was silently approved. New and changed schemas must be reviewed before consumers rely on a frozen baseline.

## Refresh commands

```sh
export PYTHONPATH="$PWD/src"
.venv/bin/harness init --project hackathon-task.json
.venv/bin/harness analyze
.venv/bin/harness plan
.venv/bin/harness contract generate
.venv/bin/harness contract validate
.venv/bin/harness contract review
.venv/bin/harness validate-plan
.venv/bin/harness verify
.venv/bin/harness deployment analyze
.venv/bin/harness deployment validate
.venv/bin/harness report
```

Harness source and planning/contracts/docs directories are currently gitignored. Their local updates remain available, while this status file and the Assistant API/docs live under `assistant-service/`. The incremental harness patch is `planning/harness-progress-sync.patch`; apply it only after the earlier explicit-plan patch on a matching untouched harness. Both are already applied here.
