# Catalog Service deployment — Issue 7

## Actual status (2026-09-23)

**Local packaged-JAR verification passed; external/container deployment remains blocked.**
No hosting target, domain, registry or remote-host access has been supplied. Docker Engine
and Compose are not installed in the development environment. No Docker image has been
built here, no public URL has been verified, and the CI workflow has not yet run on GitHub.
This document is not a declaration that Issue 7 or the final demo deployment is complete.

| Recorded field | Actual value |
| --- | --- |
| Tested source branch | `codex/work` |
| Base full commit | `b0ae31cf8e0dd411a8f8cc51b8dabc20b365f7b7` |
| Working source | Base commit plus uncommitted Issue 7 changes; not a released revision |
| Base short SHA | `b0ae31c` (not a deployed image tag) |
| Deployed Docker tag | None |
| Local verification completed | `2026-09-23T10:24:13Z` |
| Verified temporary base URL | `http://127.0.0.1:18080` (processes stopped after smoke tests) |
| Public/client demo base URL | Not assigned |
| Selected hosting target | Pending team selection; artifacts target a Linux Docker/Compose host |

## Prerequisites and source

Linux host: Git, Docker Engine, Docker Compose plugin and Python 3 for smoke checks.
Local JVM verification needs JDK 21; Gradle 8.8 is pinned by the included wrapper.
Build access to Gradle distribution hosting, Maven Central and Docker image registries is required.
The runtime needs outbound HTTPS to EKT; OpenAI is optional.

```bash
git clone https://github.com/BAITC-Hacks/hack-e4fbf0e4-dairn.git
cd hack-e4fbf0e4-dairn
git checkout <reviewed-service-branch-or-main>
cd ekt-catalog-service
cp .env.example .env
chmod 600 .env
# Edit .env locally using the hosting platform's secret mechanism/editor.
git check-ignore .env
```

For the final release, merge the **entire `ekt-catalog-service/` directory and deployment
artifacts** into `main` after tests/review, then check out that resulting revision.
Development builds may use the working branch. Neither merge nor final release has occurred
as part of this local verification. Do not assign a commit tag to uncommitted changes.

## Configuration

Compose loads `.env`; the JVM itself does not. Supply equivalent environment variables
through the hosting platform for deployments without Compose. Never pass credentials as
command-line arguments or commit `.env`. Avoid sharing `docker compose config` output,
because interpolation may reveal secrets.

| Variable | Meaning |
| --- | --- |
| `EKT_API_BASE_URL` | Required for `live`; HTTPS origin, without `/api` |
| `EKT_API_USERNAME`, `EKT_API_PASSWORD` | Required for `live`; missing/invalid values fail startup |
| `CATALOG_SOURCE` | `live` in the deployment example/image; `snapshot` for explicit offline evidence; `disabled` returns not-ready |
| `PORT` | Listener port, default 8080; takes precedence over legacy `CATALOG_PORT`; invalid values fail startup |
| `CATALOG_HOST` | JVM bind address; Compose/image set `0.0.0.0`; standalone default `127.0.0.1` |
| `CATALOG_BIND_ADDRESS` | Compose host interface, default `127.0.0.1` for a host reverse proxy |
| `CATALOG_CORS_ORIGINS` | Optional comma-separated exact HTTP(S) origins, no paths/trailing slashes; empty disables cross-origin access; credentials are never enabled |
| `CATALOG_SNAPSHOT_PATH` | Required only for snapshot mode; mount the file read-only into a container |
| `CATALOG_MAX_PRODUCTS` | Default 100; range 1–1000 |
| `CATALOG_CACHE_TTL_SECONDS` | Default 60; range 1–3600 |
| `CATALOG_LOAD_TIMEOUT_MS` | Default 35000; range 1–120000 |
| `OPENAI_SEARCH_ENABLED` | Default false; when enabled, existing assisted-search behavior is preserved |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Needed only by enabled AI operations; absence does not block Catalog GET startup/readiness; assisted search reports `AI_UNAVAILABLE` |
| `OPENAI_TIMEOUT_MS`, `OPENAI_MAX_OUTPUT_TOKENS` | Existing optional AI bounds; see `AI_SEARCH.md` |
| `OPENAI_PREVALIDATION_ENABLED` | Existing separate prevalidation component; not automatically connected to catalog loading |
| `IMAGE_TAG` | Compose image selector, default `latest`; deployment script uses the checked-out short SHA |

OpenAI failure must never supply substitute product facts. The GET API has no OpenAI dependency.

## Build and local production-like verification

All build, Compose and script commands below run from `ekt-catalog-service/`.
The service is a standalone Gradle project. GitHub Actions remains in the repository's
`.github/workflows/` and sets this working directory explicitly.

```bash
sh ./gradlew --no-daemon test serverDist
python3 scripts/verify-local.py
```

The generated entry artifact is `build/server/ekt-service-catalog.jar`.
Keep the adjacent `lib/` directory: the JAR uses a manifest classpath instead of embedding
dependencies. The Docker build produces both from checked-out sources and runs tests;
it does not copy a developer-built JAR. Runtime is JRE 21, non-root, with entrypoint
`java -jar /app/ekt-service-catalog.jar`. CLI `run`/`installDist` remain available.

Manual local run with the repository's recorded first-page fixture:

```bash
CATALOG_SOURCE=snapshot \
CATALOG_SNAPSHOT_PATH=src/test/resources/ekt/products-page-1.json \
PORT=18080 java -jar build/server/ekt-service-catalog.jar
# In another terminal:
python3 scripts/smoke.py http://127.0.0.1:18080 45357
```

This is an offline snapshot with `mode=SNAPSHOT`, `coverage=PARTIAL`, unknown freshness and
unknown stock. It is not evidence of a live EKT authentication/request.

## Container deployment and lifecycle

On the selected host, configure `.env` for live EKT and an actual browser origin, then:

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=100 ekt-catalog-service
```

For a traceable reviewed deployment, use the helper instead. It rejects dirty checkouts,
builds/tests before updating containers, tags both `latest` and the exact short SHA, and
fails if the deployed HTTP smoke check fails:

```bash
export CATALOG_BASE_URL=https://<assigned-catalog-domain>
export SMOKE_PRODUCT_ID=<real-id-from-loaded-first-page>
bash scripts/deploy.sh
```

The helper tags locally; registry publication is pending the team's registry choice.
Preserve SHA-tagged images for rollback. After success, record the helper's branch, full
SHA, short tag and UTC time in the status table above, along with the verified base URL
and actual hosting target. Never label a failed smoke run as a successful deployment.

```bash
docker compose stop
docker compose start
docker compose restart
docker compose logs -f ekt-catalog-service
```

For updates, check out the approved branch, `git pull --ff-only`, then rerun
`bash scripts/deploy.sh` with the base URL and product ID configured. The script builds
before replacing the service; a failed build/test leaves the previous service untouched.
A failure after container replacement requires inspection/rollback; there is no automatic
rollback or zero-downtime guarantee.

Rollback to an existing known-good image without rebuilding:

```bash
IMAGE_TAG=<known-good-short-sha> docker compose up -d --no-build --pull never
python3 scripts/smoke.py "$CATALOG_BASE_URL" "$SMOKE_PRODUCT_ID"
docker compose ps
```

Keep configuration compatible with the chosen image. Record the rollback revision/time;
do not retag an unrelated image as the requested SHA.

## Health, HTTPS and client access

- `GET /health/live`: 200 when the process can serve HTTP. Never contacts EKT/OpenAI.
- `GET /health/ready`: 200 after startup with a configured catalog adapter; 503 when
  the source is disabled. Does not load a snapshot or probe upstream networks. A configured
  but unavailable source can be ready and return explicit 503/502 errors on catalog calls.
- Check both paths on the actual deployment URL. Use liveness for process monitoring and
  readiness for routing; monitor Catalog GET failures separately.

The Compose port binds only to loopback by default. Put a TLS reverse proxy on the host
in front of that port, or use the selected platform's HTTPS termination. Configure DNS,
certificate renewal, HTTPS forwarding and health probes there. No proxy/domain has been
provisioned or verified yet. If the proxy runs in another container, attach it to a private
Docker network and route to `ekt-catalog-service:8080`; do not assume its loopback is the host.
Expose only the consumer interface. EKT credentials and OpenAI tokens stay server-side.

Configure the client chat's backend base URL to the assigned HTTPS origin. The client
implementation/configuration variable is owned by its issue; this change does not invent
one in client code. Configure `CATALOG_CORS_ORIGINS` to the exact chat origin if the browser
calls the API directly. Same-origin deployments need no CORS setting. CORS is not authentication;
the public demo's access policy/rate limiting must be chosen on the hosting platform,
especially before enabling the paid AI-search endpoint.

Existing routes remain:

```text
GET /api/catalog/products/{id}
GET /api/catalog/products?query={query}
GET /api/catalog/products/{id}/availability
GET /api/catalog/products/{id}/analogs
```

Analog selection still returns an explicit insufficient-data error (422 for a loaded
product), not fabricated results. Catalog source errors preserve the existing 503/502
contract; absent stock/price never becomes zero.

## Logging and verification results

Production logback configuration logs startup and fixed catalog/AI failure category codes.
Request URLs, headers, raw product payloads and arbitrary exception messages are not added
to request-failure logs. Compose rotates logs (three 10 MB files). Keep HTTP wire/debug
logging off; do not print process environments or Docker inspection output containing secrets.

Verified locally with JDK 21 and installed Gradle 8.8:

After relocation into the standalone `ekt-catalog-service/` project, `gradle -p
ekt-catalog-service --no-daemon test serverDist installDist` passed all 67 tests.
The HTTP verifier and CLI launcher were also checked using the new paths.

- `gradle --no-daemon test serverDist`: **67 tests passed**,
  including three new health/CORS tests; wrapper generated with Gradle 8.8.
- `python3 scripts/verify-local.py`: actual packaged JVM server served liveness/readiness,
  product 45357, search and availability over HTTP; normalized metadata and unknown stock
  preserved; analog route returned 422.
- Unavailable snapshot returned explicit `UPSTREAM_UNAVAILABLE` 503. Disabled source
  returned `CATALOG_NOT_READY` 503 and readiness 503 while liveness stayed 200.
- Missing live EKT credentials, invalid port and credential-bearing CORS origin all failed
  startup with nonzero exit. The invalid origin's secret text was not reflected.
- Application logs inspected by the local verifier contained startup messages and no
  Authorization/Bearer headers. No real credentials were used, so this does not certify
  secret handling of a live upstream deployment.
- CORS exact-origin response, rejected foreign origin, no credential permission, and POST
  preflight were tested in Ktor's test host.

The GitHub workflow builds/tests the image and starts a temporary snapshot container for
HTTP smoke verification. It does not deploy to production without a selected target.
Remote Docker build/run, live EKT GET, live secret/log inspection, HTTPS, stable chat URL,
release from `main`, and real redeploy/rollback remain unverified. Complete those checks
on the selected host and update this record before closing Issue 7.
