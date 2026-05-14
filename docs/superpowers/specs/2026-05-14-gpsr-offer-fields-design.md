# Дизайн: GPSR-поля + потерянные поля оферты

**Дата:** 2026-05-14
**Ветка:** `feat/gpsr-offer-fields`
**Статус:** утверждён, готов к написанию плана реализации

## Проблема

Allegro-форма создания оферты содержит блоки, которые инструмент сейчас не
заполняет и не переносит:

- **Certyfikaty zgodności** (CE, EN 71-3, EN 716, EN 747, FSC, REACH,
  TÜV Rheinland, WEEE) и **Zawiera baterie** — категорийные параметры карточки.
- **Dane producenta** (`responsibleProducer`) — GPSR-данные производителя.
- **Osoba odpowiedzialna** (`responsiblePerson`) — GPSR ответственное лицо.
- **Informacja o bezpieczeństwie** (`safetyInformation`) — текст безопасности.

GPSR в ЕС обязателен с 13.12.2024; без этих данных оферта не активируется.
Дополнительно whitelist полей оферты в клоне рассинхронизирован с актуальной
схемой `SaleProductOfferRequestV1`.

## Скоуп

1. **GPSR в клоне** — перенос `responsibleProducer` / `responsiblePerson` /
   `safetyInformation` с оферты-источника на клон.
2. **Справочники GPSR** — чтение `/sale/responsible-persons` и
   `/sale/responsible-producers` + inline-создание новых записей.
3. **Фикс whitelist** оферты в `clone.ts`.
4. **UX сертификатов** — вынести параметры сертификатов/батареи в видимую
   группу в `NewProductPanel`.

## Ключевое ограничение (согласовано)

`responsibleProducer` / `responsiblePerson` / `safetyInformation` — поля
**оферты** (`productSet[]`), а не карточки товара. `POST /sale/product-proposals`
их не принимает.

- **Клон оферты** — получает все GPSR-поля.
- **«Создать товар»** — создаёт только карточку каталога. Применим только п.4
  (сертификаты/батарея — это параметры карточки). Производитель / лицо /
  безопасность туда не применимы.

Если в будущем понадобится, чтобы «Создать товар» публиковал ещё и оферту —
это отдельная фича вне этой спеки.

## Справочник схем Allegro (сверено с живым swagger, май 2026)

### Ссылки в `productSet[]` оферты

`SaleProductOfferRequestV1.productSet[]` принимает (помимо `product` и
`quantity`):

```jsonc
// responsiblePerson — либо id, либо name (id выигрывает); null = снять
"responsiblePerson": { "id": "<uuid>" }            // или { "name": "<dict name>" }

// responsibleProducer — discriminated union по type
"responsibleProducer": { "type": "ID",   "id": "<uuid>" }
"responsibleProducer": { "type": "NAME", "name": "<dict name>" }

// safetyInformation — discriminated union по type (используем только TEXT)
"safetyInformation": { "type": "TEXT", "description": "<=5000 символов" }

// marketedBeforeGPSRObligation — boolean | null
"marketedBeforeGPSRObligation": false
```

`name` в `responsiblePerson` / `responsibleProducer` ссылается на **внутреннее
имя записи в справочнике**, не на публичное имя.

`GET /sale/product-offers/{id}` (`SaleProductOfferResponseV1`) отдаёт эти же
поля в `productSet[]` — превью сможет прочитать GPSR источника.

### Справочник ответственных лиц — `/sale/responsible-persons`

- `GET /sale/responsible-persons` → `{ responsiblePersons: [...], count, totalCount }`
  (query: `offset` 0–16000, `limit` 1–1000).
- `GET /sale/responsible-persons/{id}` → одна запись.
- `POST /sale/responsible-persons` → создать.
- Scopes: `allegro:api:sale:settings:read` / `:write`.

`CreateResponsiblePersonRequest`:

```jsonc
{
  "name": "<=50, внутреннее имя, без крайних/двойных пробелов>",
  "personalData": {
    "name": "<=200, публичное имя лица/компании>",
    "address": {
      "countryCode": "<ISO, ТОЛЬКО 27 кодов ЕС: AT BE BG HR CY CZ DK EE FI FR GR ES IE LT LU LV MT NL DE PL PT RO SK SI SE HU IT>",
      "street": "<=200>",
      "postalCode": "<=20>",
      "city": "<=100>"
    },
    "contact": {
      "email": "<=50>",          // хотя бы одно из email / formUrl
      "phoneNumber": "<=30, опц.>",
      "formUrl": "<=80>"
    }
  }
}
```

Ответ добавляет `id` (uuid).

### Справочник производителей — `/sale/responsible-producers`

- `GET /sale/responsible-producers` → `{ responsibleProducers: [...], count, totalCount }`
  (query: `offset` 0–50000, `limit` 1–1000).
- `GET /sale/responsible-producers/{id}` → одна запись.
- `POST /sale/responsible-producers` → создать (201).

`CreateResponsibleProducerRequest`:

```jsonc
{
  "name": "<=50, внутреннее имя>",
  "producerData": {
    "tradeName": "<=200, имя компании/ФИО/торговое имя>",
    "address": {
      "countryCode": "<[A-Z]{2}, НЕ ограничен ЕС в отличие от лица>",
      "street": "<=200>",
      "postalCode": "<=20>",
      "city": "<=100>"
    },
    "contact": {
      "email": "<=50>",          // хотя бы одно из email / formUrl
      "phoneNumber": "<=30, опц.>",
      "formUrl": "<=80>"
    }
  }
}
```

Ответ добавляет `id` (uuid).

### Whitelist оферты — расхождения с `SaleProductOfferRequestV1`

Полный набор top-level полей `SaleProductOfferRequestV1` (= V1 + RequestBase +
SaleProductOffer): `productSet, b2b, attachments, fundraisingCampaign,
additionalServices, stock, delivery, publication, additionalMarketplaces,
compatibilityList, language, category, name, parameters, afterSalesServices,
sizeTable, contact, discounts, payments, sellingMode, location, images,
description, external, taxSettings, messageToSellerSettings`.

- **Убрать из whitelist** (нет в схеме → риск 422 `UnknownJSONProperty`):
  `ean`, `promotion`, `messageToSellerForm`.
- **Добавить в whitelist** (принимаются API, сейчас молча теряются):
  `b2b`, `taxSettings`, `additionalMarketplaces`, `messageToSellerSettings`.

## Архитектура

Три слоя, как в существующем коде: `allegro.ts` (HTTP-клиент) → `routes/api.ts`
(Express-роуты, account-scoped через `pickAccount`) → `web/src` (React-панели).
GPSR-логика клона — в `clone.ts`. Матчинг «перенести/спросить» — в UI.

### Слой 1 — сервер: `server/src/core/allegro.ts`

Шесть новых методов `AllegroClient` (используют существующий `withRetry`):

| Метод | HTTP |
|---|---|
| `listResponsiblePersons()` | `GET /sale/responsible-persons?limit=1000` |
| `getResponsiblePerson(id)` | `GET /sale/responsible-persons/{id}` |
| `createResponsiblePerson(body)` | `POST /sale/responsible-persons` |
| `listResponsibleProducers()` | `GET /sale/responsible-producers?limit=1000` |
| `getResponsibleProducer(id)` | `GET /sale/responsible-producers/{id}` |
| `createResponsibleProducer(body)` | `POST /sale/responsible-producers` |

Лимиты Allegro (1000/1000) перекрывают реальные объёмы продавца — пагинацию не
делаем; берём первую страницу `limit=1000`.

### Слой 1 — сервер: `server/src/core/types.ts`

- Новые типы: `ResponsiblePerson`, `ResponsibleProducer` (с вложенными
  `PersonalData` / `ProducerData`, `Address`, `Contact`),
  `ResponsibleProducerRef` (`{type:'ID',id} | {type:'NAME',name}`),
  `ResponsiblePersonRef` (`{id?} | {name?}`), `SafetyInformation`
  (`{type:'TEXT',description}`).
- `AllegroProductSetItem` — добавить опциональные `responsiblePerson`,
  `responsibleProducer`, `safetyInformation`, `marketedBeforeGPSRObligation`;
  **удалить** несуществующее поле `marketplaces`.

### Слой 2 — сервер: `server/src/routes/api.ts`

Новые роуты (account-scoped существующим `pickAccount` middleware — берёт
`X-Account-Id` / `?account=` / `body.accountId`):

| Роут | Назначение |
|---|---|
| `GET  /api/gpsr/responsible-persons` | список лиц активного аккаунта |
| `GET  /api/gpsr/responsible-producers` | список производителей активного аккаунта |
| `POST /api/gpsr/responsible-persons` | inline-создание лица (zod-валидация) |
| `POST /api/gpsr/responsible-producers` | inline-создание производителя (zod-валидация) |

zod-схемы повторяют лимиты Allegro: `name ≤50`, `personalData.name`/`tradeName`
≤200, поля адреса по лимитам, `email ≤50` / `formUrl ≤80` с `.refine()` «хотя бы
одно из email/formUrl». `countryCode` лица — enum 27 кодов ЕС; производителя —
`/^[A-Z]{2}$/`.

`GET /api/offers/:id/preview` — расширить ответ полем `gpsr`:

```ts
gpsr: {
  responsibleProducer?: ResponsibleProducer | { name: string };  // полные данные или только name
  responsiblePerson?:   ResponsiblePerson   | { name: string };
  safetyInformation?:   { type: 'TEXT'; description: string };
  marketedBeforeGPSRObligation?: boolean | null;
}
```

Логика: прочитать `offer.productSet[0]`; если producer/person заданы по `id` —
дотянуть полные данные через `getResponsibleProducer/Person` **на аккаунте-
источнике** (`req.sourceAllegro`/`req.allegro` — в превью это аккаунт-источник).
Если заданы по `name` — отдать как `{ name }`. Ошибки дотяжки не валят превью
(graceful: отдаём что есть).

### Слой 1 — сервер: `server/src/core/clone.ts`

`CloneOptions` получает поле:

```ts
gpsr?: {
  responsibleProducer?: { type: 'ID'; id: string } | { type: 'NAME'; name: string } | null;
  responsiblePerson?:   { id: string } | { name: string } | null;
  safetyInformation?:   { type: 'TEXT'; description: string } | null;
};
```

В `buildCloneBody` `productSet[0]` собирается **явно**, без слепого
`...productSetItem`:

```
productSet[0] = {
  product, quantity,            // как сейчас
  ...resolveGpsr(),
}
```

`resolveGpsr()`:
- Если `options.gpsr` задан — берём его поля (значение `null` = явно снять поле,
  не отправлять). Это путь «оператор подтвердил в GpsrPanel».
- Если `options.gpsr` НЕ задан и `sourceClient === client` (тот же аккаунт) —
  переносим GPSR-поля `productSetItem` источника как есть (id валидны).
- Если `options.gpsr` НЕ задан и кросс-аккаунт — НЕ переносим id (битые в
  target); пишем `warn` в `steps`: «GPSR источника не перенесён — укажи
  производителя/лицо в GPSR-панели». `safetyInformation` (TEXT, без id)
  переносится в любом случае. `marketedBeforeGPSRObligation` (boolean)
  переносится в любом случае.

Поле `marketplaces` из `productSetItem` больше не утекает (собираем `productSet`
явно).

### Слой 2 — сервер: `clone` / `clonePreview` zod-схема

`cloneSchema` в `routes/api.ts` получает опциональный `gpsr` объект с
discriminated unions. Сервер просто применяет подтверждённое — матчинг и
решение «перенести/спросить» происходят в UI.

### Слой 3 — клиент: `web/src/api.ts`

- Типы `ResponsiblePerson`, `ResponsibleProducer`, `OfferPreview.gpsr`,
  `ClonePayload.gpsr`.
- Методы: `api.gpsr.listPersons()`, `api.gpsr.listProducers()`,
  `api.gpsr.createPerson(body)`, `api.gpsr.createProducer(body)` —
  account-scoped через существующий `accountHeader` / `accountId`.

### Слой 3 — клиент: новый компонент `web/src/components/GpsrPanel.tsx`

Размещение: колонка клона в `App.tsx`, после `ExtrasPanel`, перед sticky-баром
публикации. Рендерится только в режиме `clone` (GPSR — поле оферты).

Пропсы: данные `preview.gpsr` (источник), `publishAccountId` (для какого
аккаунта тянуть списки и создавать записи), коллбэк `onChange(gpsr)` —
отдаёт в `App.tsx` подтверждённое состояние для `buildPayload`.

Три поля «как Kolor/Materiał»:

1. **Producent** — `Combobox`, опции = `listProducers()` target-аккаунта.
   Префилл: матч `preview.gpsr.responsibleProducer` против списка target
   (эвристика ниже). Матч найден → подставлен; не найден → поле подсвечено,
   рядом раскрыта inline-форма «создать», предзаполненная данными источника.
2. **Osoba odpowiedzialna** — то же самое для `listPersons()`.
3. **Informacja o bezpieczeństwie** — `textarea` (TEXT, ≤5000), префилл из
   `preview.gpsr.safetyInformation.description`. Без матчинга — текст
   account-agnostic.

**Эвристика матчинга** (UI, кросс-аккаунт): сравнить публичное имя источника
(`producerData.tradeName` / `personalData.name`), регистронезависимо, +
совпадение `postalCode`. Ровно одно совпадение → предвыбор по `id`. Иначе →
«не найдено», подсветка + раскрытая inline-форма. При `sourceClient === client`
(тот же аккаунт) матчинг не нужен — id источника валиден, подставляем напрямую.

**Inline-форма создания** — раскрывающийся блок под выпадашкой: поля по
`CreateResponsible*Request` (внутреннее `name`, публичное имя/`tradeName`,
адрес, `email`/`phoneNumber`/`formUrl`). Сабмит → `POST /api/gpsr/...` с
`accountId = publishAccountId` → новый `id` сразу выбирается в выпадашке.

`onChange` отдаёт в `App.tsx`: `responsibleProducer` как `{type:'ID',id}`,
`responsiblePerson` как `{id}`, `safetyInformation` как `{type:'TEXT',description}`
(или `null`, если оператор очистил поле). `App.buildPayload` кладёт это в
`gpsr` clone-payload.

### Слой 3 — клиент: `web/src/components/NewProductPanel.tsx` (п.4)

Категорийные параметры, чьи имена матчат сертификаты/безопасность/батарею
(регэксп по `certyfikat`, `zgodności`, `bateri`, `bezpieczeństw`), выносятся в
отдельную всегда-видимую секцию «Сертификаты и безопасность» между
«Обязательные» и `<details>` «Необязательные». Остальные необязательные
параметры остаются в `<details>` как есть. Логика отправки не меняется — это
те же `parameters[]`, просто перегруппированы визуально.

## Поток данных (клон, кросс-аккаунт)

```
1. Оператор грузит оферту → GET /api/offers/:id/preview
   → сервер читает productSet[0].responsibleProducer/Person/safetyInformation
   → дотягивает полные данные по id на аккаунте-источнике
   → возвращает preview.gpsr
2. GpsrPanel при маунте/смене publishAccountId → GET /api/gpsr/responsible-*
   (списки target-аккаунта)
3. GpsrPanel матчит preview.gpsr против списков target:
   - матч → выпадашка предвыбрана
   - нет матча → подсветка + inline-форма, предзаполненная данными источника
4. Оператор подтверждает/меняет/создаёт → GpsrPanel.onChange → App state
5. Клик «Клонировать» → POST /api/clone с gpsr в payload
6. buildCloneBody.resolveGpsr() применяет options.gpsr к productSet[0]
```

Тот же аккаунт: шаг 3 тривиален (id валиден, предвыбор напрямую); если оператор
ничего не трогал, `options.gpsr` всё равно уходит с валидными id источника.

## Обработка ошибок

- Дотяжка GPSR в превью падает → превью не валится, `gpsr` отдаётся частично
  (что удалось), UI показывает поля пустыми/по `name`.
- `POST /api/gpsr/...` возвращает 4xx → inline-форма показывает сообщение
  Allegro (как `NewProductPanel` показывает ошибки `proposeProduct`).
- Кросс-аккаунт, оператор не заполнил GPSR → клон не блокируется, но в логе
  `warn`; Allegro может вернуть 422 при активации — это видно в `ResultPanel`.
- Списки `/sale/responsible-*` пустые → выпадашка пустая, видна только
  inline-форма «создать».

## Тестирование

`server/src/core/clone.test.ts` — добавить кейсы:

- GPSR same-account без `options.gpsr` → поля productSet[0] переносятся by id.
- GPSR cross-account без `options.gpsr` → producer/person id НЕ уходят, есть
  `warn`-шаг; `safetyInformation` и `marketedBeforeGPSRObligation` переносятся.
- `options.gpsr` задан → применяется поверх источника; `null` в поле → поле не
  отправляется.
- `productSet[].marketplaces` источника не попадает в тело.
- whitelist: `b2b` / `taxSettings` / `additionalMarketplaces` /
  `messageToSellerSettings` источника проходят в тело; `promotion` / `ean` /
  `messageToSellerForm` — режутся.

Ручная проверка (sandbox): превью оферты с GPSR; клон same-account; клон
cross-account с матчем и без; inline-создание producer/person; группа
сертификатов в «Создать товар».

## Файлы

**Изменяются:**
- `server/src/core/allegro.ts` — 6 методов
- `server/src/core/types.ts` — типы GPSR, правка `AllegroProductSetItem`
- `server/src/core/clone.ts` — `CloneOptions.gpsr`, `resolveGpsr()`, явная сборка
  `productSet[0]`, фикс `POST_OFFER_TOP_LEVEL_WHITELIST`
- `server/src/core/clone.test.ts` — новые кейсы
- `server/src/routes/api.ts` — 4 роута `/api/gpsr/*`, `gpsr` в `cloneSchema`,
  `gpsr` в ответе `/offers/:id/preview`
- `web/src/api.ts` — типы + методы `api.gpsr.*`
- `web/src/App.tsx` — монтаж `GpsrPanel`, `gpsr` в `buildPayload` + state
- `web/src/components/NewProductPanel.tsx` — группа «Сертификаты и безопасность»

**Создаётся:**
- `web/src/components/GpsrPanel.tsx`

## Вне скоупа (YAGNI)

- `safetyInformation` режимы `ATTACHMENTS` / пайплайн загрузки PDF.
- UI-тогл `marketedBeforeGPSRObligation` (boolean переносится молча).
- Авто-репликация GPSR в кросс-аккаунте (выбрано поведение B — «спросить»).
- Отдельная вкладка/экран управления справочниками, дефолты на аккаунт.
- Использование `productSafety` из `GET /sale/products/{id}` для префилла.
- Публикация оферты из потока «Создать товар».
- `PUT`/редактирование/удаление записей справочников (только чтение + создание).
