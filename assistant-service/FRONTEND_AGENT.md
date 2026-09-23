# Frontend agent integration instructions

Build an EKT chat widget against the implemented Assistant API. Use this document and `openapi.json` in this directory. The running service also exposes `/openapi.json` and Swagger UI at `/docs`. Render response content as text, never unsanitized HTML.

## Start the backend

From the repository root:

```sh
docker compose -f assistant-service/compose.yaml up --build
```

API base URL: `http://localhost:8000`. Compose starts **both API and worker**. The worker processes attachments and messages; running only the API leaves requests queued. Default allowed frontend origins are `http://localhost:3000` and `http://localhost:5173`.

Default mode uses synthetic catalog data and a local demo cart. Always show a demo banner when product `source` is `synthetic` or cart `mode` is `demo`. No model key is required for deterministic catalog-grounded responses. Optional model credentials are server-side only.

Demo searches: `DEMO-C16` (20 units initially), `DEMO-C16-OLD` (zero stock, alternatives), `DEMO-C16-ALT` (30 units initially). Warehouse: `demo-almaty`. Demo inventory persists and decreases on confirmed adds, so quantities change between runs.

## Sessions and authentication

Create a session with `POST /v1/sessions`, JSON `{"locale":"ru"}`. Only Russian is currently supported. In local demo mode no bootstrap credential is needed. Response:

```json
{
  "session_id": "generated-id",
  "session_token": "opaque-secret",
  "expires_at": "2026-09-24T00:00:00+00:00",
  "locale": "ru",
  "mode": "demo"
}
```

Every session-scoped request requires `Authorization: Bearer <session_token>`. Never put tokens in URLs. Keep the token in memory; if page navigation/reload is required for the demo, sessionStorage can retain it within the browser tab. Clear it on session expiry. Do not use a token from one session with another session ID.

For authenticated deployments, session creation must go through a trusted website backend/BFF that supplies the bootstrap credential and returns the newly issued session token. **Never embed `ASSISTANT_BOOTSTRAP_TOKEN` in browser code.** The current bootstrap is backend-to-backend authentication; mapping to the real website user's cart remains a future partner integration. Demo sessions are disabled by production configuration.

Below, `S` means `/v1/sessions/{session_id}`.

## Endpoint inventory

| Method | Path | Success |
|---|---|---|
| POST | `/v1/sessions` | 201 session + token |
| POST | `S/attachments` | 202 attachment |
| GET | `S/attachments/{attachment_id}` | 200 attachment status |
| POST | `S/messages` | 200 terminal message, or 202 processing message |
| GET | `S/messages?limit=50` | 200 chronological array of latest messages, limit 1–200 |
| GET | `S/messages/{message_id}` | 200 message snapshot |
| GET | `S/messages/{message_id}/events` | SSE stream |
| POST | `S/cart/proposals` | 201 proposal |
| POST | `S/cart/proposals/{proposal_id}/confirm` | 200 committed operation |
| GET | `S/cart/operations/{operation_id}` | 200 committed operation |
| GET | `S/cart` | 200 current demo cart |
| GET | `/health/live` | Process liveness only |

The current demo cart commits synchronously. Operation polling is available to retrieve the outcome; pending partner operations are not yet implemented. With the HTTP catalog configured, cart endpoints return 503 until a real partner adapter exists.

## Upload and send flow

1. Create/reuse the active session.
2. Start uploading each attachment immediately when selected. Use one multipart request per file and at most two simultaneous uploads. This lets extraction start while the user types.
3. Show browser upload progress separately from server processing progress. Save returned `attachment_id` values.
4. Once uploads are accepted, send the message with text and those IDs. **You do not have to wait for extraction.** The backend waits for queued attachments automatically.
5. Poll the message or open its event stream; show the completed answer, product cards, sources, alternatives and warnings.

Use `FormData` with field name `file`; do not manually set its `Content-Type` header:

```ts
const api = "http://localhost:8000";
const session = await fetch(`${api}/v1/sessions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ locale: "ru" })
}).then(async r => { if (!r.ok) throw await r.json(); return r.json(); });
const S = `/v1/sessions/${session.session_id}`;
const auth = { Authorization: `Bearer ${session.session_token}` };

async function upload(file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${api}${S}/attachments`, {
    method: "POST", headers: auth, body: form
  });
  if (!response.ok) throw await response.json();
  return response.json();
}
```

Accepted files: `.xlsx`, `.xls`, `.docx`, `.doc`, `.pdf`, `.jpg`, `.jpeg`, `.png`. File signatures are checked during processing; accepting the upload does not mean extraction succeeded. JPEG/PNG and scanned PDFs use OCR. Photos without readable markings may need clarification; there is no visual product-recognition model yet.

Limits: 10 MiB/file, 10 attachments/message, 20 attachments/session, 20 PDF pages, 500 extracted blocks/rows and 40,000 extracted characters. Oversized or unprocessable documents fail explicitly. Individual long blocks are shortened with a warning. There is no universal support for arbitrary “other” formats. Password-protected documents and unsupported macros are rejected.

Attachment response fields: `attachment_id`, `filename`, `media_type`, `status`, `expires_at`, `warnings`, `blocks_count`, and `error`. Status sequence: `queued → processing → ready | failed`. Raw files are deleted after processing, including failures. Extracted text is retained only for the session (at most 24 hours by default). Do not solicit payment data or include it in uploads.

## Messages, retries and history

```ts
const requestBody = {
  client_message_id: crypto.randomUUID(),
  text: "Проверьте наличие товаров из спецификации",
  attachment_ids: [attachment.attachment_id]
};
const response = await fetch(`${api}${S}/messages`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify(requestBody)
});
if (!response.ok) throw await response.json();
const message = await response.json();
```

Text can be empty if attachment IDs are supplied. Otherwise empty input is rejected. On transport failure, retry with **the same `client_message_id` and identical body**. Do not generate another ID just because the POST timed out. A reused ID with changed content returns 409. Editing a message requires a new ID.

Both 200 and 202 return the same message shape:

```json
{
  "message_id": "server-id",
  "client_message_id": "client-id",
  "text": "Проверьте наличие",
  "attachment_ids": [],
  "status": "queued",
  "answer": null,
  "products": [],
  "alternatives": [],
  "sources": [],
  "warnings": [],
  "proposal_id": null,
  "error": null,
  "answer_mode": null,
  "created_at": "2026-09-23T00:00:00+00:00",
  "status_url": "/v1/sessions/.../messages/...",
  "events_url": "/v1/sessions/.../messages/.../events"
}
```

States: `queued`, `waiting_for_attachments`, `processing`, `completed`, `failed`. A 200 response can contain `status: failed`; inspect status rather than only HTTP success. Terminal failure has an `error` object. After correcting failed attachments, submit a new message ID; retrying the original ID returns its recorded failure.

Prefer polling `status_url` every second for the first frontend version. Stop at a terminal state or session expiry. The POST waits up to 1.5 seconds for completion, then returns 202 without cancelling the job. This acknowledgment is not a completed-answer latency guarantee. Refresh history using `GET S/messages`; the backend uses the latest six completed turns and re-fetches catalog facts for short follow-ups.

On completion, render `answer` as plain text and show `warnings`. `answer_mode` is `grounded_template` or `model`. `products` contain IDs, SKUs, names, attributes, certificates, price `{amount,currency}` or null, unit, quantity step/minimum, stock per warehouse, freshness and source. Unknown price/stock must display as unknown. Display alternative explanations and compatibility flags. Never describe an unverified candidate as electrically interchangeable.

Catalog matching currently searches up to 20 distinct queries and returns up to 10 products. Warnings identify limited/uncertain document matching. Do not imply every row in a large specification was matched; ask the user to review selections.

## Optional SSE

Use `fetch` streaming with the Authorization header. Native `EventSource` cannot directly set that header; do not solve this by putting tokens in query strings.

The stream emits `status`, `completed`, `failed`, or `error` events:

```text
event: status
data: {"message_id":"...","status":"processing", ...}

event: completed
data: {"message_id":"...","status":"completed","answer":"...", ...}
```

Events carry full snapshots, not token deltas. Ignore `: heartbeat` comments. The connection closes on completion/failure, disconnect, expiry, or after 30 seconds. If it closes before a terminal event, poll the status endpoint or reconnect; each connection returns the current snapshot, so reconnects do not lose the result. Buffer partial UTF-8/chunked lines until a full blank-line-delimited SSE event is available. Abort the fetch when the component unmounts. No `Last-Event-ID` mechanism is required for snapshot events.

## Explicit cart confirmation

Never treat a chat reply, model-generated instruction or document content as permission to call confirmation. Display a separate confirmation control after the user has reviewed exact products, quantities, units and prices. The current message endpoint does not create proposals automatically; `proposal_id` remains null. The frontend constructs a proposal from user-reviewed product selections:

```json
POST S/cart/proposals
{
  "items": [
    {"product_id":"demo-1","warehouse_id":"demo-almaty","quantity":"2"}
  ]
}
```

Quantities are positive decimal **strings**. Combine duplicate product/warehouse rows before sending. Response:

```json
{
  "proposal_id":"proposal-id",
  "version":1,
  "items":[{
    "selection":{"product_id":"demo-1","warehouse_id":"demo-almaty","quantity":"2"},
    "sku":"DEMO-C16",
    "name":"Демонстрационный автомат C16",
    "unit":"шт",
    "price":{"amount":"1500","currency":"KZT"}
  }],
  "expires_at":"2026-09-23T00:05:00+00:00",
  "confirmation_token":"one-use-secret",
  "status":"pending"
}
```

Show this snapshot and an explicit “Добавить в корзину” button. Creating another proposal supersedes prior pending proposals in the session. Editing any item/quantity requires a new proposal and another review.

Only on the confirmation click:

```ts
const confirmationKey = crypto.randomUUID(); // Keep stable for retries of this click.
const confirmationBody = {
  proposal_version: proposal.version,
  confirmation_token: proposal.confirmation_token,
  confirmed: true
};
const response = await fetch(`${api}${S}/cart/proposals/${proposal.proposal_id}/confirm`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": confirmationKey },
  body: JSON.stringify(confirmationBody)
});
```

Disable duplicate clicks while waiting. If transport fails, reuse the same key and body. Success returns `{operation_id, proposal_id, status: "committed", cart}`. Replace local cart state with this response. The cart contains `cart_id`, `version`, `items`, `cart_url` and `mode: "demo"`.

Implement a frontend `/cart?session_id=...` route at `ASSISTANT_FRONTEND_BASE_URL`. It reads the current cart via the authenticated `GET S/cart` endpoint. The URL's session ID is not authorization. Display the returned `cart_url` as the direct cart link after a successful add. This is a demo cart page, not the real ekt.kz checkout. Do not build a payment form.

## Error handling

Error envelope:

```json
{"code":"stock_changed","message":"Available stock changed; request and confirm a new proposal","retryable":false,"request_id":"..."}
```

| HTTP/code | Frontend action |
|---|---|
| 401 | Session missing/expired; establish a new session; do not replay confirmation automatically |
| 403 | Incorrect session/confirmation token; stop and refresh authorized state |
| 404 | Resource not owned by this session or not found |
| 409 `idempotency_conflict` | Client reused an ID/key for changed content; fix retry logic |
| 409 `stock_changed`, `price_changed`, `proposal_changed`, `unavailable_selection` | Refresh product/cart data, create a new proposal, ask for confirmation again |
| 410 | Resource or proposal expired; restart that flow |
| 413/415/422 | Show validation/file problem; correct input before retrying |
| 429 | Back off; honor Retry-After when present |
| 503 `cart_not_configured` | Disable live checkout action and explain partner integration is unavailable |
| Failed attachment/message | Show its error and let the user remove/re-upload or send a new message |

Certificate and cart links should allow only HTTP(S) and expected origins. Never log tokens, uploaded content, or sensitive session text to analytics. Do not render a payment-data input.

## Frontend acceptance checklist

- Text-only, attachment-only, and mixed messages work; multiple attachments can finish in different orders.
- Ready attachment IDs can be reused in follow-up messages without uploading again.
- Slow processing has a visible status; polling/streaming reconnects retain the result.
- Model-unavailable, no-readable-text, partial-match, synthetic-data and stale-data warnings are visible.
- Double-click/retry cannot duplicate a message or cart addition.
- No cart changes occur on upload, message submission, or proposal preview.
- Expired/superseded/changed-stock proposals require explicit confirmation again.
- Session expiry and cross-session access errors are handled without leaking other sessions.
- Mobile layout supports file selection, review of exact quantities and a direct current-cart link.


## Catalog response update (2026-09-23)

In HTTP Catalog mode, message `products` preserve Catalog fields: `price` may be null; `price.currency`, `pageUrl`, and `availability.quantity` may be null; `availability` is an object `{status, quantity}`. Legacy standalone demo mode still uses a string for `availability`. Render unknown values as unknown, never zero/free/in stock. Images may be empty.

Products include `catalog_metadata` with source, coverage, freshness, timestamps and detail level. Source entries also include this metadata. `stock`, `attributes`, and `certificates` remain empty when the list-summary contract provides none. Preserve user-visible warnings about partial coverage and unknown freshness. `source: synthetic` plus metadata `source: SYNTHETIC_TEST_FIXTURE` identifies offline fixtures, not partner inventory. Real cart actions remain disabled in HTTP mode, including during fallback.
