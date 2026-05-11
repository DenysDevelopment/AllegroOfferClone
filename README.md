# Allegro Clone Console

Web-инструмент для клонирования оферт на Allegro с автоматической заменой параметров (основной кейс: смена объёма SSD `256 GB → 512 GB`).

> Эквивалент **«Wystaw podobną»** в UI Allegro, но через API: один клик в браузере вместо ручного копирования.

## Что внутри

```
.
├── server/          # Express + TypeScript: OAuth2, Allegro API client, clone logic
├── web/             # React + Vite + Tailwind: операторская консоль (тёмная тема)
├── data/            # Хранилище токенов (создаётся автоматически, в .gitignore)
├── Dockerfile       # Multi-stage build для VPS
└── docker-compose.yml
```

## Стек

- **Backend:** Node.js 20+, Express, axios, zod, p-retry
- **Frontend:** React 18, Vite, TailwindCSS, IBM Plex Sans/Mono
- **OAuth:** Authorization Code Flow + auto-refresh
- **Хранение токенов:** локальный файл `data/tokens.<env>.json` (mode 0600)
- **Тесты:** vitest

---

## 1. Регистрация Allegro-приложения

Перед запуском нужны `client_id` и `client_secret`. Создавайте **два** приложения — одно для Sandbox, одно для прода.

### Sandbox (для отладки)
1. Зайди на https://apps.developer.allegro.pl
2. **Create new application** → отметь галочку **«Aplikacja w środowisku Sandbox»**
3. Тип: **Aplikacja webowa**
4. **Redirect URI:** `http://localhost:3000/api/auth/callback` (для локального запуска)
   - Для VPS добавь второй URI: `https://your-domain.tld/api/auth/callback`
5. Скопируй `Client ID` и `Client Secret`

### Production (когда Sandbox прогон будет чистый)
То же самое, но без галочки Sandbox.

---

## 2. Локальный запуск (для разработки)

```bash
# 1. Клонируй и установи зависимости
npm install

# 2. Создай .env из примера
cp .env.example .env
# Открой .env и впиши:
#   ALLEGRO_ENV=sandbox
#   ALLEGRO_SANDBOX_CLIENT_ID=...
#   ALLEGRO_SANDBOX_CLIENT_SECRET=...
#   PUBLIC_URL=http://localhost:3000

# 3. Запусти сервер + Vite в dev-режиме
npm run dev

# Откроется два процесса:
#  - server  : http://localhost:3000  (Express)
#  - web     : http://localhost:5173  (Vite, проксирует /api на :3000)
```

Открой `http://localhost:5173`, нажми **Connect** — пройдёт стандартный OAuth: Allegro → callback → токены лягут в `data/tokens.sandbox.json`.

### Тесты

```bash
npm test
# или
npm run test:watch -w server
```

---

## 3. Использование

### 3.1. Подключение к Allegro
- Кнопка **Connect** в правом верхнем углу запустит OAuth-флоу.
- После успешного логина в шапке появится зелёный pill `CONNECTED` и пометка `SANDBOX`/`PRODUCTION`.

### 3.2. Клонирование оферты
1. Введи `Offer ID` источника → **Load** — подгрузится preview (название, цена, текущие параметры).
2. В блоке **Parameter overrides** добавь, что хочешь поменять:
   - Поле **Parameter name** — имя параметра как в Allegro (например, `Pojemność dysku SSD`).
   - Поле **New value** — новое значение (например, `512 GB`).
   - Есть пресеты: `SSD → 512 GB`, `SSD → 1 TB`, `RAM → 32 GB`.
3. (опционально) В блоке **03 · Optional overrides** можно задать новый title, цену, сток, статус публикации.
4. **Dry run** — соберёт тело POST-запроса без отправки. Полезно проверить, что всё ок.
5. **Clone offer →** — реально создаст новую оферту.

### 3.3. Что произойдёт под капотом
```
GET /sale/product-offers/{id}             — забираем источник
GET /sale/products/{productId}            — деталь продукта
GET /sale/products?phrase=...&category=…  — ищем карточку с новыми параметрами
POST /sale/product-offers                 — создаём клон
GET /sale/offer-publication-commands/{id} — polling (если 202)
```

Если карточка с нужным параметром найдена в каталоге Allegro — подменяется `productSet[0].product.id`. Если нет — отправляется полный `parameters[]`, и Allegro либо подбирает существующий продукт, либо создаёт новый.

По умолчанию новая оферта создаётся в статусе **INACTIVE** (черновик) — оператор может проверить и активировать вручную в Allegro UI. Это безопаснее, чем сразу `ACTIVE`.

---

## 4. Деплой на VPS

### 4.1. Подготовка
- Любой VPS с Docker (Ubuntu 22.04+ / Debian 12+ — ок).
- Домен с SSL (обычно через Caddy / Nginx + Let's Encrypt). OAuth-callback **обязан** быть HTTPS в проде.
- Открой 80/443 в firewall.

### 4.2. Запуск через docker-compose

```bash
# На VPS:
git clone <this-repo>
cd allegro-clone
cp .env.example .env

# Отредактируй .env — установи:
#   ALLEGRO_ENV=production
#   ALLEGRO_PROD_CLIENT_ID=...
#   ALLEGRO_PROD_CLIENT_SECRET=...
#   PUBLIC_URL=https://your-domain.tld
#   SESSION_SECRET=<длинная случайная строка>

docker compose up -d --build
docker compose logs -f
```

Папка `./data` примонтирована в контейнер — токены переживают рестарт.

### 4.3. Reverse proxy (пример Caddy)

`Caddyfile`:
```
your-domain.tld {
  reverse_proxy localhost:3000
}
```

### 4.4. Регистрация Redirect URI на Allegro
В настройках production-приложения на apps.developer.allegro.pl добавь:
```
https://your-domain.tld/api/auth/callback
```
**Точное совпадение** обязательно (включая trailing slash — лучше без него).

### 4.5. CI/CD через GitHub Actions

Workflow: [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml). На каждый PR и push в `main` гоняются lint/test/build + sanity-сборка Docker. На push в `main` — пуш образа в GHCR и автодеплой на VPS по SSH.

**Pipeline:**
```
test (PR + push main) ──▶ build-and-push (push main) ──▶ deploy (push main)
   lint, vitest,            ghcr.io push: latest +         ssh root@VPS:
   tsc+vite, docker build   sha-<short>                   git pull
                                                          docker compose pull
                                                          docker compose up -d
                                                          health check /api/health
```

**Что нужно настроить один раз:**

1. **GitHub Actions secrets** (Settings → Secrets and variables → Actions → New repository secret):
   - `VPS_HOST` — `173.242.62.97`
   - `VPS_USER` — `root`
   - `VPS_SSH_KEY` — полный приватный SSH-ключ (включая `-----BEGIN OPENSSH PRIVATE KEY-----` / `END`), без passphrase, чей публичный ключ лежит в `/root/.ssh/authorized_keys` на VPS.

   Сгенерировать пару (локально):
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/allegro_ci -C "github-actions" -N ""
   # Положи публичный на VPS:
   ssh-copy-id -i ~/.ssh/allegro_ci.pub root@173.242.62.97
   # Скопируй приватный в GitHub secret VPS_SSH_KEY:
   cat ~/.ssh/allegro_ci
   ```

2. **Сделать GHCR-пакет публичным** (после первого успешного push в `main`):
   - Открой `https://github.com/users/DenysDevelopment/packages/container/allegroofferclone/settings`
   - В разделе *Danger Zone* → **Change visibility** → *Public*. Иначе VPS не сможет `docker compose pull` без `docker login`.

3. **На VPS должен быть проект в `/opt/allegro-clone`** (он там уже есть после `deploy-vps.sh`). Деплой делает `git pull` (для актуального `docker-compose.yml`) + `docker compose pull` (образ из GHCR).

**Откат на предыдущую версию:**
```bash
# На VPS:
cd /opt/allegro-clone
docker pull ghcr.io/denysdevelopment/allegroofferclone:sha-<short>
docker tag ghcr.io/denysdevelopment/allegroofferclone:sha-<short> ghcr.io/denysdevelopment/allegroofferclone:latest
docker compose up -d
```
Список последних SHA-тегов — на странице пакета в GitHub.

---

## 5. Архитектура

### Поток клонирования
```
[web UI] ──POST /api/clone──▶ [Express] ──▶ [cloneOffer()] ──▶ [AllegroClient]
                                                                   │
                       step log ◀───────────────────────────────────┘
```

### Ключевые модули
- `server/src/core/oauth.ts` — Authorization Code Flow + refresh, кеш в TokenStore.
- `server/src/core/allegro.ts` — axios с retry на 429/5xx, проброс 401 через refresh, типизированные эндпоинты.
- `server/src/core/clone.ts` — `cloneOffer()`, `buildCloneBody()`, замена параметров и матч с каталогом.
- `server/src/routes/api.ts` — REST: `/api/clone`, `/api/clone/preview`, `/api/offers/:id/preview`.
- `web/src/App.tsx` — главный экран: source panel + overrides editor + result feed.

### Важные нюансы
- **Хранение токенов:** файл с `mode: 0600`, в `data/`. Не коммитится в git.
- **State CSRF:** для каждого OAuth-логина генерируется случайный `state`, кладётся в httpOnly cookie, проверяется на callback.
- **Rate limits:** Allegro = ~9000 req/min на приложение. Клон одной оферты ~5-10 запросов. Retry-After соблюдается p-retry.
- **Sandbox quirks:** в песочнице нет реальных платежей/доставок, но валидация `parameters` против каталога такая же — идеально для отладки.

---

## 6. Известные ошибки и как их лечить

| Код | Что значит | Что делать |
|-----|-----------|-----------|
| `401 NOT_CONNECTED` | Токенов нет, юзер не залогинен | Connect → OAuth |
| `422 PARAMETER_MISMATCH` | Параметры не совпадают с каталогом | Запусти Dry run, проверь `body.productSet[0].product.parameters[]` — Allegro строго валидирует. Иногда поможет убрать `product.id` и оставить только `parameters[]`. |
| `422 MISSING_REQUIRED_FIELD` | Не хватает обязательного поля (delivery, warranty, return policy) | Источник был неполный? Заполни Helpers через Allegro UI и склонируй заново. |
| `429` | Rate limit | Подожди, p-retry повторит автоматически. Если массово — дроссель в коде. |

Полный body 4xx-ответа всегда логируется и в браузере (раскрой `detail`), и в stdout сервера.

---

## 7. Дальнейшие планы

- [ ] Streaming (SSE) шагов клонирования вместо одного response в конце
- [ ] Bulk-клонирование (csv: source_id → param_overrides)
- [ ] Hookup с Shopify (sync stock/price)
- [ ] Отдельный экран **Edit existing offer** через `PATCH /sale/product-offers/{id}`

---

## Полезные ссылки

- Allegro Developer: https://developer.allegro.pl/documentation
- Apps management: https://apps.developer.allegro.pl
- Tutorial по клонированию через каталог: https://developer.allegro.pl/tutorials/jak-jednym-requestem-wystawic-oferte-powiazana-z-produktem-D7Kj9gw4xFA
- Sandbox: https://allegro.pl.allegrosandbox.pl
