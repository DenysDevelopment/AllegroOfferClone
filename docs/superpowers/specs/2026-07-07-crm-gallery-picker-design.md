# Пикер фото из галереи CRM

**Дата:** 2026-07-07
**Ветка:** `feat/crm-gallery-picker`

## Проблема

Оператор фотографирует товар (ноутбуки) и складывает готовые фото в CRM,
разложенные по папкам-моделям (и под-папкам-каналам). Сейчас, чтобы попасть
в галерею оффера, эти фото приходится качать из CRM и заливать вручную через
«+ файлы» / «+ URL». Нужна кнопка **«Из галереи CRM»**: открыть окно с фото из
CRM → отметить нужные → они сами перезальются в Allegro CDN и добавятся в
галерею оффера.

CRM отдаёт для этого read-only REST API, защищённый per-company ключом
(отдельный дизайн на стороне CRM, зафиксирован в Приложении A). Пикер (окно
выбора) строим **у себя** — в стиле инструмента, под тёмную/светлую тему.

## Решение в одной фразе

Наш сервер проксирует read-only эндпоинты галереи CRM (ключ живёт в `.env`,
в браузер не отдаётся); новая модалка `CrmGalleryPicker` рисует папки и фото,
даёт мультивыбор; выбранные публичные CloudFront-URL прогоняются через уже
существующий перезалив в Allegro CDN и дописываются в галерею оффера.

## Архитектура

```
браузер (наш web)              наш сервер                      CRM api
────────────────               ──────────                      ───────
[Из галереи CRM]  ──GET──►  /api/crm/folders     ──Bearer──►  GET /api/v1/gallery/folders
CrmGalleryPicker  ──GET──►  /api/crm/folders/:id ──Bearer──►  GET /api/v1/gallery/folders/{id}[/photos]
     │            ──GET──►  /api/crm/photos?sku= ──Bearer──►  GET /api/v1/gallery/photos?sku=
     │  выбранные url[]
     ▼
ImagesEditor: для каждого url →
   POST /api/images/upload-url  ──►  Allegro CDN  ──►  location
   → append(location) в галерею оффера
```

Ключевые свойства:

- **Ключ CRM (`lgk_live_…`) только на нашем сервере.** Браузер ходит лишь на
  наши `/api/crm/*`. CORS с CRM не нужен (server-to-server).
- **Перезалив — существующий код.** `msg.photos[].url` (публичный CloudFront)
  идёт через `POST /api/images/upload-url` → `AllegroClient.uploadImageByUrl`
  (сервер сам качает байты и грузит в Allegro CDN). Ноль нового кода перезалива.
  Перезаливаем, а не вставляем CloudFront-URL напрямую, — ради консистентности
  с остальными картинками оффера и чтобы листинг не зависел от доступности
  CloudFront.

## Конфигурация

`server/src/config.ts` — в `globalSchema` добавляются два поля:

```ts
CRM_API_URL: z.string().url().optional(),   // напр. https://crm.laptopguru.…
CRM_API_KEY: z.string().optional(),          // lgk_live_… (per-company)
```

В `MultiConfig` добавляется:

```ts
crm?: { apiUrl: string; apiKey: string };   // задан только если обе env заданы
```

Заполняется в `loadMultiConfig()`: если заданы обе переменные — `crm` строится,
иначе остаётся `undefined`. `.env.example` получает секцию:

```
# --- CRM gallery (фото из CRM в галерею оффера) ---
# Базовый URL API CRM и per-company ключ (выдаётся в Настройках CRM, вида lgk_live_…)
CRM_API_URL=
CRM_API_KEY=
```

Если `crm` не сконфигурирован — прокси-роуты возвращают `503
{ error: 'CRM_NOT_CONFIGURED' }`, а кнопка «Из галереи CRM» на фронте не
показывается (см. UI).

## Сервер

### CRM-клиент — `server/src/core/crm.ts` (новый)

Тонкая обёртка над `axios` с базовым URL и `Authorization: Bearer <apiKey>`.
Чистый модуль, тестируемый на замоканном axios.

```ts
export interface CrmPhoto {
  id: string;
  url: string;
  thumbnailUrl: string;
  folderId: string;
  angleId: string | null;
  sortOrder: number;
  createdAt?: string;
  isCover?: boolean;
}
export interface CrmChannel { id: string; name: string; channelKey: string; photoCount: number }
export interface CrmFolderSummary {
  id: string; name: string; vendor?: string; sku?: string;
  photoCount: number;
  cover?: { id: string; url: string; thumbnailUrl: string } | null;
  channels?: CrmChannel[];
}
export interface CrmFolderDetail {
  id: string; name: string; vendor?: string; sku?: string;
  photos: CrmPhoto[];
  channels?: CrmChannel[];
}

export class CrmClient {
  constructor(cfg: { apiUrl: string; apiKey: string });
  listFolders(opts?: { search?: string; limit?: number; cursor?: string }):
    Promise<{ folders: CrmFolderSummary[]; nextCursor: string | null }>;
  getFolder(id: string): Promise<CrmFolderDetail>;             // GET /folders/{id}[/photos]
  photosBySku(sku: string): Promise<CrmFolderDetail>;          // GET /photos?sku=  (404 → throws CrmNotFound)
}
```

Ошибки CRM (`401/403/404/429/5xx`) заворачиваются в типизированную
`CrmApiError { status, message, body }` — по образцу `AllegroApiError`.

### Прокси-роуты — `server/src/routes/api.ts`

`apiRouter(registry, dataDir)` расширяется до `apiRouter(registry, dataDir, crm?)`
(проброс `multi.crm` из `index.ts`). Внутри — фабрика клиента (или один общий
инстанс `CrmClient`, т.к. ключ один на инсталляцию). Каждый роут: если `crm`
не задан → `503 CRM_NOT_CONFIGURED`.

| Метод | Путь | → CRM | Возврат |
|-------|------|-------|---------|
| GET | `/api/crm/folders?search=&cursor=` | `GET /api/v1/gallery/folders` | `{ folders, nextCursor }` |
| GET | `/api/crm/folders/:id` | `GET /api/v1/gallery/folders/{id}/photos` | `CrmFolderDetail` |
| GET | `/api/crm/photos?sku=` | `GET /api/v1/gallery/photos?sku=` | `CrmFolderDetail` (или `404`) |

Роуты — тонкий passthrough (валидируем query через zod, прокидываем в
`CrmClient`, отдаём JSON as-is). Не привязаны к аккаунту Allegro (галерея CRM
от аккаунта не зависит), поэтому picker-запросы **не** требуют `req.allegro`.
Ошибки `CrmApiError` идут в общий error-handler (добавить ветку рядом с
`AllegroApiError` в `index.ts`: `error: 'CRM'`, тот же формат).

## Клиент (web)

### Типы + `api.crm` — `web/src/api.ts`

Зеркалят серверные типы (`CrmPhoto`, `CrmFolderSummary`, `CrmFolderDetail`).
Новая группа рядом с `helpers`:

```ts
crm: {
  folders: (opts?: { search?: string; cursor?: string }) =>
    http<{ folders: CrmFolderSummary[]; nextCursor: string | null }>('/api/crm/folders', { query }),
  folder: (id: string) => http<CrmFolderDetail>(`/api/crm/folders/${id}`),
  photosBySku: (sku: string) => http<CrmFolderDetail>('/api/crm/photos', { query: { sku } }),
}
```

(«CRM включён?» — не в этой группе, а отдельным флагом в bootstrap, см. ниже.)

**Признак «CRM включён» для UI.** `AccountsResponse` (уже грузится на старте
через `/api/auth/accounts`) получает поле `crmConfigured: boolean`. Сервер
проставляет `!!multi.crm`. Так фронт узнаёт, показывать ли кнопку, без
отдельного запроса. (Домен CRM в браузер не нужен — все запросы идут через наш
прокси относительными путями.)

### Компонент `CrmGalleryPicker` — `web/src/components/CrmGalleryPicker.tsx` (новый)

Полноэкранная модалка через `createPortal` (как в `Combobox`), стили —
существующие токены (`panel`, `bg-card`, `border-border`, `btn`, `flame-ring`).
Открывается по кнопке из `ImagesEditor`, закрывается по `Esc` / клику по фону /
крестику.

Раскладка (двухпанельная):

```
┌───────────────────────────────────────────────────────────┐
│  Галерея CRM                    [поиск модели…]        [✕]  │
├───────────────┬───────────────────────────────────────────┤
│ Папки         │  Dell Latitude 7420 · 12 фото             │
│ ▸ Dell 7420   │  ┌──┐ ┌──┐ ┌──┐ ┌──┐  ← сетка, клик=выбор  │
│ ▸ HP 840 G8   │  │▣ │ │  │ │▣ │ │  │     ▣ = отмечено       │
│   каналы:     │  └──┘ └──┘ └──┘ └──┘                        │
│    • Allegro  │  [под-папки-каналы как вкладки/чипы]        │
│    • OLX      │                                             │
├───────────────┴───────────────────────────────────────────┤
│  Выбрано: 3            [Отмена]   [Добавить выбранные (3)]  │
└───────────────────────────────────────────────────────────┘
```

- **Левая панель — папки.** `api.crm.folders()`; поиск (debounce ~300 мс)
  перезапрашивает с `?search=`. Пагинация по `nextCursor` — кнопка «ещё» или
  подгрузка при скролле (для v1 достаточно кнопки «ещё»). Клик по папке →
  `api.crm.folder(id)` грузит фото и `channels`.
- **Каналы (под-папки).** Если у выбранной папки есть `channels[]`, показываем
  их как переключатель источника; клик по каналу → `api.crm.folder(channelId)`
  (эндпоинт ③ работает и для канала). «Все фото модели» — дефолтная вкладка.
- **Правая панель — сетка фото.** Превью из `thumbnailUrl`, клик по плитке
  тогглит выбор (галка/рамка `flame-ring`). Выбор копится в `Set<string>` по
  `photo.id`, но храним и сам `CrmPhoto` (нужен `url`). Порядок добавления =
  порядок кликов.
- **Предзаполнение поиска.** Проп `initialSearch?: string`. Вызывающий (клон)
  передаёт модель, вытащенную из названия оффера, — оператор сразу видит
  релевантные папки. Пустой → показываем первую страницу всех папок.
- **`Добавить выбранные`** → `onConfirm(urls: string[])` (в порядке выбора) и
  закрытие. `Отмена`/`Esc`/фон → `onCancel()`.

Состояния: загрузка (скелет/спиннер), пустая папка («нет фото»), ошибка
(`CRM_NOT_CONFIGURED` показываем как «CRM не настроена», прочее — текст ошибки
с кнопкой «повторить»).

### Кнопка в `ImagesEditor` — `web/src/components/ImagesEditor.tsx`

Новая опциональная проп:

```ts
onImportFromCrm?: () => Promise<string[]>;   // открыть пикер, вернуть выбранные url (в порядке выбора)
```

Когда задана — в тулбаре шапки, рядом с «+ URL»/«+ файлы», появляется кнопка
**«Из галереи CRM»**. По клику:

1. `const urls = await onImportFromCrm();` (открывает модалку, ждёт `onConfirm`).
2. Если пусто (отмена) — ничего.
3. Иначе — **переиспользуем существующий последовательный конвейер** перезалива
   (тот, что уже гоняет `handleFile`): по каждому `url` вызываем
   `onUploadByUrl(url)` → получаем Allegro-CDN URL → `onChange(acc = [...acc, cdn])`
   после каждого успеха (галерея наполняется вживую). Прогресс показываем в
   лейбле кнопки (`n/total · · ·`), ошибки по фото копим и выводим тем же
   блоком, что и файловые (`Не удалось загрузить N из M`).

Чтобы это работало и в клоне, `ImagesEditor` там теперь тоже получает
`onUploadByUrl` (перезалив). Кнопка «+ URL» при этом появляется в клоне — это
приемлемо (даёт оператору и ручную перезаливку). Если не хотим показывать
«+ URL» в клоне — вынесем перезалив CRM во внутренний хелпер, не завязанный на
видимость «+ URL» (решается в плане; на дизайн не влияет).

Рефактор общего конвейера: логику «последовательно перезалить список
source-URL и дописывать в галерею» вынести в один внутренний метод
`rehostSequential(sources: string[])`, которым пользуются и файловая загрузка
(после чтения файла нет URL — там остаётся свой путь через `onUploadFile`), и
CRM-импорт, и «+ URL». Цель — не дублировать прогресс/ошибки/`onChange`-накопление.

### Проводка в двух местах

- **`web/src/App.tsx` (клонер).** У `ImagesEditor` (строка ~578) добавляются
  `onUploadByUrl={api.uploadImageByUrl-обёртка}` и `onImportFromCrm`.
  `onImportFromCrm` открывает `CrmGalleryPicker` (через локальный state
  `crmPickerOpen` + Promise-резолвер) с `initialSearch`, вычисленным из
  названия/модели оффера (напр. из `preview.name` — эвристика «взять модель»;
  если не уверены — пустой поиск). Кнопка видна только при `crmConfigured`.
- **`web/src/components/NewProductPanel.tsx`.** Там `onUploadByUrl` уже есть;
  добавляется `onImportFromCrm` по той же схеме. `initialSearch` — из
  введённого имени товара, если есть.

Управление открытием модалки: удобнее всего — небольшой хук
`useCrmPicker()`, который держит state и возвращает `{ open(initialSearch),
element }`; `element` рендерим один раз, `onImportFromCrm = () =>
open(initialSearch)` возвращает Promise, резолвящийся на `onConfirm`. Деталь
реализации — в плане.

## Обработка ошибок и краевые случаи

- **CRM не настроена** (`crmConfigured=false`): кнопка скрыта; если всё же
  дёрнули — `503`, пикер показывает «CRM не настроена».
- **Битый/отозванный ключ** (`401/403` от CRM): наш прокси отдаёт `error:'CRM'`
  с исходным статусом; пикер показывает понятный текст, кнопка «повторить».
- **SKU не найден** (`404` на `/photos?sku=`): для нас не критично — основной
  путь браузинг; SKU-шорткат используем только когда артикул явно есть.
- **Рейт-лимит** (`429`): пикер показывает «слишком часто, попробуйте позже».
  Батч перезалива и так последовательный — на CRM он не давит (фото уже на
  CloudFront, CRM только листинг).
- **Ошибка перезалива отдельного фото**: не роняет остальные (как у файловой
  загрузки) — успешные добавляются, по неуспешным собирается список.
- **Дубли**: если выбранный CloudFront-URL перезальётся, в галерее появится
  новый Allegro-URL; дедуп по исходному URL против уже добавленных — опционально
  (v2), т.к. оператор выбирает осознанно.
- **Порядок**: фото добавляются в порядке кликов в пикере.

## Тесты

**Сервер:**
- `CrmClient` (замоканный axios): `listFolders`/`getFolder`/`photosBySku`
  формируют правильный путь+заголовок `Bearer`; `404` → `CrmNotFound`; `401/403`
  → `CrmApiError` с нужным статусом.
- Прокси-роуты: `503` при отсутствии `crm`; passthrough JSON; проброс `?search=`
  и `?sku=`; маппинг `CrmApiError` в ответ.

**Клиент:**
- `ImagesEditor`: кнопка «Из галереи CRM» видна только при `onImportFromCrm`;
  по результату вызывает `onUploadByUrl` на каждый url и накапливает в `onChange`;
  ошибка по одному url не прерывает остальные (тот же контракт, что у файлов).
- `rehostSequential` — накопление, прогресс, сбор ошибок (юнит).
- `CrmGalleryPicker`: рендер папок/фото на замоканном `api.crm`; тоггл выбора;
  `onConfirm` отдаёт url в порядке кликов; переключение канала грузит его фото;
  поиск дебаунсит и перезапрашивает. (Часть — ручная проверка в браузере.)

## Вне scope (YAGNI)

- Пикер/сессия/`postMessage` на стороне CRM — отвергнуто в пользу REST+ключ.
- Ключ CRM в браузере / браузер-директ в CRM (утечка ключа).
- Дедуп фото против уже добавленных в галерею.
- Бесконечный скролл с виртуализацией (для v1 — кнопка «ещё»).
- Кэширование ответов CRM на нашем сервере.
- Автоподстановка фото по SKU без подтверждения оператором (риск чужой модели).

---

## Приложение A. Согласованный контракт CRM (для истории)

Реализуется на стороне CRM. Наш код зависит только от этих форм.

**Аутентификация.** Per-company ключ `lgk_live_…`, заголовок
`Authorization: Bearer lgk_live_…`. Ключ выдаётся в Настройках CRM, показывается
один раз. Ошибки: `401` нет/битый ключ, `403` отозван/нет scope, `404` не
найдено, `429` рейт-лимит. Все данные автоматически scoped на компанию ключа.

**① `GET /api/v1/gallery/photos?sku=DELL-7420`** — все фото модели одним вызовом
(exact-match по `MediaFolder.sku`, при желании + `linkedModel.sku`; **без**
fuzzy-фолбэка — иначе риск чужой модели):
```json
{ "folder": { "id":"clx…","name":"Dell Latitude 7420","vendor":"Dell","sku":"DELL-7420" },
  "photos": [ { "id":"clx…","url":"https://d1…/…jpg","thumbnailUrl":"https://…_thumb.webp",
               "angleId":null,"sortOrder":0,"isCover":true } ] }
// 404 { "error":"folder_not_found","sku":"DELL-7420" }
```

**② `GET /api/v1/gallery/folders?search=&limit=50&cursor=`** — список папок-моделей.
`search` матчит **name + vendor + sku**:
```json
{ "folders": [ { "id":"clx…","name":"…","vendor":"…","sku":"…","photoCount":12,
                 "cover": { "id":"…","url":"…","thumbnailUrl":"…" },
                 "channels": [ { "id":"…","name":"Allegro","channelKey":"allegro","photoCount":8 } ] } ],
  "nextCursor": null }
```

**③ `GET /api/v1/gallery/folders/{id}` / `…/{id}/photos`** — детали папки/фото
(работает и для папки-модели, и для под-папки-канала):
```json
{ "id":"…","name":"…","vendor":"…","sku":"…",
  "photos": [ /* …канонический photo… */ ],
  "channels": [ /* … */ ] }
```

**Канонический объект фото** (`url` уже отдаёт активный вариант
`usesProcessed ? processedUrl : url` — про remove.bg знать не нужно):
```json
{ "id":"clx…","url":"https://d1…cloudfront.net/…","thumbnailUrl":"https://…_thumb.webp",
  "folderId":"clx…","angleId":"clx…"|null,"sortOrder":0,"createdAt":"2026-07-07T…Z" }
```

**Наши требования к контракту** (переданы CRM-команде):
1. Каллер — бэкенд клонера, ключ секретный (server-to-server). CORS не нужен.
2. `?sku=` — строгий exact-match, без fuzzy-фолбэка; вся «мягкость» — в `?search=`.
3. `?search=` матчит name + vendor + sku.
4. Префикс `/api/v1/` — оставляем.
