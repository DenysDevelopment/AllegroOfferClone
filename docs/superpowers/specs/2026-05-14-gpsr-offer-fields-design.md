# Дизайн: GPSR-поля + полное покрытие полей оферты

**Дата:** 2026-05-14
**Ветка:** `feat/gpsr-offer-fields`
**Статус:** утверждён (расширен после ревью скриншотов формы Allegro)

## Проблема

Allegro-форма создания оферты содержит блоки, которые инструмент сейчас не
заполняет, не переносит или ломает при кросс-аккаунт клоне:

- **Certyfikaty zgodności** (CE, EN 71-3, FSC, REACH, TÜV, WEEE…) и **Zawiera
  baterie** — категорийные параметры карточки.
- **Dane producenta** (`responsibleProducer`), **Osoba odpowiedzialna**
  (`responsiblePerson`), **Informacja o bezpieczeństwie** (`safetyInformation`)
  — GPSR-данные.
- **Cena по рынкам** (`additionalMarketplaces`), **Faktura VAT / ставки**
  (`taxSettings`), **B2B** (`b2b`) — молча теряются: нет в whitelist.
- **Cennik dostawy** (`delivery.shippingRates`), **Warunki zwrotów / Reklamacje
  / Gwarancje** (`afterSalesServices.*`), **Cennik hurtowy**
  (`discounts.wholesalePriceList`) — переносятся, но ссылаются на ID
  справочников аккаунта → при кросс-аккаунт клоне ID невалидны.

GPSR в ЕС обязателен с 13.12.2024; без него оферта не активируется. Цель —
**полное покрытие формы оферты**: всё, что Allegro принимает в
`SaleProductOfferRequestV1`, должно переноситься клоном корректно, в т.ч. между
аккаунтами.

## Скоуп

1. **GPSR в клоне** — перенос `responsibleProducer` / `responsiblePerson` /
   `safetyInformation` с оферты-источника на клон.
2. **Справочники GPSR** — чтение `/sale/responsible-persons` и
   `/sale/responsible-producers` + inline-создание новых записей.
3. **Фикс whitelist** оферты в `clone.ts` (вернуть `b2b`, `taxSettings`,
   `additionalMarketplaces`, `messageToSellerSettings`; убрать невалидные
   `ean`, `promotion`, `messageToSellerForm`).
4. **UX сертификатов** — вынести параметры сертификатов/батареи в видимую
   группу в `NewProductPanel`.
5. **Кросс-аккаунт ссылки оферты** — `delivery.shippingRates`,
   `afterSalesServices.returnPolicy/impliedWarranty/warranty` переносить через
   выбор из справочника target-аккаунта с матчингом по имени;
   `discounts.wholesalePriceList` — снимать при кросс-аккаунте.

## Ключевое ограничение (согласовано)

`responsibleProducer` / `responsiblePerson` / `safetyInformation` и ссылки
оферты (delivery/afterSalesServices/discounts) — поля **оферты**
(`SaleProductOfferRequestV1`), а не карточки товара.
`POST /sale/product-proposals` их не принимает.

- **Клон оферты** — получает всё.
- **«Создать товар»** — создаёт только карточку каталога. Применим только п.4
  (сертификаты/батарея — параметры карточки).

## Справочник схем Allegro (сверено с живым swagger, май 2026)

### GPSR-ссылки в `productSet[]` оферты

```jsonc
"responsiblePerson":   { "id": "<uuid>" }                  // или { "name": "<dict name>" }; null = снять
"responsibleProducer": { "type": "ID",   "id": "<uuid>" }  // или { "type": "NAME", "name": "<dict name>" }
"safetyInformation":   { "type": "TEXT", "description": "<=5000>" }
"marketedBeforeGPSRObligation": false
```

`name` ссылается на **внутреннее имя записи в справочнике**, не на публичное имя.
`GET /sale/product-offers/{id}` отдаёт эти поля в `productSet[]` — превью читает
GPSR источника.

### Справочники GPSR

- `/sale/responsible-persons` — `GET` (список), `GET /{id}`, `POST` (создать).
  `CreateResponsiblePersonRequest`: `name ≤50`; `personalData.name ≤200`;
  `personalData.address` `{ countryCode (27 кодов ЕС), street ≤200,
  postalCode ≤20, city ≤100 }`; `personalData.contact` `{ email ≤50,
  phoneNumber ≤30 опц., formUrl ≤80 }` — хотя бы одно из email/formUrl.
- `/sale/responsible-producers` — `GET`, `GET /{id}`, `POST`.
  `CreateResponsibleProducerRequest`: `name ≤50`; `producerData.tradeName ≤200`;
  `producerData.address` (`countryCode` — любой `[A-Z]{2}`, не только ЕС);
  `producerData.contact` — как у лица.

### Ссылки оферты (delivery / afterSalesServices / discounts)

Все принимают **id или name** — это важно: при кросс-аккаунте можно
ссылаться по имени, если в target-аккаунте есть одноимённая запись.

```jsonc
"delivery": { "shippingRates": { "id": "<uuid>" } }        // или { "name": "<name>" }
"afterSalesServices": {
  "returnPolicy":    { "id": "<uuid>" },                   // или { "name": "<name>" }
  "impliedWarranty": { "id": "<uuid>" },                   // или { "name": "<name>" }
  "warranty":        { "id": "<uuid>" }                    // или { "name": "<name>" }
}
"discounts": { "wholesalePriceList": { "id": "<promotion id>" } }  // null = снять
```

GET-эндпоинты справочников (для выпадашек target-аккаунта):
- `GET /sale/shipping-rates?seller.id=me` → `{ shippingRates: [{id,name}] }` — **есть** `listShippingRates()`
- `GET /after-sales-service-conditions/return-policies` → `{ returnPolicies: [{id,name}] }` — **есть** `listReturnPolicies()`
- `GET /after-sales-service-conditions/implied-warranties` → `{ impliedWarranties: [{id,name}] }` — **есть** `listImpliedWarranties()`
- `GET /after-sales-service-conditions/warranties` → `{ warranties: [{id,name}] }` — **НЕТ**, добавляем `listWarranties()`
- GET-по-id есть у всех четырёх (для дотяжки имени источника в превью).

`discounts.wholesalePriceList` — это id промо-акции (listing через
`/sale/loyalty-promotions` сложен и нишевой). **Решение:** не делаем выпадашку;
same-account — переносим; кросс-аккаунт — снимаем + `warn`.

### Whitelist оферты — расхождения с `SaleProductOfferRequestV1`

Полный набор top-level полей `SaleProductOfferRequestV1`: `productSet, b2b,
attachments, fundraisingCampaign, additionalServices, stock, delivery,
publication, additionalMarketplaces, compatibilityList, language, category,
name, parameters, afterSalesServices, sizeTable, contact, discounts, payments,
sellingMode, location, images, description, external, taxSettings,
messageToSellerSettings`.

- **Убрать из whitelist** (нет в схеме → риск 422): `ean`, `promotion`,
  `messageToSellerForm`.
- **Добавить в whitelist**: `b2b`, `taxSettings`, `additionalMarketplaces`,
  `messageToSellerSettings`.

## Архитектура

Три слоя по образцу кодовой базы: `allegro.ts` (HTTP-клиент) → `routes/api.ts`
(Express, account-scoped через `pickAccount`) → `web/src` (React-панели).
Логика клона — в `clone.ts`. Матчинг «перенести/спросить» — в UI.

### Слой 1 — `server/src/core/allegro.ts`

GPSR (6 методов): `listResponsiblePersons` / `getResponsiblePerson` /
`createResponsiblePerson` / `listResponsibleProducers` /
`getResponsibleProducer` / `createResponsibleProducer`.

Ссылки оферты: `listShippingRates` / `listReturnPolicies` /
`listImpliedWarranties` — **уже есть**. Добавить:
- `listWarranties()` → `GET /after-sales-service-conditions/warranties`
- `getShippingRate(id)` → `GET /sale/shipping-rates/{id}`
- `getReturnPolicy(id)` → `GET /after-sales-service-conditions/return-policies/{id}`
- `getImpliedWarranty(id)` → `GET /after-sales-service-conditions/implied-warranties/{id}`
- `getWarranty(id)` → `GET /after-sales-service-conditions/warranties/{id}`

GET-по-id нужны, чтобы превью дотянуло **имя** ссылки источника (GET оферты
отдаёт только `{id}`), а UI смог сматчить по имени против списка target.

### Слой 1 — `server/src/core/types.ts`

- Типы GPSR: `ResponsiblePerson`, `ResponsibleProducer`, `GpsrAddress`,
  `GpsrContact`, `ResponsibleProducerRef`, `ResponsiblePersonRef`,
  `SafetyInformationText`.
- Тип `NamedRef = { id: string; name?: string }` для ссылок оферты.
- `AllegroProductSetItem` — добавить `responsiblePerson`, `responsibleProducer`,
  `safetyInformation`, `marketedBeforeGPSRObligation`; убрать `marketplaces`.

### Слой 2 — `server/src/routes/api.ts`

Новые роуты:
- `GET/POST /api/gpsr/responsible-persons`, `GET/POST /api/gpsr/responsible-producers`
- `GET /api/helpers/warranties` (роуты `/helpers/shipping-rates`,
  `/helpers/return-policies`, `/helpers/implied-warranties` — **уже есть**)

zod-схемы создания GPSR повторяют лимиты Allegro (`name ≤50`, адрес, contact с
`.refine()` «email или formUrl»; `countryCode` лица — enum ЕС, производителя —
`/^[A-Z]{2}$/`).

`cloneSchema` получает `gpsr` (discriminated unions) и `offerRefs`
(`{ shippingRates?, returnPolicy?, impliedWarranty?, warranty? }`, каждое —
`{ id } | { name } | null`).

`GET /api/offers/:id/preview` расширяется полями:
```ts
gpsr: {
  responsibleProducer?, responsiblePerson?, safetyInformation?,
  marketedBeforeGPSRObligation?,
} | null;
offerRefs: {
  // имена дотянуты на аккаунте-источнике по id из delivery/afterSalesServices
  shippingRates?:    { id: string; name?: string };
  returnPolicy?:     { id: string; name?: string };
  impliedWarranty?:  { id: string; name?: string };
  warranty?:         { id: string; name?: string };
} | null;
```

### Слой 1 — `server/src/core/clone.ts`

`CloneOptions` получает:
```ts
gpsr?: { responsibleProducer?, responsiblePerson?, safetyInformation? };  // как раньше
offerRefs?: {
  shippingRates?:   { id: string } | { name: string } | null;
  returnPolicy?:    { id: string } | { name: string } | null;
  impliedWarranty?: { id: string } | { name: string } | null;
  warranty?:        { id: string } | { name: string } | null;
};
```

`buildCloneBody`:
- `productSet[0]` собирается явно; GPSR проставляет `resolveGpsr()` (логика как
  раньше: override → same-account carry → cross-account drop+warn; safety и
  marketedBefore — account-agnostic, переносятся всегда).
- `delivery`, `afterSalesServices`, `discounts` пропускаются через
  `resolveOfferRefs()`:
  - **`options.offerRefs.X` задан** → применяем (`{id}`/`{name}`/`null`=снять).
  - **same-account, override нет** → переносим ссылку источника как есть.
  - **cross-account, override нет** → снимаем `id` ссылки + `warn` («укажи
    cennik dostawy / warunki zwrotów… в панели»). Прочие поля `delivery`
    (handlingTime, shipmentDate, additionalInfo) и `afterSalesServices`
    переносятся всегда.
  - `discounts.wholesalePriceList`: same-account — переносим; cross-account —
    удаляем + `warn`. Остальное в `discounts` переносится.
- `productSet[].marketplaces` больше не утекает (явная сборка).

### Слой 3 — `web/src/api.ts`

Типы GPSR + `OfferGpsr`, `OfferRefs`, `NamedRef`; `OfferPreview.gpsr` и
`OfferPreview.offerRefs`; `ClonePayload.gpsr` и `ClonePayload.offerRefs`.
Методы: `api.gpsr.*` (list/create persons & producers), `api.helpers.*`
(`shippingRates`, `returnPolicies`, `impliedWarranties`, `warranties`).

### Слой 3 — `web/src/components/GpsrPanel.tsx` (новый)

Колонка клона, после `ExtrasPanel`. Только GPSR: выпадашки производителя/лица
из справочника target-аккаунта (`Combobox`/`select`), матчинг данных источника
по публичному имени + индексу, inline-форма создания (создаёт запись в
target-аккаунте, новый id сразу выбирается), textarea текста безопасности
(TEXT, ≤5000, префилл из источника). `onChange` отдаёт `ClonePayload['gpsr']`.

### Слой 3 — `web/src/components/OfferRefsPanel.tsx` (новый)

Колонка клона, после `GpsrPanel`. Четыре выпадашки: **Cennik dostawy**,
**Warunki zwrotów**, **Reklamacje**, **Gwarancja** — опции из справочников
target-аккаунта (`api.helpers.*`). Префилл: матч имени источника
(`preview.offerRefs.X.name`) против списка target по имени, регистронезависимо;
ровно одно совпадение → предвыбор. Не найдено (кросс-аккаунт) → поле
подсвечено, оператор выбирает вручную. **Inline-создания нет** — cenniki/warunki
это сложные многострочные сущности; рядом ссылка «Создать в Allegro ↗».
`onChange` отдаёт `ClonePayload['offerRefs']`.

Два отдельных компонента (а не один) — чтобы файлы оставались сфокусированными:
GpsrPanel со своими inline-формами уже крупный, OfferRefsPanel — простые
выпадашки.

### Слой 3 — `web/src/components/NewProductPanel.tsx` (п.4)

Категорийные параметры с именами по регэкспу
`/certyfikat|zgodno|bateri|bezpiecze/i` выносятся в отдельную всегда-видимую
секцию «Сертификаты и безопасность» между «Обязательные» и `<details>`
«Необязательные». Логика отправки не меняется.

### Слой 3 — `web/src/App.tsx`

Стейт `gpsr` и `offerRefs`; стабильные (`useCallback`) обработчики; оба поля в
`buildPayload`; рендер `GpsrPanel` и `OfferRefsPanel` в колонке клона при
наличии `preview`.

## Поток данных (клон, кросс-аккаунт)

```
1. GET /api/offers/:id/preview
   → сервер читает productSet[0] GPSR + delivery/afterSalesServices ссылки
   → дотягивает полные данные GPSR и ИМЕНА ссылок на аккаунте-источнике
   → возвращает preview.gpsr и preview.offerRefs
2. GpsrPanel + OfferRefsPanel при маунте/смене publishAccountId
   → грузят справочники target-аккаунта (api.gpsr.*, api.helpers.*)
3. Панели матчат данные источника против списков target:
   - GPSR: по публичному имени + индексу
   - offerRefs: по имени
   - матч → предвыбор; нет матча → подсветка (+ inline-форма у GPSR)
4. Оператор подтверждает/меняет/создаёт → onChange → App state
5. «Клонировать» → POST /api/clone с gpsr + offerRefs в payload
6. buildCloneBody: resolveGpsr() и resolveOfferRefs() применяют подтверждённое
```

Same-account: матчинг тривиален (записи те же), всё предвыбрано.

## Обработка ошибок

- Дотяжка GPSR/имён ссылок в превью падает → превью не валится, поле отдаётся
  частично (по `name`/`id`), UI показывает что есть.
- `POST /api/gpsr/...` 4xx → inline-форма показывает сообщение Allegro.
- Кросс-аккаунт, оператор не заполнил ссылку → клон не блокируется, `warn` в
  логе; Allegro может вернуть 422 при активации — видно в `ResultPanel`.
- Пустые справочники → выпадашка пустая (+ inline-форма у GPSR / ссылка на
  Allegro у OfferRefsPanel).

## Тестирование

`server/src/core/clone.test.ts` — добавить кейсы:
- GPSR: same-account carry by id; cross-account drop+warn (safety/marketedBefore
  переносятся); `options.gpsr` применяется; `null` → поле снято;
  `productSet[].marketplaces` не утекает.
- offerRefs: same-account — `delivery.shippingRates` / `afterSalesServices.*`
  переносятся; cross-account без override — id снят + `warn`, прочие поля
  delivery/afterSalesServices целы; `options.offerRefs` применяется;
  `discounts.wholesalePriceList` cross-account удалён + `warn`, same-account цел.
- whitelist: `b2b`/`taxSettings`/`additionalMarketplaces`/
  `messageToSellerSettings` проходят; `promotion`/`ean`/`messageToSellerForm`
  режутся.

Ручная проверка (sandbox): превью оферты с GPSR и ссылками; клон same-account;
клон cross-account с матчем и без; inline-создание producer/person; группа
сертификатов в «Создать товар».

## Файлы

**Изменяются:**
- `server/src/core/allegro.ts` — 6 методов GPSR + `listWarranties` + 4 get-by-id
- `server/src/core/types.ts` — типы GPSR + `NamedRef`, правка `AllegroProductSetItem`
- `server/src/core/clone.ts` — `CloneOptions.gpsr`/`.offerRefs`, `resolveGpsr()`,
  `resolveOfferRefs()`, явная сборка `productSet[0]`, фикс whitelist
- `server/src/core/clone.test.ts` — кейсы GPSR + offerRefs + whitelist
- `server/src/routes/api.ts` — роуты `/api/gpsr/*` и `/api/helpers/warranties`,
  `gpsr`+`offerRefs` в `cloneSchema`, `gpsr`+`offerRefs` в превью
- `web/src/api.ts` — типы + методы `api.gpsr.*` и `api.helpers.*`
- `web/src/App.tsx` — монтаж `GpsrPanel` + `OfferRefsPanel`, оба поля в payload
- `web/src/components/NewProductPanel.tsx` — группа «Сертификаты и безопасность»

**Создаётся:**
- `web/src/components/GpsrPanel.tsx`
- `web/src/components/OfferRefsPanel.tsx`

## Вне скоупа (YAGNI)

- `safetyInformation` режимы `ATTACHMENTS` / пайплайн загрузки PDF.
- UI-тогл `marketedBeforeGPSRObligation` (boolean переносится молча).
- Выпадашка/листинг `discounts.wholesalePriceList` (нишевой B2B; кросс-аккаунт —
  снимаем + warn).
- Inline-создание cennik dostawy / warunki zwrotów / reklamacje / gwarancje
  (сложные многострочные сущности — только выбор + ссылка на Allegro).
- Отдельная вкладка управления справочниками, дефолты на аккаунт.
- Использование `productSafety` из `GET /sale/products/{id}` для префилла.
- Публикация оферты из потока «Создать товар».
- `PUT`/редактирование/удаление записей справочников.
