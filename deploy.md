# EKT deployment status

Application deployment is not implemented yet. The proposed runtime consists of `catalog-service`, `assistant-service`, and a static chat widget; see [architecture](docs/architecture.md) and [EKT-11 in the plan](planning/ekt-plan.json).

The current `Dockerfile` and `docker-compose.yml` run the development harness only. Running them does not launch the EKT assistant.

Before application deployment, add real service images and health checks, private catalog-to-assistant networking, website session integration, service-owned storage, temporary upload expiry, and secret injection for `EKT_API_USERNAME`, `EKT_API_PASSWORD`, model access and internal service authentication. Configure partner versus demo cart mode explicitly. Document migrations, startup, smoke checks and rollback after implementation.

Partner cart endpoints, identity bootstrap, atomic stock enforcement and current-cart URL behavior must be confirmed before enabling live cart writes. No payment data should be collected or stored.
