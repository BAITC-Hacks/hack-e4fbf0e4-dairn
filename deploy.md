# EKT deployment status

The Assistant service is implemented and runnable as API plus worker. Both use the same image and share a service-owned SQLite/data volume.

```sh
docker compose -f assistant-service/compose.yaml up -d --build --wait
```

API: http://localhost:8000; docs: http://localhost:8000/docs. Full configuration and local-development instructions are in [Assistant README](assistant-service/README.md).

The explicit harness runtime manifest now points to this Compose file. The root `docker-compose.yml` still runs harness tooling and is not the application runtime. The frontend has a separate `frontend-service/docker-compose.yml`; its deployment is present but not verified by this audit. The Catalog provider has not been implemented.

Defaults use synthetic catalog data, grounded template answers and a demo cart. Set an internal Catalog URL/token for HTTP mode, optional model credentials for model generation, and approved purchase policies in `assistant-service/config/policies.json`. HTTP catalog mode requires cart mode disabled until the real partner cart adapter exists. Website bootstrap and identity mapping must be integrated before real cart access.

Verification: 16 Assistant integration tests and 11 harness tests pass. Earlier Docker smoke checks exercised all supported document formats and a demo cart transaction. Production hosting, TLS, backup/recovery, multi-host scaling and live-partner acceptance remain open; a successful metadata validation is not production certification.
