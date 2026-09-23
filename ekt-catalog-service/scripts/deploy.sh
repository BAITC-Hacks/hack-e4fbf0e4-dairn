#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test -f .env || { echo 'Create .env from .env.example and configure it first.' >&2; exit 1; }
test -z "$(git status --porcelain)" || { echo 'Commit/review changes before producing a SHA-tagged deployment.' >&2; exit 1; }
: "${SMOKE_PRODUCT_ID:?Set SMOKE_PRODUCT_ID to a real product ID in the loaded first page}"
: "${CATALOG_BASE_URL:?Set CATALOG_BASE_URL to the deployment HTTP(S) base URL}"
export IMAGE_TAG
IMAGE_TAG=$(git rev-parse --short HEAD)
docker compose build --pull
docker tag "ekt-service-catalog:$IMAGE_TAG" ekt-service-catalog:latest
docker compose up -d --no-build
docker compose ps
for attempt in $(seq 1 30); do
    if python3 scripts/smoke.py "$CATALOG_BASE_URL" "$SMOKE_PRODUCT_ID"; then
        printf 'Verified deployment: branch=%s commit=%s image=ekt-service-catalog:%s time=%s\n' \
            "$(git branch --show-current)" "$(git rev-parse HEAD)" "$IMAGE_TAG" "$(date -u +%FT%TZ)"
        exit 0
    fi
    sleep 2
done
echo 'Smoke test failed; inspect service logs and roll back. Deployment is not verified.' >&2
exit 1
