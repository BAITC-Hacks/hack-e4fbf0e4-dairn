# EKT assistant frontend

React, TypeScript and Vite. The standalone storefront preview follows the navy (`#0B4366`), cyan (`#0B98D0`), white and light-gray palette in `example-page.html`. Text uses darker accessible shades. The saved page is a reference only; none of its tracking, extension scripts, or forms are loaded. Illustrations are local CSS.

## Run

From the repository root:

```sh
ASSISTANT_FRONTEND_BASE_URL=http://localhost:5173 docker compose -f assistant-service/compose.yaml up --build -d --wait
docker compose -f frontend-service/docker-compose.yml up --build -d --wait frontend
```

Open http://localhost:5173. Both assistant containers are required: the API accepts work and the worker processes files/messages. The default backend uses a synthetic catalog and a demo cart. Try `DEMO-C16`, `DEMO-C16-OLD`, or ask about delivery. Confirmed demo cart additions decrease persistent demo stock.

From this directory for local development (Node 24 LTS):

```sh
npm ci
npm run dev
```

`VITE_ASSISTANT_API_URL` defaults to `http://localhost:8000`. Copy `.env.example` to `.env` to configure public settings. Docker passes the public API URL and certificate-origin allowlist as build arguments; rebuild the frontend after changes. Never place model keys, partner passwords or `ASSISTANT_BOOTSTRAP_TOKEN` in frontend configuration. Authenticated deployments require a trusted website BFF for session bootstrap; the direct session creation here targets local demo mode.

Keep `ASSISTANT_FRONTEND_BASE_URL` equal to the actual frontend origin so returned cart links work. The backend must allow that origin through its CORS configuration. The supplied command uses 5173 rather than the backend's default 3000.

The Docker frontend serves a production build through Vite preview for local testing, bound to localhost. This is not production hosting. Stop just this frontend with `docker compose down` from this directory.

## Flows

- Session tokens live in memory and sessionStorage for this tab's reload/cart navigation; never in URLs. Session expiry or forbidden access clears authorized state. Starting a new session never replays a cart confirmation.
- Text, attachment-only and mixed messages are supported. Messages poll once per second through terminal status; temporary connection failures preserve the message for reconnection. Retried POSTs keep the exact body and client message ID.
- Files upload immediately on selection, at most two concurrently. Browser transfer progress and server extraction status are separate. Sending waits for upload acceptance, not extraction. Accepted files remain available for reuse in the same session. History restores attachments referenced by the latest 50 messages after reload.
- Supported extensions: XLSX/XLS, DOCX/DOC, PDF, JPEG/JPG, PNG. Maximum 10 MiB per file, 10 files per message, 20 uploads per session. The backend validates signatures and extraction limits. Upload POSTs have no idempotency key and are never retried silently; failed uploads require manual removal/reselection.
- Product cards show prices, stock by warehouse, attributes, freshness, certificates and source. Unknown values stay unknown. Decimal quantity validation checks minimum, step and known available stock without floating-point rounding.
- Selection is unique per product/warehouse. Re-selecting updates that row. Requesting a quote does not change the cart. Users review the exact product, quantity, unit, warehouse and price before pressing **Добавить в корзину**. Transport retries reuse the original confirmation key/body; edits require a new proposal. Stock/price changes invalidate the proposal; use **Обновить товары и остатки** and review again.
- `/cart?session_id=…` fetches the authenticated current demo cart. A mismatched or absent tab session cannot access another cart. Cart links allow only this origin; certificate links allow the API origin, `https://ekt.kz`, and explicitly configured `VITE_CERTIFICATE_ORIGINS` (comma-separated origins). Unexpected links are shown as unavailable.
- API answers and warnings render as plain text. No payment form or analytics is included. Model availability, extraction quality and authoritative purchase terms are backend concerns; their warnings/errors are shown.

## Verification

From this directory:

```sh
docker compose run --build --rm frontend-test
docker compose run --build --rm frontend-e2e
```

The first command runs ESLint, formatting, Vitest, TypeScript and the production build. The second runs Playwright with deterministic API fixtures on Chromium desktop and mobile, including axe accessibility checks, explicit cart confirmation, stable retries, upload concurrency/reuse, session isolation, changed-stock rejection, and terminal failures. These tests do not mutate backend inventory. Browser packages are cached in a separate Docker stage.

For local browser tests:

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

Automated accessibility checks are a baseline, not a full audit. Lighthouse CI and other browser engines are not yet configured. ESLint 9 remains pinned to the versions supported by the React/JSX accessibility plugins; upgrade these together when peer dependencies permit it.

## Structure

- `src/api/`: Assistant API types, authenticated requests, upload progress and link validation.
- `src/features/chat/`: session/async workflow hook, widget, product cards and quantity validation.
- `src/features/cart/`: lazy cart route and quote display.
- `src/app/`, `src/components/`, `src/styles/`: demo page, icons and responsive styles.
- `e2e/`: deterministic browser tests; unit tests live under `src/`.

Implementation follows the supplied [React standards](react-standards.md) and [backend frontend contract](../assistant-service/FRONTEND_AGENT.md). Companion references mentioned in the supplied skill were not attached.
