# hack-e4fbf0e4-dairn


Hackathon team repository for DAIRN: EKT website assistant.

Start with the [developer handoff](docs/developer-handoff.md), [architecture](docs/architecture.md), [complete case brief](hackathon-task.json), and [application task plan](planning/ekt-plan.json).

The proposed application has two backend services: catalog integration/search and assistant/chat/cart orchestration. The chat widget is a frontend client. The React frontend scaffold is self-contained in `frontend-service/`. The root `docker-compose.yml` runs all three microservices plus the assistant worker on a shared Docker network. See [Ubuntu deployment](deploy.md) for required `.env` values, published ports and startup commands. `frontend-service/docker-compose.yml` runs the independent frontend preview and checks.

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


## Frontend application

The self-contained React + TypeScript + Vite application lives in `frontend-service/`. The EKT-inspired demo page has a responsive bottom-right chat widget connected to the Assistant API. Read [frontend instructions](frontend-service/README.md) for configuration, workflows, and test commands.

Start both the API and attachment/message worker with cart links pointing to the same frontend origin:

```sh
ASSISTANT_FRONTEND_BASE_URL=http://localhost:5173 docker compose -f assistant-service/compose.yaml up --build -d --wait
docker compose -f frontend-service/docker-compose.yml up --build -d --wait frontend
# Open http://localhost:5173
```

Default catalog data and cart operations are synthetic demonstrations. The widget labels them accordingly. It does not implement a payment form or partner checkout. Partner credentials and model keys remain on the backend.

```sh
docker compose -f frontend-service/docker-compose.yml run --build --rm frontend-test
docker compose -f frontend-service/docker-compose.yml run --build --rm frontend-e2e
```

Репозиторий команды хакатона DAIRN. В этой ветке расположен автономный сервис каталога EKT
и документация его текущего контракта.

## Быстрый старт

Требуются JDK 21 и Gradle 8.8. Из корня репозитория:

```sh
cd ekt-catalog-service
sh ./gradlew test serverDist
```

Сервер запускается отдельной задачей:

```sh
gradle runServer
```

По умолчанию он доступен только на `127.0.0.1:8080`. Для запуска на сохранённой странице
каталога укажите `CATALOG_SOURCE=snapshot` и путь `CATALOG_SNAPSHOT_PATH`; подробности — в
[контракте API](docs/API.md). Для live-режима нужны переменные EKT в окружении процесса;
их нельзя добавлять в Git, аргументы команд или документацию.

## Состав

- [ekt-catalog-service](ekt-catalog-service/README.md) — Kotlin/Ktor сервис, CLI, Gradle,
  Docker/Compose и скрипты проверки;
- [Catalog API](docs/API.md) — публичные маршруты и значения отсутствующих данных;
- [Данные EKT](docs/EKT_DATA.md) — границы и поля изученного образца списка товаров;
- [AI-поиск](docs/AI_SEARCH.md) — ограниченный сценарий поиска кандидатов через OpenAI;
- [Развёртывание](docs/DEPLOYMENT.md) — локальная проверка, контейнеризация и условия
  production-развёртывания;
- [Комментарии по документации](docs/WORK_COMMENTS.md) — открытые ограничения и следующие
  шаги по итогам чтения этой ветки.

## Важные ограничения

Сервис проверен на сохранённом образце первой страницы из 20 товаров. Это частичный охват,
а не подтверждение живого доступа к EKT, полной пагинации или схемы деталей товара. Описания
и характеристики из карточки нужны каталогу, но должны поступать отдельно: свободный текст
описания не следует автоматически представлять как структурированные характеристики.

Фильтр EKT «В наличии» сам по себе не подтверждает количество остатков. Пока отдельное
числовое поле API не проверено, доступность следует передавать как «есть / нет / неизвестно»,
а количество оставлять неизвестным.

AI-поиск формирует только потенциальных кандидатов. Он не подтверждает техническую
совместимость, актуальное наличие или цену и не заменяет правила каталога.

