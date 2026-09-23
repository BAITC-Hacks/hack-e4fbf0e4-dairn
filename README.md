# hack-e4fbf0e4-dairn

Hackathon team repository for DAIRN: EKT website assistant.

Start with the [developer handoff](docs/developer-handoff.md), [architecture](docs/architecture.md), [complete case brief](hackathon-task.json), and [application task plan](planning/ekt-plan.json).

The proposed application has two backend services: catalog integration/search and assistant/chat/cart orchestration. The chat widget is a frontend client. Application implementation is pending; existing Docker configuration runs harness tooling only.

**Planning and contract workflow**

```sh
.venv/bin/python -m pip install -e ".[test,contracts]"
export PYTHONPATH="$PWD/src"
.venv/bin/harness init --project hackathon-task.json
.venv/bin/harness analyze
.venv/bin/harness plan
.venv/bin/harness validate-plan
.venv/bin/harness contract generate
.venv/bin/harness contract validate
.venv/bin/harness contract review
.venv/bin/python -m pytest -q
```

`planning_file` in the brief points to an explicit application plan and takes precedence over inferred Docker services. The plan loads schemas from [CATALOG-API](contracts/catalog.openapi.json) and [ASSISTANT-API](contracts/assistant.openapi.json). Generated local state is stored under gitignored `.harness/`; share the plan, schemas and docs through the repository.

Contracts remain drafts until developer review. After agreement, use `harness contract approve CATALOG-API` and `harness contract approve ASSISTANT-API` to freeze baselines and unblock dependent tasks. `contract mock ID` generates schema metadata, not a running server. `contract test` performs structural checks, not live integration tests. Full OpenAPI validation runs through `tests/test_ekt_openapi.py` when the `contracts` extra is installed.

When schemas change, rerun `plan`; changed contracts return to review and approved baselines are preserved. Use `contract diff ID` and `contract breaking-changes` to inspect compatibility.

Partner credentials belong in server-side environment configuration and must not be committed. Actual catalog payload mapping and partner cart integration remain open; see the [deployment status](deploy.md).

The current `.gitignore` excludes `src/`, so harness source changes are local. The [portable harness patch](planning/harness-explicit-plan.patch) preserves the explicit-plan support for teammates with the original harness. Apply it once to an unmodified matching harness with `git apply planning/harness-explicit-plan.patch`; it is already applied in this workspace. A clean checkout also needs the underlying harness source, which this repository currently excludes.
