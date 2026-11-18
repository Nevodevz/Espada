# Espada — production-деплой

Production-стек: PostgreSQL 16, FastAPI, Next.js, MCP и nginx. Все сервисы
запускаются через Docker Compose, TLS-сертификат хранится на хосте в
`/etc/letsencrypt`.

## Требования

- Ubuntu 24.04 или совместимый Linux-сервер;
- Docker с командой `docker compose`;
- certbot;
- открытые TCP-порты 22, 80 и 443;
- DNS A-запись `espada.anti-flow.com`, указывающая на сервер.

## Конфигурация новой установки

Создайте `.env` рядом с `docker-compose.yml`. Файл не должен попадать в Git.

```dotenv
COMPOSE_PROJECT_NAME=espada
POSTGRES_USER=espada
POSTGRES_PASSWORD=<openssl rand -hex 32>
POSTGRES_DB=espada
SECRET_KEY=<openssl rand -hex 32>
INITIAL_USER_PASSWORD=<случайный одноразовый пароль>
ENVIRONMENT=production
FRONTEND_URL=https://espada.anti-flow.com
MEDIA_ROOT=/app/media
MCP_ALLOWED_HOSTS=espada.anti-flow.com,localhost:9000,127.0.0.1:9000
MCP_ALLOWED_ORIGINS=https://espada.anti-flow.com
```

`INITIAL_USER_PASSWORD` используется только при первом заполнении пустой базы.
После первого входа смените пароли пользователей через Espada.
Новые предсозданные логины используют `@espada.kg`; существующие адреса
сотрудников при обновлении не меняются.

## Первый сертификат

Создайте `/var/www/certbot` и временно поднимите HTTP-сервер, который отдаёт
`/.well-known/acme-challenge/` из этой директории. Затем запросите сертификат:

```bash
certbot certonly --webroot -w /var/www/certbot \
  -d espada.anti-flow.com --agree-tos --non-interactive
```

Для автоматического продления должен быть включён `certbot.timer`. Конфигурация
nginx монтирует `/etc/letsencrypt` только для чтения и постоянно обслуживает
ACME-путь через `/var/www/certbot`.

## Запуск и проверка

```bash
docker compose --env-file .env up -d --build
docker compose --env-file .env ps
docker compose --env-file .env exec backend alembic current
curl -fsS https://espada.anti-flow.com/api/health
docker compose --env-file .env exec mcp curl -fsS http://localhost:9000/healthz
```

Миграции и идемпотентное начальное заполнение базы выполняются entrypoint-скриптом
backend. Данные PostgreSQL и загруженные аватары хранятся в именованных томах
`espada_pgdata` и `espada_media`.
Это имена томов для новой установки с `COMPOSE_PROJECT_NAME=espada`.

## Обновление

Загрузите новый проверенный release, сохраните production `.env` и запустите:

```bash
docker compose --env-file .env up -d --build
```

Перед обновлением сделайте резервную копию:

```bash
docker compose --env-file .env exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > espada-backup.sql
```

Не используйте `docker compose down -v` в production: ключ `-v` удаляет базу и
загруженные медиа.

## Переход существующей установки на Espada

1. Сохраните действующий `.env` и резервную копию БД. Не заменяйте `.env`
   новым примером: `POSTGRES_USER`, `POSTGRES_DB`, пароль, `SECRET_KEY` и
   `COMPOSE_PROJECT_NAME` должны сохранить прежние значения. Если имя Compose
   ранее выводилось из директории, явно укажите существующее имя проекта
   (проверьте `docker compose ls`) до изменения директории. Иначе Compose
   создаст пустые тома вместо подключения прежней базы и аватаров.
2. Настройте DNS `espada.anti-flow.com` и выпустите сертификат для этого имени
   до запуска обновлённого nginx. Согласуйте `FRONTEND_URL`, `MCP_ALLOWED_HOSTS`
   и `MCP_ALLOWED_ORIGINS` с новым доменом, как в примере выше.
3. Выполните обновление. Миграция `020` переименует штатный раздел в
   **Espada Labs**, сохранив его ID, участников и доски. Только неизменённый
   начальный текст «О компании» будет обновлён; пользовательский текст
   сохраняется. Откат этой миграции: `alembic downgrade 019`.
4. Старые пути `/dept/nevolabs` и `/dept/nevolabs/<id>` перенаправляются на
   `/dept/espadalabs`; API продолжает принимать старый slug отдела.
   Действующие ключи `nvo_...` работают, новые ключи начинаются с `esp_`.
   В AI-клиентах замените URL на `https://espada.anti-flow.com/mcp`, имя
   подключения — `espada`, переменную окружения — `ESPADA_API_KEY`.
5. На прежнем origin токен входа и тема автоматически переносятся на ключи
   `espada_token` и `espada_theme`. При смене домена браузер изолирует
   localStorage: нужно войти заново и выбрать тему на новом адресе.

Переименование репозитория не меняет DNS, сертификаты, GitHub remote или
имя уже существующего Docker-проекта автоматически.

## Shared-хост за Cloudflare Tunnel (OMV)

На сервере, где порты 80/443 заняты другими проектами, а TLS терминирует
Cloudflare Tunnel, используйте override `docker-compose.tunnel.yml`: nginx
работает только по HTTP (`nginx/nginx.tunnel.conf`), не публикует порты на хост
и подключается к общей внешней docker-сети `EDGE_NETWORK` (по умолчанию `edge`),
где живёт контейнер cloudflared. В этой сети он доступен как `espacrm-nginx:80`.

`.env` дополнительно к обычным переменным:

```dotenv
COMPOSE_PROJECT_NAME=espacrm
COMPOSE_FILE=docker-compose.yml:docker-compose.tunnel.yml
EDGE_NETWORK=edge
FRONTEND_URL=https://espacrm.espada.kg
MCP_ALLOWED_HOSTS=espacrm.espada.kg,localhost:9000,127.0.0.1:9000
MCP_ALLOWED_ORIGINS=https://espacrm.espada.kg
```

С `COMPOSE_FILE` в `.env` достаточно обычных `docker compose up -d --build`.
В Cloudflare Zero Trust добавьте Published application route
`espacrm.espada.kg` → `http://espacrm-nginx:80`.

### Восстановление из дампа (pg_dump -Fc)

Восстанавливайте в пустую базу **до** первого запуска backend, иначе seed
создаст демо-данные:

```bash
docker compose up -d db
docker compose exec -T db pg_restore -U espada -d espada \
  --no-owner --no-privileges --exit-on-error < espada.dump
docker compose up -d --build
```
