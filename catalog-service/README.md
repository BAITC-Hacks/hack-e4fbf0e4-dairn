# EKT Catalog Integration — Issue #2

Kotlin/JVM-модуль с EKT-клиентом, CLI и нормализацией сохранённой первой страницы. В этой ветке нет HTTP/Ktor сервера и AI-предвалидации.

Issue #2 ещё не завершён: есть образец страницы 1, но нет подтверждённых результатов страницы 2, деталей нескольких товаров и ошибок реального API. Валюта, наличие и структурированные характеристики пока неизвестны.

## Сборка

Требуются JDK 21 и установленный Gradle 8.8; wrapper отсутствует.

```sh
gradle :catalog-service:test :catalog-service:installDist
```

## Нормализованный каталог

`CatalogSources.fromEnvironment()` возвращает `NormalizedCatalog` с suspend-операцией `snapshot()`. Потребитель получает Product и метаданные без raw JSON.

Режимы: `CATALOG_SOURCE=disabled` (по умолчанию, возвращает null), `snapshot` (требует `CATALOG_SNAPSHOT_PATH`), `live` (требует переменные EKT).

Загрузка ограничена первой страницей, по умолчанию 100 товарами (`CATALOG_MAX_PRODUCTS`, 1–1000), 35 секундами (`CATALOG_LOAD_TIMEOUT_MS`, 1–120000) и кешем 60 секунд (`CATALOG_CACHE_TTL_SECONDS`, 1–3600). Неудачное обновление возвращает ошибку; старые данные не выдаются как свежие. Охват всегда ограничен первой страницей, полнота каталога не установлена.

Snapshot не имеет подтверждённого времени получения у источника: observedAt и expiresAt равны null, loadedAt означает только локальную загрузку. В live-режиме observedAt означает время получения ответа, а не обновления товара у EKT.

Mapping: id → строковый id, article → sku, name → name, price → точный BigDecimal с неизвестной валютой, image → images, url → pageUrl. Пропуск цены остаётся null, null изображения — пустой список. offers не интерпретируется как остатки; availability всегда UNKNOWN, quantity=null. Некорректные значения и дубликаты ID вызывают явную ошибку. Детали доступны только через raw CLI; типизированной нормализации деталей пока нет.

Исходная схема: [EKT_DATA.md](../docs/EKT_DATA.md). Журнал: [api-findings.md](docs/api-findings.md). Проверенный образец без credentials находится в тестовых ресурсах, оригинальные local-evidence файлы игнорируются Git.

### CLI: получение данных из терминала

Установите JDK 21 и Gradle 8.8; wrapper в репозитории отсутствует. Все команды ниже выполняются из корня репозитория. CLI не запускает Ktor и не скачивает весь каталог автоматически.

Для ввода выданных логина и пароля непосредственно при запуске:

```sh
gradle --quiet :catalog-service:installDist
bash catalog-service/bin/ekt-cli list --page 1 --output catalog-service/local-evidence/products-page-1.json
bash catalog-service/bin/ekt-cli list --page 2 --output catalog-service/local-evidence/products-page-2.json
bash catalog-service/bin/ekt-cli detail --id '<real-product-id>' --output catalog-service/local-evidence/product-detail.json
```

Замените `<real-product-id>` на ID из полученного списка. Bash-запускник использует `https://ekt.kz` по умолчанию, запрашивает недостающие login/password через терминал, скрывает пароль и передаёт значения существующему Kotlin CLI только через окружение. Ввод не записывается в историю команд или файлы; credentials сохраняются лишь на время процесса. При следующем запуске потребуется повторный ввод, если переменные не экспортированы заранее. Пароль нельзя передавать аргументом. Без терминала используйте заранее настроенное окружение; запрос ввода завершается безопасной ошибкой с кодом 2. `--help` не запрашивает credentials. Пути экспорта разрешаются от текущего каталога терминала. Прямой `gradle ...:run` сам credentials не спрашивает — для него используйте настройку окружения ниже.

Справка работает без конфигурации и сети после установки зависимостей сборки:

```sh
gradle --quiet :catalog-service:run --args='--help'
```

Безопасная интерактивная настройка в Bash (ввод пароля скрыт; его значение не попадает в командную строку или историю):

```bash
set +x
export EKT_API_BASE_URL=https://ekt.kz
read -r -p 'EKT username: ' EKT_API_USERNAME
read -r -s -p 'EKT password: ' EKT_API_PASSWORD
printf '\n'
export EKT_API_BASE_URL EKT_API_USERNAME EKT_API_PASSWORD
```

Создание `.env` само по себе **не настраивает CLI**: загрузка `.env` не реализована. Конфигурация читается через `EktConfig` из окружения процесса. Credentials не нужно передавать в чат.

```sh
gradle --quiet :catalog-service:run --args='list'
gradle --quiet :catalog-service:run --args='list --page 1'
gradle --quiet :catalog-service:run --args='list --page 2'
gradle --quiet :catalog-service:run --args='detail --id <real-product-id>'
gradle --quiet :catalog-service:run --args='list --page 1 --output catalog-service/local-evidence/products-page-1.json'
```

Замените `<real-product-id>` настоящим ID, полученным из списка. `list` вызывает `/api/products`, `--page` добавляет параметр страницы, `detail` вызывает `/api/products/detail?id=...` с кодированием ID. `--output` доступен обеим командам. Номер страницы должен быть положительным целым; неизвестные/повторные опции и отсутствующие значения отклоняются до запроса.

Задача Gradle `run` явно использует корень репозитория как рабочий каталог, поэтому относительный путь из примера не удваивает `catalog-service/`.

Для чистого stdout без сообщений сборки используйте установленный дистрибутив:

```sh
gradle --quiet :catalog-service:installDist
catalog-service/build/install/catalog-service/bin/catalog-service --help
catalog-service/build/install/catalog-service/bin/catalog-service list --page 1
catalog-service/build/install/catalog-service/bin/catalog-service detail --id '<real-product-id>' --output catalog-service/local-evidence/product-detail.json
```

Дистрибутив разрешает относительные пути от текущего каталога терминала. Без `--output` stdout содержит только успешный JSON, stderr — операцию, результат и HTTP status, если он получен. HTTP-статус доступен и при отклонении полученного JSON; при таймауте/сетевой ошибке его может не быть. Успешный JSON сохраняет исходные поля, значения и форматирование; в конце добавляется перевод строки. Это локальный raw-экспорт для исследования, **не** Product-контракт для Issue #3 или AI. До проверки схемы HTTP 200 с JSON-объектом означает успешное получение данных, но не доказательство, что объект содержит товары, а не прикладную ошибку EKT.

С `--output` stdout пуст, родительские каталоги создаются только после успешного получения JSON. Полный UTF-8 файл публикуется без перезаписи через hard link из временного файла в том же каталоге; временный файл удаляется. Требуется файловая система с поддержкой hard links, иначе возвращается ошибка. Существующие файлы, каталоги и символические ссылки не заменяются; выбирайте новое имя для каждого наблюдения. Не используйте shell-перенаправление `> evidence.json`, если требуется защита от перезаписи: оно обходит гарантии `--output`.

| Код CLI | Значение |
| --- | --- |
| 0 | Успех / справка |
| 2 | Ошибка аргументов или конфигурации |
| 3 | Ошибка EKT, сети, таймаут или невалидный JSON |
| 4 | Ошибка записи/доступа, существующий файл, неподдерживаемый экспорт |
| 1 | Непредвиденная ошибка с безопасным сообщением |

Эти коды возвращает исполняемый дистрибутив. Gradle считает ненулевой код дочернего процесса ошибкой задачи и может вернуть собственный код 1; для автоматизации используйте дистрибутив. Диагностика не печатает ID, пути вывода, credentials, Authorization, произвольные исключения или тела ошибок источника. Raw JSON намеренно направляется только в выбранный пользователем вывод; перед передачей/коммитом его нужно отдельно проверить. `local-evidence/` уже игнорируется Git.

После работы можно удалить credentials из окружения текущего shell:

```sh
unset EKT_API_BASE_URL EKT_API_USERNAME EKT_API_PASSWORD
```
