# Ubuntu deployment

The root `docker-compose.yml` runs the frontend, Catalog API, Assistant API and the
assistant's required background worker. Service-local Compose files remain available
for independent development:

- `frontend-service/docker-compose.yml`
- `ekt-catalog-service/compose.yaml`
- `assistant-service/compose.yaml`
- `docker-compose.yml` (combined application)

Install Docker Engine and the Compose plugin using the
[official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
Clone this repository onto the server, then run from its root:

```sh
cp .env.example .env  # Only on a fresh checkout; preserve an existing .env.
chmod 600 .env
nano .env
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 180
docker compose ps
```

Set `EKT_API_USERNAME` and `EKT_API_PASSWORD` to valid partner credentials and set
`PUBLIC_FRONTEND_URL=http://YOUR_SERVER_IP:5173` (or your public domain/origin,
without a trailing slash). Credentials are required; Compose fails early if blank.
The root `.env` is gitignored; `.env.example` contains the portable variable list.
Optional model keys and model names are documented there. No service-local `.env`
files are needed. Docker builds supply the runtimes; the host needs no Node, Java or Python.

| Component | Public URL with default ports | Docker address |
| --- | --- | --- |
| Frontend | `http://SERVER_IP:5173` | `http://frontend:8080` |
| Assistant API/docs | `http://SERVER_IP:8000/docs` | `http://assistant-service:8000` |
| Catalog API | `http://SERVER_IP:8080/api/catalog/products` | `http://ekt-catalog-service:8080` |

All containers share the `ekt` bridge network. The browser calls `/assistant/`
on its current frontend origin; Nginx forwards to the Assistant API using Docker DNS.
The assistant and worker call the Catalog API over Docker DNS, independently of
published host ports. The worker needs no public port. Nginx serves built static
files and supports SPA routing, uploads and unbuffered API responses; see
[Nginx proxy documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

Host ports and the bind address are configurable in `.env`. Allow the selected
TCP ports in the server/provider firewall. Docker publishes them on all IPv4
interfaces by default; Docker-published ports can bypass UFW rules, so use the
provider firewall or Docker-compatible firewall rules as described in the Docker
installation guide. HTTP is configured here; terminate TLS before sending real
account credentials over the public Internet. Direct Catalog API access currently
has no authentication.

The assistant runs in production mode with demo sessions and synthetic fallbacks
disabled. Users register/sign in through the frontend. The bootstrap secret is
optional and backend-only. Live catalog mode disables cart operations because no
partner cart adapter exists. Catalog readiness validates configuration, not actual
partner credentials or upstream availability; verify a product request after startup:

```sh
curl --fail http://localhost:5173/health/live
curl --fail http://localhost:5173/assistant/health/live
curl --fail http://localhost:8000/health/live
curl --fail http://localhost:8080/health/ready
curl --fail 'http://localhost:8080/api/catalog/products?query=cable'
docker compose logs --tail=100
```

Containers restart unless stopped and logs rotate. Assistant API and worker share
SQLite/uploads in the persistent `assistant-data` volume. Back up that volume with
both assistant processes stopped for a consistent SQLite copy. `docker compose down`
preserves data; `docker compose down -v` deletes it. Keep this stack on a single
host and do not scale the worker/API without reviewing SQLite concurrency.

After configuration or code changes, run `docker compose up -d --build --wait`.
Changes to `VITE_CERTIFICATE_ORIGINS` require a frontend rebuild; changing the public
hostname does not because the frontend uses the same-origin proxy.
