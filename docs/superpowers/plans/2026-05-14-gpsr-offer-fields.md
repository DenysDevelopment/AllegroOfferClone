# GPSR-поля и полное покрытие полей оферты — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Полное покрытие полей оферты при клоне — перенос GPSR (производитель / лицо / текст безопасности) и account-scoped ссылок (cennik dostawy / warunki zwrotów / reklamacje / gwarancja / cennik hurtowy), фикс whitelist, видимая группа сертификатов в «Создать товар».

**Architecture:** Три слоя по образцу кодовой базы — `allegro.ts` (HTTP-клиент) → `routes/api.ts` (Express, account-scoped через `pickAccount`) → `web/src` (React-панели). Логика клона — в `clone.ts`; матчинг «перенести/спросить» — в UI-компонентах `GpsrPanel` и `OfferRefsPanel`. Все эти поля — уровня оферты, поэтому касаются клона, не «Создать товар».

**Tech Stack:** TypeScript, Express, zod, axios (сервер); React 18, Vite, Tailwind (веб); vitest (тесты сервера).

**Спека:** `docs/superpowers/specs/2026-05-14-gpsr-offer-fields-design.md`

**Команды проверки** (из корня репозитория `/Users/denysmaksymuck/Desktop/strony/LAPTOPGURU/COPY Product ALLGRO`):
- Тесты сервера: `npm test -w server` — один файл: `npm test -w server -- src/core/clone.test.ts`
- Типчек/билд сервера: `npm run build -w server`
- Типчек/билд веба: `npm run build -w web`

---

## Task 1: Фикс whitelist полей оферты

**Files:**
- Modify: `server/src/core/clone.ts:573-599` (`POST_OFFER_TOP_LEVEL_WHITELIST`)
- Test: `server/src/core/clone.test.ts` (describe `stripReadonlyFields`, строки 44-125)

Убрать `ean`, `promotion`, `messageToSellerForm` (нет в схеме `SaleProductOfferRequestV1`). Добавить `b2b`, `taxSettings`, `additionalMarketplaces`, `messageToSellerSettings`. Существующий тест помечал `additionalMarketplaces` как «server-managed metadata» — его надо обновить.

- [ ] **Step 1: Написать новые падающие тесты**

В `server/src/core/clone.test.ts`, внутри `describe('stripReadonlyFields', ...)`, добавить после теста на строке 124:

```typescript
  it('keeps b2b, taxSettings, additionalMarketplaces, messageToSellerSettings', () => {
    const out = stripReadonlyFields({
      name: 'Test',
      b2b: { buyableOnlyByBusiness: true },
      taxSettings: { rate: '23' },
      additionalMarketplaces: { 'allegro-cz': { sellingMode: { price: { amount: '10', currency: 'CZK' } } } },
      messageToSellerSettings: { mode: 'OPTIONAL' },
    } as unknown as AllegroOffer);
    expect(out).toHaveProperty('b2b');
    expect(out).toHaveProperty('taxSettings');
    expect(out).toHaveProperty('additionalMarketplaces');
    expect(out).toHaveProperty('messageToSellerSettings');
  });

  it('strips ean, promotion, messageToSellerForm (not in SaleProductOfferRequestV1)', () => {
    const out = stripReadonlyFields({
      name: 'Test',
      ean: '5901234123457',
      promotion: { emphasized: true },
      messageToSellerForm: { id: 'x' },
    } as unknown as AllegroOffer);
    expect(out).not.toHaveProperty('ean');
    expect(out).not.toHaveProperty('promotion');
    expect(out).not.toHaveProperty('messageToSellerForm');
    expect(out).toHaveProperty('name', 'Test');
  });
```

- [ ] **Step 2: Обновить конфликтующий тест**

В `server/src/core/clone.test.ts` заменить тест `drops Allegro server-managed metadata (...)` (строки 72-91):

```typescript
  it('drops Allegro server-managed metadata (base, endedBy, warnings, validation, marketplace, statistics)', () => {
    const out = stripReadonlyFields({
      name: 'Test',
      base: { foo: 'bar' },
      endedBy: 'BUYER',
      warnings: ['x'],
      validation: { errors: [] },
      marketplace: { id: 'allegro-pl' },
      statistics: { sold: 5 },
    } as unknown as AllegroOffer);
    expect(out).not.toHaveProperty('base');
    expect(out).not.toHaveProperty('endedBy');
    expect(out).not.toHaveProperty('warnings');
    expect(out).not.toHaveProperty('validation');
    expect(out).not.toHaveProperty('marketplace');
    expect(out).not.toHaveProperty('statistics');
    expect(out).toHaveProperty('name', 'Test');
  });
```

- [ ] **Step 3: Запустить тесты — убедиться что падают**

Run: `npm test -w server -- src/core/clone.test.ts`
Expected: FAIL — новые тесты падают.

- [ ] **Step 4: Обновить whitelist**

В `server/src/core/clone.ts` заменить содержимое `POST_OFFER_TOP_LEVEL_WHITELIST` (строки 573-599):

```typescript
const POST_OFFER_TOP_LEVEL_WHITELIST = new Set([
	'name',
	'category',
	'productSet',
	'external',
	'description',
	'images',
	'parameters',
	'delivery',
	'payments',
	'sellingMode',
	'stock',
	'publication',
	'afterSalesServices',
	'additionalServices',
	'contact',
	'discounts',
	'location',
	'sizeTable',
	'attachments',
	'fundraisingCampaign',
	'compatibilityList',
	'language',
	'b2b',
	'taxSettings',
	'additionalMarketplaces',
	'messageToSellerSettings',
]);
```

- [ ] **Step 5: Запустить тесты — убедиться что проходят**

Run: `npm test -w server -- src/core/clone.test.ts`
Expected: PASS — все тесты `stripReadonlyFields` зелёные.

- [ ] **Step 6: Commit**

```bash
git add server/src/core/clone.ts server/src/core/clone.test.ts
git commit -m "fix: синхронизация whitelist полей оферты с SaleProductOfferRequestV1"
```

---

## Task 2: Типы GPSR и ссылок оферты

**Files:**
- Modify: `server/src/core/types.ts` (добавить типы, поправить `AllegroProductSetItem:19-23`)

Чистые декларации типов — проверяются компилятором. Используются в Task 3-7.

- [ ] **Step 1: Добавить типы**

В конец `server/src/core/types.ts` добавить:

```typescript

export interface GpsrAddress {
  countryCode: string;
  street: string;
  postalCode: string;
  city: string;
}

export interface GpsrContact {
  email?: string;
  phoneNumber?: string;
  formUrl?: string;
}

export interface ResponsiblePerson {
  id: string;
  name: string;
  personalData: {
    name: string;
    address: GpsrAddress;
    contact: GpsrContact;
  };
}

export interface ResponsibleProducer {
  id: string;
  name: string;
  producerData: {
    tradeName: string;
    address: GpsrAddress;
    contact: GpsrContact;
  };
}

/** Reference put on productSet[].responsibleProducer in the offer body. */
export type ResponsibleProducerRef =
  | { type: 'ID'; id: string }
  | { type: 'NAME'; name: string };

/** Reference put on productSet[].responsiblePerson in the offer body. */
export type ResponsiblePersonRef = { id: string } | { name: string };

export interface SafetyInformationText {
  type: 'TEXT';
  description: string;
}

/**
 * Reference to an account-scoped offer dictionary entry — shipping rate,
 * return policy, implied warranty or warranty. Allegro POST accepts id or name.
 */
export interface NamedRef {
  id: string;
  name?: string;
}
```

- [ ] **Step 2: Поправить `AllegroProductSetItem`**

В `server/src/core/types.ts` заменить интерфейс `AllegroProductSetItem` (строки 19-23):

```typescript
export interface AllegroProductSetItem {
  product: AllegroProduct;
  quantity?: { value: number };
  responsiblePerson?: ResponsiblePersonRef | null;
  responsibleProducer?: ResponsibleProducerRef | null;
  safetyInformation?: SafetyInformationText | null;
  marketedBeforeGPSRObligation?: boolean | null;
}
```

(Удалено несуществующее поле `marketplaces?: unknown` — не используется в коде, см. Task 5 где `productSet` собирается явно.)

- [ ] **Step 3: Типчек**

Run: `npm run build -w server`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/core/types.ts
git commit -m "feat: типы GPSR и NamedRef для ссылок оферты"
```

---

## Task 3: Методы AllegroClient для справочников GPSR

**Files:**
- Modify: `server/src/core/allegro.ts` (импорты `:10-16`, добавить 6 методов после `getCommandStatus:205-211`)

Тонкие HTTP-обёртки над `withRetry`. В кодовой базе нет юнит-тестов для `allegro.ts` — проверяем типчеком; поведение покрыто роутами Task 7 и ручным тестом.

- [ ] **Step 1: Добавить импорты типов**

В `server/src/core/allegro.ts` заменить импорт типов (строки 10-16):

```typescript
import type {
  AllegroOffer,
  CategoryParametersResponse,
  ProductSearchHit,
  ProductSearchResponse,
  PublicationCommandStatus,
  ResponsiblePerson,
  ResponsibleProducer,
} from './types.js';
```

- [ ] **Step 2: Добавить 6 методов GPSR**

В `server/src/core/allegro.ts` после метода `getCommandStatus` (после строки 211, перед `// ---- helpers required for new offer body ----`) добавить:

```typescript

  // ---- GPSR: responsible persons & producers ----

  async listResponsiblePersons(): Promise<ResponsiblePerson[]> {
    const res = await this.withRetry<{ responsiblePersons?: ResponsiblePerson[] }>({
      method: 'GET',
      url: '/sale/responsible-persons',
      params: { limit: 1000 },
    });
    return res.data.responsiblePersons ?? [];
  }

  async getResponsiblePerson(id: string): Promise<ResponsiblePerson> {
    const res = await this.withRetry<ResponsiblePerson>({
      method: 'GET',
      url: `/sale/responsible-persons/${encodeURIComponent(id)}`,
    });
    return res.data;
  }

  async createResponsiblePerson(body: unknown): Promise<ResponsiblePerson> {
    const res = await this.withRetry<ResponsiblePerson>({
      method: 'POST',
      url: '/sale/responsible-persons',
      data: body,
    });
    return res.data;
  }

  async listResponsibleProducers(): Promise<ResponsibleProducer[]> {
    const res = await this.withRetry<{ responsibleProducers?: ResponsibleProducer[] }>({
      method: 'GET',
      url: '/sale/responsible-producers',
      params: { limit: 1000 },
    });
    return res.data.responsibleProducers ?? [];
  }

  async getResponsibleProducer(id: string): Promise<ResponsibleProducer> {
    const res = await this.withRetry<ResponsibleProducer>({
      method: 'GET',
      url: `/sale/responsible-producers/${encodeURIComponent(id)}`,
    });
    return res.data;
  }

  async createResponsibleProducer(body: unknown): Promise<ResponsibleProducer> {
    const res = await this.withRetry<ResponsibleProducer>({
      method: 'POST',
      url: '/sale/responsible-producers',
      data: body,
    });
    return res.data;
  }
```

- [ ] **Step 3: Типчек**

Run: `npm run build -w server`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/core/allegro.ts
git commit -m "feat: методы AllegroClient для справочников GPSR"
```

---

## Task 4: Методы AllegroClient для ссылок оферты

**Files:**
- Modify: `server/src/core/allegro.ts` (добавить методы после `listImpliedWarranties:236-244`)

`listShippingRates` / `listReturnPolicies` / `listImpliedWarranties` уже есть. Добавляем `listWarranties` (нет в коде) + 4 get-by-id метода — превью использует их, чтобы дотянуть **имя** ссылки источника (GET оферты отдаёт только `{id}`).

- [ ] **Step 1: Добавить 5 методов**

В `server/src/core/allegro.ts` после метода `listImpliedWarranties` (после строки 244, перед `// ---- catalog search + product proposals ----`) добавить:

```typescript

  async listWarranties(): Promise<Array<{ id: string; name: string }>> {
    const res = await this.withRetry<{
      warranties: Array<{ id: string; name: string }>;
    }>({
      method: 'GET',
      url: '/after-sales-service-conditions/warranties',
    });
    return res.data.warranties ?? [];
  }

  async getShippingRate(id: string): Promise<{ id: string; name?: string }> {
    const res = await this.withRetry<{ id: string; name?: string }>({
      method: 'GET',
      url: `/sale/shipping-rates/${encodeURIComponent(id)}`,
    });
    return res.data;
  }

  async getReturnPolicy(id: string): Promise<{ id: string; name?: string }> {
    const res = await this.withRetry<{ id: string; name?: string }>({
      method: 'GET',
      url: `/after-sales-service-conditions/return-policies/${encodeURIComponent(id)}`,
    });
    return res.data;
  }

  async getImpliedWarranty(id: string): Promise<{ id: string; name?: string }> {
    const res = await this.withRetry<{ id: string; name?: string }>({
      method: 'GET',
      url: `/after-sales-service-conditions/implied-warranties/${encodeURIComponent(id)}`,
    });
    return res.data;
  }

  async getWarranty(id: string): Promise<{ id: string; name?: string }> {
    const res = await this.withRetry<{ id: string; name?: string }>({
      method: 'GET',
      url: `/after-sales-service-conditions/warranties/${encodeURIComponent(id)}`,
    });
    return res.data;
  }
```

- [ ] **Step 2: Типчек**

Run: `npm run build -w server`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/core/allegro.ts
git commit -m "feat: listWarranties + get-by-id методы для ссылок оферты"
```

---

## Task 5: Перенос GPSR в `buildCloneBody`

**Files:**
- Modify: `server/src/core/clone.ts` (импорты `:1-8`, `CloneOptions:18-46`, конструкция `productSet:371-382`, добавить `resolveGpsr`)
- Test: `server/src/core/clone.test.ts` (импорты `:1-9`, новый describe-блок)

`productSet[0]` собирается явно, GPSR-поля проставляет хелпер `resolveGpsr`: операторский override → carry для того же аккаунта → drop+warn для кросс-аккаунта. `safetyInformation` и `marketedBeforeGPSRObligation` — account-agnostic, переносятся всегда.

- [ ] **Step 1: Написать падающие тесты**

В `server/src/core/clone.test.ts` заменить импорт типов (строки 1-9):

```typescript
import { describe, expect, it } from 'vitest';
import {
  stripReadonlyFields,
  substituteValueVariants,
  buildCloneBody,
  cloneOffer,
} from './clone.js';
import type { AllegroOffer, AllegroProductSetItem } from './types.js';
import type { AllegroClient } from './allegro.js';
```

В конец файла `server/src/core/clone.test.ts` добавить:

```typescript

describe('buildCloneBody — GPSR', () => {
  const baseProduct = {
    id: 'PROD-256',
    name: 'Lenovo IdeaPad 5',
    category: { id: '491' },
    parameters: [{ id: 'P_RAM', name: 'Pamięć RAM', values: ['16 GB'] }],
  };

  const gpsrOffer: AllegroOffer = {
    id: 'src-1',
    name: 'Lenovo IdeaPad 5',
    category: { id: '491' },
    productSet: [
      {
        product: baseProduct,
        quantity: { value: 1 },
        responsibleProducer: { type: 'ID', id: 'PROD-SRC-1' },
        responsiblePerson: { id: 'PERSON-SRC-1' },
        safetyInformation: { type: 'TEXT', description: 'Safe to use.' },
        marketedBeforeGPSRObligation: true,
      },
    ],
    sellingMode: { format: 'BUY_NOW', price: { amount: '2999.00', currency: 'PLN' } },
    stock: { available: 1, unit: 'UNIT' },
    publication: { status: 'ACTIVE' as const },
  };

  function gpsrClient(): AllegroClient {
    return {
      getProduct: async (id: string) => ({
        id,
        name: baseProduct.name,
        category: baseProduct.category,
        parameters: baseProduct.parameters,
      }),
      searchProducts: async () => ({ products: [] }),
    } as unknown as AllegroClient;
  }

  it('same-account: carries source responsibleProducer/Person by id', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const { body } = await buildCloneBody(
      gpsrClient(),
      gpsrOffer,
      { sourceOfferId: 'src-1', paramOverrides: {} },
      steps,
    );
    const item = (body as { productSet: AllegroProductSetItem[] }).productSet[0];
    expect(item.responsibleProducer).toEqual({ type: 'ID', id: 'PROD-SRC-1' });
    expect(item.responsiblePerson).toEqual({ id: 'PERSON-SRC-1' });
    expect(item.safetyInformation).toEqual({ type: 'TEXT', description: 'Safe to use.' });
    expect(item.marketedBeforeGPSRObligation).toBe(true);
  });

  it('cross-account: drops producer/person ids and warns; keeps safetyInformation', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const { body } = await buildCloneBody(
      gpsrClient(),
      gpsrOffer,
      { sourceOfferId: 'src-1', paramOverrides: {} },
      steps,
      gpsrClient(),
    );
    const item = (body as { productSet: AllegroProductSetItem[] }).productSet[0];
    expect(item.responsibleProducer).toBeUndefined();
    expect(item.responsiblePerson).toBeUndefined();
    expect(item.safetyInformation).toEqual({ type: 'TEXT', description: 'Safe to use.' });
    expect(item.marketedBeforeGPSRObligation).toBe(true);
    expect(steps.some(s => s.level === 'warn' && /GPSR/.test(s.message))).toBe(true);
  });

  it('applies options.gpsr over the source', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const { body } = await buildCloneBody(
      gpsrClient(),
      gpsrOffer,
      {
        sourceOfferId: 'src-1',
        paramOverrides: {},
        gpsr: {
          responsibleProducer: { type: 'ID', id: 'PROD-TGT-9' },
          responsiblePerson: { id: 'PERSON-TGT-9' },
          safetyInformation: { type: 'TEXT', description: 'New text.' },
        },
      },
      steps,
    );
    const item = (body as { productSet: AllegroProductSetItem[] }).productSet[0];
    expect(item.responsibleProducer).toEqual({ type: 'ID', id: 'PROD-TGT-9' });
    expect(item.responsiblePerson).toEqual({ id: 'PERSON-TGT-9' });
    expect(item.safetyInformation).toEqual({ type: 'TEXT', description: 'New text.' });
  });

  it('omits a GPSR field when options.gpsr sets it to null', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const { body } = await buildCloneBody(
      gpsrClient(),
      gpsrOffer,
      {
        sourceOfferId: 'src-1',
        paramOverrides: {},
        gpsr: {
          responsibleProducer: null,
          responsiblePerson: null,
          safetyInformation: null,
        },
      },
      steps,
    );
    const item = (body as { productSet: AllegroProductSetItem[] }).productSet[0];
    expect(item.responsibleProducer).toBeUndefined();
    expect(item.responsiblePerson).toBeUndefined();
    expect(item.safetyInformation).toBeUndefined();
  });

  it('does not leak productSet[].marketplaces from the source', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const offerWithMarketplaces = {
      ...gpsrOffer,
      productSet: [
        {
          product: baseProduct,
          quantity: { value: 1 },
          marketplaces: { 'allegro-cz': { foo: 'bar' } },
        },
      ],
    } as unknown as AllegroOffer;
    const { body } = await buildCloneBody(
      gpsrClient(),
      offerWithMarketplaces,
      { sourceOfferId: 'src-1', paramOverrides: {} },
      steps,
    );
    const item = (body as { productSet: Record<string, unknown>[] }).productSet[0];
    expect(item).not.toHaveProperty('marketplaces');
  });
});
```

- [ ] **Step 2: Запустить тесты — убедиться что падают**

Run: `npm test -w server -- src/core/clone.test.ts`
Expected: FAIL — describe `buildCloneBody — GPSR` падает.

- [ ] **Step 3: Добавить импорты типов в `clone.ts`**

В `server/src/core/clone.ts` заменить импорт типов (строки 1-8):

```typescript
import type { AllegroClient } from './allegro.js';
import type {
	AllegroOffer,
	AllegroParameter,
	AllegroProduct,
	AllegroProductSetItem,
	ProductSearchHit,
	PublicationCommandStatus,
	ResponsibleProducerRef,
	ResponsiblePersonRef,
	SafetyInformationText,
} from './types.js';
```

- [ ] **Step 4: Добавить поле `gpsr` в `CloneOptions`**

В `server/src/core/clone.ts` в интерфейсе `CloneOptions` добавить перед `dryRun?: boolean;` (перед строкой 45):

```typescript
	/**
	 * GPSR data confirmed by the operator in the UI (GpsrPanel). Applied to
	 * productSet[0]. A field set to `null` means "explicitly clear" — omitted
	 * from the body. A field left `undefined` falls back to source carry-over.
	 */
	gpsr?: {
		responsibleProducer?: ResponsibleProducerRef | null;
		responsiblePerson?: ResponsiblePersonRef | null;
		safetyInformation?: SafetyInformationText | null;
	};
```

- [ ] **Step 5: Добавить функцию `resolveGpsr`**

В `server/src/core/clone.ts` перед функцией `stripProductLevelFields` (перед строкой 415) добавить:

```typescript
type GpsrFields = Pick<
	AllegroProductSetItem,
	| 'responsibleProducer'
	| 'responsiblePerson'
	| 'safetyInformation'
	| 'marketedBeforeGPSRObligation'
>;

/**
 * Decide which GPSR fields go on the cloned productSet item.
 *  - options.gpsr set        → operator confirmed values; non-null applied,
 *    `null` is an explicit "clear" → omitted.
 *  - same account, no override → carry source's GPSR refs as-is (ids valid).
 *  - cross account, no override → producer/person ids belong to the SOURCE
 *    account's dictionary and are invalid in the target — drop them and warn.
 * safetyInformation (TEXT, no id) and marketedBeforeGPSRObligation (boolean)
 * are account-agnostic, so they always carry from the source.
 */
function resolveGpsr(
	sourceItem: AllegroProductSetItem | undefined,
	options: CloneOptions,
	crossAccount: boolean,
	steps: CloneStep[],
): GpsrFields {
	const out: GpsrFields = {};

	if (sourceItem?.safetyInformation) {
		out.safetyInformation = sourceItem.safetyInformation;
	}
	if (sourceItem?.marketedBeforeGPSRObligation != null) {
		out.marketedBeforeGPSRObligation = sourceItem.marketedBeforeGPSRObligation;
	}

	if (options.gpsr) {
		const g = options.gpsr;
		if (g.responsibleProducer) out.responsibleProducer = g.responsibleProducer;
		if (g.responsiblePerson) out.responsiblePerson = g.responsiblePerson;
		if (g.safetyInformation) out.safetyInformation = g.safetyInformation;
		else if (g.safetyInformation === null) delete out.safetyInformation;
		return out;
	}

	if (sourceItem?.responsibleProducer || sourceItem?.responsiblePerson) {
		if (crossAccount) {
			steps.push({
				level: 'warn',
				message:
					'GPSR источника не перенесён (id чужого аккаунта) — укажи производителя/лицо в GPSR-панели',
			});
		} else {
			if (sourceItem.responsibleProducer)
				out.responsibleProducer = sourceItem.responsibleProducer;
			if (sourceItem.responsiblePerson)
				out.responsiblePerson = sourceItem.responsiblePerson;
		}
	}

	return out;
}
```

- [ ] **Step 6: Переделать конструкцию `productSet` на явную**

В `server/src/core/clone.ts` заменить блок `productSet:` внутри `body` (строки 371-382):

```typescript
		productSet: [
			{
				product: newProduct,
				// productSet quantity = how many units of the product are in this set
				// (almost always 1 for laptops). It's NOT the available stock — and Allegro
				// requires it to be ≥ 1, so we never let it slip to 0 even if source said so.
				quantity: {
					value: Math.max(1, productSetItem?.quantity?.value ?? 1),
				},
				// GPSR fields are set explicitly — blindly spreading productSetItem
				// would carry foreign-account ids on a cross-account clone and leak
				// non-schema fields like `marketplaces`.
				...resolveGpsr(productSetItem, options, crossAccount, steps),
			},
		],
```

- [ ] **Step 7: Запустить тесты — убедиться что проходят**

Run: `npm test -w server -- src/core/clone.test.ts`
Expected: PASS — все тесты `clone.test.ts` зелёные.

- [ ] **Step 8: Типчек**

Run: `npm run build -w server`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/core/clone.ts server/src/core/clone.test.ts
git commit -m "feat: перенос GPSR при клоне (carry / cross-account warn / operator override)"
```

---

## Task 6: Перенос ссылок оферты в `buildCloneBody`

**Files:**
- Modify: `server/src/core/clone.ts` (`CloneOptions`, добавить `resolveOfferRefs`, спред в `body`)
- Test: `server/src/core/clone.test.ts` (новый describe-блок)

`delivery.shippingRates`, `afterSalesServices.{returnPolicy,impliedWarranty,warranty}`, `discounts.wholesalePriceList` проходят через `resolveOfferRefs`: override → same-account carry → cross-account drop+warn. Прочие поля `delivery`/`afterSalesServices`/`discounts` переносятся всегда.

- [ ] **Step 1: Написать падающие тесты**

В конец файла `server/src/core/clone.test.ts` добавить:

```typescript

describe('buildCloneBody — offer refs', () => {
  const baseProduct = {
    id: 'PROD-256',
    name: 'Lenovo IdeaPad 5',
    category: { id: '491' },
    parameters: [{ id: 'P_RAM', name: 'Pamięć RAM', values: ['16 GB'] }],
  };

  const refsOffer: AllegroOffer = {
    id: 'src-1',
    name: 'Lenovo IdeaPad 5',
    category: { id: '491' },
    productSet: [{ product: baseProduct, quantity: { value: 1 } }],
    sellingMode: { format: 'BUY_NOW', price: { amount: '1', currency: 'PLN' } },
    stock: { available: 1, unit: 'UNIT' },
    publication: { status: 'ACTIVE' as const },
    delivery: { handlingTime: 'PT24H', shippingRates: { id: 'SR-SRC' } },
    afterSalesServices: {
      returnPolicy: { id: 'RP-SRC' },
      impliedWarranty: { id: 'IW-SRC' },
      warranty: { id: 'WR-SRC' },
    },
    discounts: { wholesalePriceList: { id: 'WPL-SRC' } },
  } as AllegroOffer;

  function refsClient(): AllegroClient {
    return {
      getProduct: async (id: string) => ({
        id,
        name: baseProduct.name,
        category: baseProduct.category,
        parameters: baseProduct.parameters,
      }),
      searchProducts: async () => ({ products: [] }),
    } as unknown as AllegroClient;
  }

  it('same-account: carries delivery/afterSalesServices refs and wholesalePriceList', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const { body } = await buildCloneBody(
      refsClient(),
      refsOffer,
      { sourceOfferId: 'src-1', paramOverrides: {} },
      steps,
    );
    const b = body as {
      delivery: { handlingTime?: string; shippingRates?: { id: string } };
      afterSalesServices: {
        returnPolicy?: { id: string };
        impliedWarranty?: { id: string };
        warranty?: { id: string };
      };
      discounts: { wholesalePriceList?: { id: string } };
    };
    expect(b.delivery.shippingRates).toEqual({ id: 'SR-SRC' });
    expect(b.delivery.handlingTime).toBe('PT24H');
    expect(b.afterSalesServices.returnPolicy).toEqual({ id: 'RP-SRC' });
    expect(b.afterSalesServices.impliedWarranty).toEqual({ id: 'IW-SRC' });
    expect(b.afterSalesServices.warranty).toEqual({ id: 'WR-SRC' });
    expect(b.discounts.wholesalePriceList).toEqual({ id: 'WPL-SRC' });
  });

  it('cross-account: drops account-scoped ids + warns, keeps other delivery fields', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const { body } = await buildCloneBody(
      refsClient(),
      refsOffer,
      { sourceOfferId: 'src-1', paramOverrides: {} },
      steps,
      refsClient(),
    );
    const b = body as {
      delivery: { handlingTime?: string; shippingRates?: { id: string } };
      afterSalesServices: { returnPolicy?: unknown; impliedWarranty?: unknown; warranty?: unknown };
      discounts: { wholesalePriceList?: unknown };
    };
    expect(b.delivery.shippingRates).toBeUndefined();
    expect(b.delivery.handlingTime).toBe('PT24H');
    expect(b.afterSalesServices.returnPolicy).toBeUndefined();
    expect(b.afterSalesServices.impliedWarranty).toBeUndefined();
    expect(b.afterSalesServices.warranty).toBeUndefined();
    expect(b.discounts.wholesalePriceList).toBeUndefined();
    expect(steps.filter(s => s.level === 'warn').length).toBeGreaterThanOrEqual(2);
  });

  it('applies options.offerRefs over the source', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const { body } = await buildCloneBody(
      refsClient(),
      refsOffer,
      {
        sourceOfferId: 'src-1',
        paramOverrides: {},
        offerRefs: {
          shippingRates: { id: 'SR-TGT' },
          returnPolicy: { name: 'Zwroty 14 dni' },
          impliedWarranty: null,
        },
      },
      steps,
      refsClient(),
    );
    const b = body as {
      delivery: { shippingRates?: { id: string } };
      afterSalesServices: {
        returnPolicy?: { name: string };
        impliedWarranty?: unknown;
        warranty?: unknown;
      };
    };
    expect(b.delivery.shippingRates).toEqual({ id: 'SR-TGT' });
    expect(b.afterSalesServices.returnPolicy).toEqual({ name: 'Zwroty 14 dni' });
    expect(b.afterSalesServices.impliedWarranty).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустить тесты — убедиться что падают**

Run: `npm test -w server -- src/core/clone.test.ts`
Expected: FAIL — describe `buildCloneBody — offer refs` падает.

- [ ] **Step 3: Добавить поле `offerRefs` в `CloneOptions`**

В `server/src/core/clone.ts` в интерфейсе `CloneOptions` сразу после поля `gpsr` (добавленного в Task 5) добавить:

```typescript
	/**
	 * Account-scoped offer dictionary references confirmed by the operator in
	 * the UI (OfferRefsPanel). Each value: `{ id }` or `{ name }` to set,
	 * `null` to clear, `undefined` to fall back to source carry-over.
	 */
	offerRefs?: {
		shippingRates?: { id: string } | { name: string } | null;
		returnPolicy?: { id: string } | { name: string } | null;
		impliedWarranty?: { id: string } | { name: string } | null;
		warranty?: { id: string } | { name: string } | null;
	};
```

- [ ] **Step 4: Добавить функцию `resolveOfferRefs`**

В `server/src/core/clone.ts` сразу после функции `resolveGpsr` (добавленной в Task 5) добавить:

```typescript
/**
 * Resolve account-scoped offer references for the clone:
 *  - options.offerRefs.X set → apply (`{id}`/`{name}`, `null` clears).
 *  - same account, no override → carry the source's ref as-is.
 *  - cross account, no override → the id belongs to the source account's
 *    dictionary and is invalid in the target — drop it and warn.
 * Non-ref fields of delivery/afterSalesServices/discounts always carry.
 * wholesalePriceList has no UI override: same-account carries, cross-account
 * drops it.
 */
function resolveOfferRefs(
	source: AllegroOffer,
	options: CloneOptions,
	crossAccount: boolean,
	steps: CloneStep[],
): { delivery?: unknown; afterSalesServices?: unknown; discounts?: unknown } {
	const out: {
		delivery?: Record<string, unknown>;
		afterSalesServices?: Record<string, unknown>;
		discounts?: Record<string, unknown>;
	} = {};

	const resolveRef = (
		label: string,
		sourceRef: { id?: string; name?: string } | undefined,
		override: { id: string } | { name: string } | null | undefined,
	): { id: string } | { name: string } | undefined => {
		if (override !== undefined) return override === null ? undefined : override;
		if (!sourceRef) return undefined;
		if (!crossAccount) return sourceRef.id ? { id: sourceRef.id } : undefined;
		steps.push({
			level: 'warn',
			message: `${label} источника не перенесён (id чужого аккаунта) — укажи в панели «Справочники оферты»`,
		});
		return undefined;
	};

	// delivery — keep all source fields, replace only shippingRates.
	if (source.delivery || options.offerRefs?.shippingRates !== undefined) {
		const delivery: Record<string, unknown> = { ...(source.delivery ?? {}) };
		const shippingRates = resolveRef(
			'Cennik dostawy',
			source.delivery?.shippingRates as { id?: string } | undefined,
			options.offerRefs?.shippingRates,
		);
		if (shippingRates) delivery.shippingRates = shippingRates;
		else delete delivery.shippingRates;
		out.delivery = delivery;
	}

	// afterSalesServices — replace the three account-scoped refs.
	const srcAss = source.afterSalesServices;
	if (srcAss || options.offerRefs) {
		const ass: Record<string, unknown> = { ...(srcAss ?? {}) };
		const rp = resolveRef('Warunki zwrotów', srcAss?.returnPolicy ?? undefined, options.offerRefs?.returnPolicy);
		const iw = resolveRef('Reklamacje', srcAss?.impliedWarranty ?? undefined, options.offerRefs?.impliedWarranty);
		const wr = resolveRef('Gwarancja', srcAss?.warranty ?? undefined, options.offerRefs?.warranty);
		if (rp) ass.returnPolicy = rp;
		else delete ass.returnPolicy;
		if (iw) ass.impliedWarranty = iw;
		else delete ass.impliedWarranty;
		if (wr) ass.warranty = wr;
		else delete ass.warranty;
		if (Object.keys(ass).length > 0) out.afterSalesServices = ass;
	}

	// discounts.wholesalePriceList — account-scoped promotion id, no UI override.
	const srcDiscounts = source.discounts as Record<string, unknown> | undefined;
	if (srcDiscounts) {
		const discounts = { ...srcDiscounts };
		if (crossAccount && 'wholesalePriceList' in discounts) {
			delete discounts.wholesalePriceList;
			steps.push({
				level: 'warn',
				message: 'Cennik hurtowy источника не перенесён (id чужого аккаунта)',
			});
		}
		out.discounts = discounts;
	}

	return out;
}
```

- [ ] **Step 5: Применить `resolveOfferRefs` в `body`**

В `server/src/core/clone.ts` в литерале `body` (внутри вызова `stripReadonlyFields({ ... })`) добавить спред сразу после блока `publication: { ... }` (после строки 396, перед закрывающей `}` объекта):

```typescript
		publication: {
			...(source.publication ?? {}),
			status: options.publicationStatus ?? 'INACTIVE',
		},
		// delivery / afterSalesServices / discounts: resolve account-scoped refs
		// (shipping rates, return policy, warranties, wholesale price list) —
		// must come after ...baseOffer so it overrides the source's copies.
		...resolveOfferRefs(source, options, crossAccount, steps),
```

- [ ] **Step 6: Запустить тесты — убедиться что проходят**

Run: `npm test -w server -- src/core/clone.test.ts`
Expected: PASS — все тесты `clone.test.ts` зелёные.

- [ ] **Step 7: Типчек**

Run: `npm run build -w server`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/core/clone.ts server/src/core/clone.test.ts
git commit -m "feat: перенос ссылок оферты при клоне (delivery / afterSalesServices / wholesalePriceList)"
```

---

## Task 7: Роуты GPSR + helpers, `gpsr`/`offerRefs` в схеме и превью

**Files:**
- Modify: `server/src/routes/api.ts` (импорты `:1-6`, схемы после `:50`, `cloneSchema:39-50`, `/offers/:id/preview:108-133`, роуты после `/helpers/implied-warranties:189-195`)

Проверка типчеком + smoke-загрузкой модуля (в кодовой базе нет тестового харнеса для роутов).

- [ ] **Step 1: Добавить импорт типа `AllegroOffer`**

В `server/src/routes/api.ts` после строки 6 добавить:

```typescript
import type { AllegroOffer } from '../core/types.js';
```

- [ ] **Step 2: Добавить zod-схемы и хелперы превью**

В `server/src/routes/api.ts` после `cloneSchema` (после строки 50) добавить:

```typescript

// 27 EU ISO-3166 codes accepted by Allegro for responsible persons.
const EU_COUNTRY_CODES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'GR', 'ES', 'IE',
  'LT', 'LU', 'LV', 'MT', 'NL', 'DE', 'PL', 'PT', 'RO', 'SK', 'SI', 'SE', 'HU', 'IT',
] as const;

const gpsrContactSchema = z
  .object({
    email: z.string().max(50).optional(),
    phoneNumber: z.string().max(30).optional(),
    formUrl: z.string().max(80).optional(),
  })
  .refine((c) => !!c.email || !!c.formUrl, {
    message: 'contact must have at least one of: email, formUrl',
  });

const createResponsiblePersonSchema = z.object({
  name: z.string().min(1).max(50),
  personalData: z.object({
    name: z.string().min(1).max(200),
    address: z.object({
      countryCode: z.enum(EU_COUNTRY_CODES),
      street: z.string().min(1).max(200),
      postalCode: z.string().min(1).max(20),
      city: z.string().min(1).max(100),
    }),
    contact: gpsrContactSchema,
  }),
});

const createResponsibleProducerSchema = z.object({
  name: z.string().min(1).max(50),
  producerData: z.object({
    tradeName: z.string().min(1).max(200),
    address: z.object({
      countryCode: z.string().regex(/^[A-Z]{2}$/),
      street: z.string().min(1).max(200),
      postalCode: z.string().min(1).max(20),
      city: z.string().min(1).max(100),
    }),
    contact: gpsrContactSchema,
  }),
});

/** Read GPSR off offer.productSet[0], resolving id refs to full records. */
async function resolveOfferGpsr(client: AllegroClient, offer: AllegroOffer) {
  const item = offer.productSet?.[0];
  if (!item) return null;
  const out: {
    responsibleProducer?: unknown;
    responsiblePerson?: unknown;
    safetyInformation?: unknown;
    marketedBeforeGPSRObligation?: boolean | null;
  } = {};

  const rp = item.responsibleProducer;
  if (rp && 'type' in rp) {
    if (rp.type === 'ID' && rp.id) {
      try {
        out.responsibleProducer = await client.getResponsibleProducer(rp.id);
      } catch {
        out.responsibleProducer = rp;
      }
    } else {
      out.responsibleProducer = rp;
    }
  }

  const rpe = item.responsiblePerson;
  if (rpe) {
    if ('id' in rpe && rpe.id) {
      try {
        out.responsiblePerson = await client.getResponsiblePerson(rpe.id);
      } catch {
        out.responsiblePerson = rpe;
      }
    } else {
      out.responsiblePerson = rpe;
    }
  }

  if (item.safetyInformation) out.safetyInformation = item.safetyInformation;
  if (item.marketedBeforeGPSRObligation != null)
    out.marketedBeforeGPSRObligation = item.marketedBeforeGPSRObligation;

  return out;
}

/** Resolve account-scoped offer refs to { id, name } so the UI can match. */
async function resolveOfferRefsPreview(client: AllegroClient, offer: AllegroOffer) {
  const out: {
    shippingRates?: { id: string; name?: string };
    returnPolicy?: { id: string; name?: string };
    impliedWarranty?: { id: string; name?: string };
    warranty?: { id: string; name?: string };
  } = {};

  const srId = (offer.delivery?.shippingRates as { id?: string } | undefined)?.id;
  if (srId) {
    try {
      out.shippingRates = { id: srId, name: (await client.getShippingRate(srId)).name };
    } catch {
      out.shippingRates = { id: srId };
    }
  }

  const ass = offer.afterSalesServices;
  if (ass?.returnPolicy?.id) {
    const id = ass.returnPolicy.id;
    try {
      out.returnPolicy = { id, name: (await client.getReturnPolicy(id)).name };
    } catch {
      out.returnPolicy = { id };
    }
  }
  if (ass?.impliedWarranty?.id) {
    const id = ass.impliedWarranty.id;
    try {
      out.impliedWarranty = { id, name: (await client.getImpliedWarranty(id)).name };
    } catch {
      out.impliedWarranty = { id };
    }
  }
  if (ass?.warranty?.id) {
    const id = ass.warranty.id;
    try {
      out.warranty = { id, name: (await client.getWarranty(id)).name };
    } catch {
      out.warranty = { id };
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}
```

- [ ] **Step 3: Добавить `gpsr` и `offerRefs` в `cloneSchema`**

В `server/src/routes/api.ts` в `cloneSchema` (строки 39-50) добавить два поля перед `dryRun:`:

```typescript
  gpsr: z
    .object({
      responsibleProducer: z
        .union([
          z.object({ type: z.literal('ID'), id: z.string().min(1) }),
          z.object({ type: z.literal('NAME'), name: z.string().min(1) }),
          z.null(),
        ])
        .optional(),
      responsiblePerson: z
        .union([
          z.object({ id: z.string().min(1) }),
          z.object({ name: z.string().min(1) }),
          z.null(),
        ])
        .optional(),
      safetyInformation: z
        .union([
          z.object({ type: z.literal('TEXT'), description: z.string().max(5000) }),
          z.null(),
        ])
        .optional(),
    })
    .optional(),
  offerRefs: z
    .object({
      shippingRates: z
        .union([z.object({ id: z.string().min(1) }), z.object({ name: z.string().min(1) }), z.null()])
        .optional(),
      returnPolicy: z
        .union([z.object({ id: z.string().min(1) }), z.object({ name: z.string().min(1) }), z.null()])
        .optional(),
      impliedWarranty: z
        .union([z.object({ id: z.string().min(1) }), z.object({ name: z.string().min(1) }), z.null()])
        .optional(),
      warranty: z
        .union([z.object({ id: z.string().min(1) }), z.object({ name: z.string().min(1) }), z.null()])
        .optional(),
    })
    .optional(),
```

- [ ] **Step 4: Добавить `gpsr` и `offerRefs` в ответ `/offers/:id/preview`**

В `server/src/routes/api.ts` заменить тело роута `/offers/:id/preview` (строки 108-133):

```typescript
  r.get('/offers/:id/preview', async (req, res, next) => {
    try {
      const client = req.allegro!;
      const offer = await client.getOffer(req.params.id);
      const sourceProductId = offer.productSet?.[0]?.product?.id;
      const product = sourceProductId ? await client.getProduct(sourceProductId) : null;
      const categoryId = offer.category?.id ?? offer.productSet?.[0]?.product?.category?.id;
      const categoryParameters = categoryId
        ? await client.getCategoryParameters(categoryId)
        : null;
      const gpsr = await resolveOfferGpsr(client, offer);
      const offerRefs = await resolveOfferRefsPreview(client, offer);
      res.json({
        id: offer.id,
        name: offer.name,
        publication: offer.publication,
        sellingMode: offer.sellingMode,
        stock: offer.stock,
        product,
        parameters: product?.parameters ?? offer.productSet?.[0]?.product?.parameters ?? [],
        categoryParameters: categoryParameters?.parameters ?? [],
        description: offer.description ?? null,
        images: offer.images ?? [],
        gpsr,
        offerRefs,
      });
    } catch (e) {
      next(e);
    }
  });
```

- [ ] **Step 5: Добавить роуты GPSR и `/helpers/warranties`**

В `server/src/routes/api.ts` после роута `/helpers/implied-warranties` (после строки 195) добавить:

```typescript

  r.get('/helpers/warranties', async (req, res, next) => {
    try {
      res.json(await req.allegro!.listWarranties());
    } catch (e) {
      next(e);
    }
  });

  // --- GPSR: responsible persons & producers ---

  r.get('/gpsr/responsible-persons', async (req, res, next) => {
    try {
      res.json({ responsiblePersons: await req.allegro!.listResponsiblePersons() });
    } catch (e) {
      next(e);
    }
  });

  r.get('/gpsr/responsible-producers', async (req, res, next) => {
    try {
      res.json({ responsibleProducers: await req.allegro!.listResponsibleProducers() });
    } catch (e) {
      next(e);
    }
  });

  r.post('/gpsr/responsible-persons', async (req, res, next) => {
    const parsed = createResponsiblePersonSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'VALIDATION', details: parsed.error.format() });
    }
    try {
      res.status(201).json(await req.allegro!.createResponsiblePerson(parsed.data));
    } catch (e) {
      next(e);
    }
  });

  r.post('/gpsr/responsible-producers', async (req, res, next) => {
    const parsed = createResponsibleProducerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'VALIDATION', details: parsed.error.format() });
    }
    try {
      res.status(201).json(await req.allegro!.createResponsibleProducer(parsed.data));
    } catch (e) {
      next(e);
    }
  });
```

Примечание: `pickAccount` middleware разруливает аккаунт (POST — `body.accountId`, GET — `X-Account-Id`). zod-схемы вырезают неизвестные ключи, `accountId` из тела не уйдёт в Allegro.

- [ ] **Step 6: Типчек + smoke-загрузка**

Run: `npm run build -w server && node -e "import('./server/dist/routes/api.js').then(() => console.log('routes module OK'))"`
Expected: PASS + выводит `routes module OK`.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/api.ts
git commit -m "feat: роуты /api/gpsr/*, /api/helpers/warranties, gpsr+offerRefs в схеме и превью"
```

---

## Task 8: Веб-клиент `api.ts` — типы и методы

**Files:**
- Modify: `web/src/api.ts` (типы после `:42`, `OfferPreview:68-92`, `ClonePayload:44-57`, объект `api`)

Веб без юнит-тестов — проверка типчеком (`npm run build -w web`).

- [ ] **Step 1: Добавить типы**

В `web/src/api.ts` после интерфейса `DescriptionSections` (после строки 42) добавить:

```typescript

export interface GpsrAddress {
  countryCode: string;
  street: string;
  postalCode: string;
  city: string;
}

export interface GpsrContact {
  email?: string;
  phoneNumber?: string;
  formUrl?: string;
}

export interface ResponsiblePerson {
  id: string;
  name: string;
  personalData: { name: string; address: GpsrAddress; contact: GpsrContact };
}

export interface ResponsibleProducer {
  id: string;
  name: string;
  producerData: { tradeName: string; address: GpsrAddress; contact: GpsrContact };
}

export type ResponsibleProducerRef =
  | { type: 'ID'; id: string }
  | { type: 'NAME'; name: string };

export type ResponsiblePersonRef = { id: string } | { name: string };

export interface SafetyInformationText {
  type: 'TEXT';
  description: string;
}

/** GPSR data read off the source offer's productSet[0] (preview). */
export interface OfferGpsr {
  responsibleProducer?: ResponsibleProducer | { type: 'NAME'; name: string };
  responsiblePerson?: ResponsiblePerson | { name: string };
  safetyInformation?: SafetyInformationText;
  marketedBeforeGPSRObligation?: boolean | null;
}

/** Account-scoped offer dictionary reference (shipping rate, return policy, …). */
export interface NamedRef {
  id: string;
  name?: string;
}

/** Account-scoped offer refs read off the source offer (preview). */
export interface OfferRefs {
  shippingRates?: NamedRef;
  returnPolicy?: NamedRef;
  impliedWarranty?: NamedRef;
  warranty?: NamedRef;
}

export interface CreateResponsiblePersonPayload {
  name: string;
  personalData: { name: string; address: GpsrAddress; contact: GpsrContact };
  accountId?: string;
}

export interface CreateResponsibleProducerPayload {
  name: string;
  producerData: { tradeName: string; address: GpsrAddress; contact: GpsrContact };
  accountId?: string;
}
```

- [ ] **Step 2: Добавить `gpsr` и `offerRefs` в `ClonePayload`**

В `web/src/api.ts` в интерфейсе `ClonePayload` (строки 44-57) добавить перед `dryRun?: boolean;`:

```typescript
  /** GPSR data confirmed by the operator in GpsrPanel. */
  gpsr?: {
    responsibleProducer?: ResponsibleProducerRef | null;
    responsiblePerson?: ResponsiblePersonRef | null;
    safetyInformation?: SafetyInformationText | null;
  };
  /** Account-scoped offer refs confirmed by the operator in OfferRefsPanel. */
  offerRefs?: {
    shippingRates?: { id: string } | { name: string } | null;
    returnPolicy?: { id: string } | { name: string } | null;
    impliedWarranty?: { id: string } | { name: string } | null;
    warranty?: { id: string } | { name: string } | null;
  };
```

- [ ] **Step 3: Добавить `gpsr` и `offerRefs` в `OfferPreview`**

В `web/src/api.ts` в интерфейсе `OfferPreview` (строки 68-92) добавить перед закрывающей `}` (после строки `images: Array<{ url: string } | string>;`):

```typescript
  gpsr?: OfferGpsr | null;
  offerRefs?: OfferRefs | null;
```

- [ ] **Step 4: Добавить методы `api.gpsr.*` и `api.helpers.*`**

В `web/src/api.ts` в объекте `api`, после метода `getProduct` (после его блока), добавить:

```typescript

  gpsr: {
    listPersons: (accountId?: string) =>
      http<{ responsiblePersons: ResponsiblePerson[] }>(
        '/api/gpsr/responsible-persons',
        { accountId },
      ),
    listProducers: (accountId?: string) =>
      http<{ responsibleProducers: ResponsibleProducer[] }>(
        '/api/gpsr/responsible-producers',
        { accountId },
      ),
    createPerson: (payload: CreateResponsiblePersonPayload) =>
      http<ResponsiblePerson>('/api/gpsr/responsible-persons', {
        json: payload,
        accountId: payload.accountId,
      }),
    createProducer: (payload: CreateResponsibleProducerPayload) =>
      http<ResponsibleProducer>('/api/gpsr/responsible-producers', {
        json: payload,
        accountId: payload.accountId,
      }),
  },

  helpers: {
    shippingRates: (accountId?: string) =>
      http<Array<{ id: string; name: string }>>('/api/helpers/shipping-rates', { accountId }),
    returnPolicies: (accountId?: string) =>
      http<Array<{ id: string; name: string }>>('/api/helpers/return-policies', { accountId }),
    impliedWarranties: (accountId?: string) =>
      http<Array<{ id: string; name: string }>>('/api/helpers/implied-warranties', { accountId }),
    warranties: (accountId?: string) =>
      http<Array<{ id: string; name: string }>>('/api/helpers/warranties', { accountId }),
  },
```

- [ ] **Step 5: Типчек**

Run: `npm run build -w web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/api.ts
git commit -m "feat: типы и методы GPSR + helpers в веб-клиенте api.ts"
```

---

## Task 9: Компонент `GpsrPanel`

**Files:**
- Create: `web/src/components/GpsrPanel.tsx`

Панель в колонке клона: выпадашки производителя/лица из справочника target-аккаунта, textarea текста безопасности, inline-форма создания. Префилл/матчинг из `preview.gpsr`.

- [ ] **Step 1: Создать файл компонента**

Создать `web/src/components/GpsrPanel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import {
	api,
	type ClonePayload,
	type OfferGpsr,
	type ResponsiblePerson,
	type ResponsibleProducer,
} from '../api';

interface GpsrPanelProps {
	/** GPSR read off the source offer (preview.gpsr). */
	sourceGpsr: OfferGpsr | null | undefined;
	/** Account the clone publishes to — lists are read / new entries created here. */
	publishAccountId: string;
	/** true when source account ≠ publish account (foreign-account ids invalid). */
	crossAccount: boolean;
	/** Emits the confirmed GPSR state up to App for the clone payload. */
	onChange: (gpsr: NonNullable<ClonePayload['gpsr']>) => void;
}

// 27 EU ISO codes accepted by Allegro for responsible persons. Producers accept
// any [A-Z]{2}, but an EU dropdown covers the realistic cases for both.
const EU_COUNTRY_CODES = [
	'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'GR', 'ES', 'IE',
	'LT', 'LU', 'LV', 'MT', 'NL', 'DE', 'PL', 'PT', 'RO', 'SK', 'SI', 'SE', 'HU', 'IT',
];

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** Match a source producer against the target list by trade name + postal code. */
function matchProducer(
	src: OfferGpsr['responsibleProducer'] | undefined,
	list: ResponsibleProducer[],
): ResponsibleProducer | undefined {
	if (!src) return undefined;
	if ('producerData' in src) {
		const hits = list.filter(
			p =>
				norm(p.producerData.tradeName) === norm(src.producerData.tradeName) &&
				norm(p.producerData.address.postalCode) ===
					norm(src.producerData.address.postalCode),
		);
		return hits.length === 1 ? hits[0] : undefined;
	}
	const hits = list.filter(p => norm(p.name) === norm(src.name));
	return hits.length === 1 ? hits[0] : undefined;
}

/** Match a source person against the target list by public name + postal code. */
function matchPerson(
	src: OfferGpsr['responsiblePerson'] | undefined,
	list: ResponsiblePerson[],
): ResponsiblePerson | undefined {
	if (!src) return undefined;
	if ('personalData' in src) {
		const hits = list.filter(
			p =>
				norm(p.personalData.name) === norm(src.personalData.name) &&
				norm(p.personalData.address.postalCode) ===
					norm(src.personalData.address.postalCode),
		);
		return hits.length === 1 ? hits[0] : undefined;
	}
	const hits = list.filter(p => norm(p.name) === norm(src.name));
	return hits.length === 1 ? hits[0] : undefined;
}

interface CreateFormState {
	name: string;
	publicName: string;
	countryCode: string;
	street: string;
	postalCode: string;
	city: string;
	email: string;
	phoneNumber: string;
	formUrl: string;
}

const EMPTY_FORM: CreateFormState = {
	name: '',
	publicName: '',
	countryCode: 'PL',
	street: '',
	postalCode: '',
	city: '',
	email: '',
	phoneNumber: '',
	formUrl: '',
};

export function GpsrPanel({
	sourceGpsr,
	publishAccountId,
	crossAccount,
	onChange,
}: GpsrPanelProps) {
	const [producers, setProducers] = useState<ResponsibleProducer[]>([]);
	const [persons, setPersons] = useState<ResponsiblePerson[]>([]);
	const [loading, setLoading] = useState(false);
	const [listError, setListError] = useState<string | null>(null);

	const [producerId, setProducerId] = useState('');
	const [personId, setPersonId] = useState('');
	const [safetyText, setSafetyText] = useState('');

	const [producerForm, setProducerForm] = useState<CreateFormState | null>(null);
	const [personForm, setPersonForm] = useState<CreateFormState | null>(null);
	const [createError, setCreateError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	// Load the target account's dictionaries whenever the publish account changes.
	useEffect(() => {
		if (!publishAccountId) return;
		setLoading(true);
		setListError(null);
		Promise.all([
			api.gpsr.listProducers(publishAccountId),
			api.gpsr.listPersons(publishAccountId),
		])
			.then(([pr, pe]) => {
				setProducers(pr.responsibleProducers ?? []);
				setPersons(pe.responsiblePersons ?? []);
			})
			.catch(e => setListError((e as Error).message))
			.finally(() => setLoading(false));
	}, [publishAccountId]);

	// Prefill safety text from the source offer (TEXT is account-agnostic).
	useEffect(() => {
		setSafetyText(sourceGpsr?.safetyInformation?.description ?? '');
	}, [sourceGpsr]);

	// Match source producer/person against the loaded target lists.
	useEffect(() => {
		if (loading) return;
		setProducerId(matchProducer(sourceGpsr?.responsibleProducer, producers)?.id ?? '');
		setPersonId(matchPerson(sourceGpsr?.responsiblePerson, persons)?.id ?? '');
	}, [loading, producers, persons, sourceGpsr]);

	// Cross-account + no match → open a create form prefilled from the source.
	useEffect(() => {
		if (loading || !crossAccount) return;
		const src = sourceGpsr?.responsibleProducer;
		if (src && 'producerData' in src && !matchProducer(src, producers)) {
			setProducerForm({
				name: src.name,
				publicName: src.producerData.tradeName,
				countryCode: src.producerData.address.countryCode || 'PL',
				street: src.producerData.address.street,
				postalCode: src.producerData.address.postalCode,
				city: src.producerData.address.city,
				email: src.producerData.contact.email ?? '',
				phoneNumber: src.producerData.contact.phoneNumber ?? '',
				formUrl: src.producerData.contact.formUrl ?? '',
			});
		}
		const srcP = sourceGpsr?.responsiblePerson;
		if (srcP && 'personalData' in srcP && !matchPerson(srcP, persons)) {
			setPersonForm({
				name: srcP.name,
				publicName: srcP.personalData.name,
				countryCode: srcP.personalData.address.countryCode || 'PL',
				street: srcP.personalData.address.street,
				postalCode: srcP.personalData.address.postalCode,
				city: srcP.personalData.address.city,
				email: srcP.personalData.contact.email ?? '',
				phoneNumber: srcP.personalData.contact.phoneNumber ?? '',
				formUrl: srcP.personalData.contact.formUrl ?? '',
			});
		}
	}, [loading, crossAccount, producers, persons, sourceGpsr]);

	// Emit the confirmed GPSR state upward whenever a selection changes.
	// NOTE: App.tsx must pass a useCallback-stable onChange or this loops.
	useEffect(() => {
		onChange({
			responsibleProducer: producerId ? { type: 'ID', id: producerId } : null,
			responsiblePerson: personId ? { id: personId } : null,
			safetyInformation: safetyText.trim()
				? { type: 'TEXT', description: safetyText.trim() }
				: null,
		});
	}, [producerId, personId, safetyText, onChange]);

	const submitProducer = async () => {
		if (!producerForm) return;
		setCreating(true);
		setCreateError(null);
		try {
			const created = await api.gpsr.createProducer({
				name: producerForm.name.trim(),
				producerData: {
					tradeName: producerForm.publicName.trim(),
					address: {
						countryCode: producerForm.countryCode,
						street: producerForm.street.trim(),
						postalCode: producerForm.postalCode.trim(),
						city: producerForm.city.trim(),
					},
					contact: {
						email: producerForm.email.trim() || undefined,
						phoneNumber: producerForm.phoneNumber.trim() || undefined,
						formUrl: producerForm.formUrl.trim() || undefined,
					},
				},
				accountId: publishAccountId || undefined,
			});
			setProducers(prev => [created, ...prev]);
			setProducerId(created.id);
			setProducerForm(null);
		} catch (e) {
			setCreateError(
				(e as { data?: { message?: string } }).data?.message ??
					(e as Error).message,
			);
		} finally {
			setCreating(false);
		}
	};

	const submitPerson = async () => {
		if (!personForm) return;
		setCreating(true);
		setCreateError(null);
		try {
			const created = await api.gpsr.createPerson({
				name: personForm.name.trim(),
				personalData: {
					name: personForm.publicName.trim(),
					address: {
						countryCode: personForm.countryCode,
						street: personForm.street.trim(),
						postalCode: personForm.postalCode.trim(),
						city: personForm.city.trim(),
					},
					contact: {
						email: personForm.email.trim() || undefined,
						phoneNumber: personForm.phoneNumber.trim() || undefined,
						formUrl: personForm.formUrl.trim() || undefined,
					},
				},
				accountId: publishAccountId || undefined,
			});
			setPersons(prev => [created, ...prev]);
			setPersonId(created.id);
			setPersonForm(null);
		} catch (e) {
			setCreateError(
				(e as { data?: { message?: string } }).data?.message ??
					(e as Error).message,
			);
		} finally {
			setCreating(false);
		}
	};

	const producerUnmatched = !!sourceGpsr?.responsibleProducer && !producerId;
	const personUnmatched = !!sourceGpsr?.responsiblePerson && !personId;

	return (
		<section className='panel'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
				<span className='label'>GPSR · производитель / ответственное лицо</span>
				{loading && <span className='text-[11px] text-ink-faint'>· · ·</span>}
			</header>
			<div className='p-4 space-y-4'>
				{listError && (
					<div className='text-[13px] text-bad border border-bad/30 bg-badTint rounded-md px-3 py-2'>
						{listError}
					</div>
				)}

				<GpsrField
					label='Dane producenta'
					unmatched={producerUnmatched}
					unmatchedHint='Производитель источника не найден в target-аккаунте — выбери или создай.'
					selectValue={producerId}
					onSelect={setProducerId}
					options={producers.map(p => ({
						id: p.id,
						label: `${p.name} — ${p.producerData.tradeName}`,
					}))}
					createOpen={!!producerForm}
					onToggleCreate={() =>
						setProducerForm(f => (f ? null : { ...EMPTY_FORM }))
					}
				/>
				{producerForm && (
					<GpsrCreateForm
						kind='producer'
						state={producerForm}
						onChange={setProducerForm}
						onSubmit={submitProducer}
						onCancel={() => setProducerForm(null)}
						busy={creating}
						error={createError}
					/>
				)}

				<GpsrField
					label='Osoba odpowiedzialna'
					unmatched={personUnmatched}
					unmatchedHint='Ответственное лицо источника не найдено в target-аккаунте — выбери или создай.'
					selectValue={personId}
					onSelect={setPersonId}
					options={persons.map(p => ({
						id: p.id,
						label: `${p.name} — ${p.personalData.name}`,
					}))}
					createOpen={!!personForm}
					onToggleCreate={() =>
						setPersonForm(f => (f ? null : { ...EMPTY_FORM }))
					}
				/>
				{personForm && (
					<GpsrCreateForm
						kind='person'
						state={personForm}
						onChange={setPersonForm}
						onSubmit={submitPerson}
						onCancel={() => setPersonForm(null)}
						busy={creating}
						error={createError}
					/>
				)}

				<label className='block'>
					<span className='label block mb-1.5'>
						Informacja o bezpieczeństwie (TEXT)
					</span>
					<textarea
						className='input min-h-[72px] resize-y'
						value={safetyText}
						maxLength={5000}
						onChange={e => setSafetyText(e.target.value)}
						placeholder='Текст безопасности продукта (переносится с источника)'
					/>
					<span className='text-[11px] text-ink-faint'>
						{safetyText.length}/5000
					</span>
				</label>
			</div>
		</section>
	);
}

function GpsrField({
	label,
	unmatched,
	unmatchedHint,
	selectValue,
	onSelect,
	options,
	createOpen,
	onToggleCreate,
}: {
	label: string;
	unmatched: boolean;
	unmatchedHint: string;
	selectValue: string;
	onSelect: (id: string) => void;
	options: Array<{ id: string; label: string }>;
	createOpen: boolean;
	onToggleCreate: () => void;
}) {
	return (
		<div className='space-y-1.5'>
			<div className='flex items-center justify-between'>
				<span className='label'>{label}</span>
				<button
					type='button'
					onClick={onToggleCreate}
					className='btn btn-ghost h-7 px-2 text-[11px]'>
					{createOpen ? 'отмена' : '+ создать'}
				</button>
			</div>
			<select
				className={`input ${unmatched ? 'border-warn' : ''}`}
				value={selectValue}
				onChange={e => onSelect(e.target.value)}>
				<option value=''>— не выбрано —</option>
				{options.map(o => (
					<option key={o.id} value={o.id}>
						{o.label}
					</option>
				))}
			</select>
			{unmatched && <p className='text-[11px] text-warn'>{unmatchedHint}</p>}
		</div>
	);
}

function GpsrCreateForm({
	kind,
	state,
	onChange,
	onSubmit,
	onCancel,
	busy,
	error,
}: {
	kind: 'producer' | 'person';
	state: CreateFormState;
	onChange: (s: CreateFormState) => void;
	onSubmit: () => void;
	onCancel: () => void;
	busy: boolean;
	error: string | null;
}) {
	const set = (patch: Partial<CreateFormState>) =>
		onChange({ ...state, ...patch });
	const canSubmit =
		!!state.name.trim() &&
		!!state.publicName.trim() &&
		!!state.street.trim() &&
		!!state.postalCode.trim() &&
		!!state.city.trim() &&
		!!(state.email.trim() || state.formUrl.trim());

	return (
		<div className='border border-border-muted rounded-md p-3 space-y-2 bg-soft/40'>
			<div className='text-[11px] text-ink-muted uppercase tracking-wide'>
				Новый {kind === 'producer' ? 'производитель' : 'ответственное лицо'}
			</div>
			<input
				className='input'
				placeholder='Внутреннее имя (≤50)'
				value={state.name}
				maxLength={50}
				onChange={e => set({ name: e.target.value })}
			/>
			<input
				className='input'
				placeholder={
					kind === 'producer'
						? 'Trade name / название компании (≤200)'
						: 'Имя лица/компании (≤200)'
				}
				value={state.publicName}
				maxLength={200}
				onChange={e => set({ publicName: e.target.value })}
			/>
			<div className='grid grid-cols-2 gap-2'>
				<select
					className='input'
					value={state.countryCode}
					onChange={e => set({ countryCode: e.target.value })}>
					{EU_COUNTRY_CODES.map(c => (
						<option key={c} value={c}>
							{c}
						</option>
					))}
				</select>
				<input
					className='input'
					placeholder='Город'
					value={state.city}
					maxLength={100}
					onChange={e => set({ city: e.target.value })}
				/>
			</div>
			<input
				className='input'
				placeholder='Улица, дом'
				value={state.street}
				maxLength={200}
				onChange={e => set({ street: e.target.value })}
			/>
			<input
				className='input'
				placeholder='Индекс'
				value={state.postalCode}
				maxLength={20}
				onChange={e => set({ postalCode: e.target.value })}
			/>
			<input
				className='input'
				placeholder='Email (или URL формы)'
				value={state.email}
				maxLength={50}
				onChange={e => set({ email: e.target.value })}
			/>
			<input
				className='input'
				placeholder='Телефон (опц.)'
				value={state.phoneNumber}
				maxLength={30}
				onChange={e => set({ phoneNumber: e.target.value })}
			/>
			<input
				className='input'
				placeholder='URL формы (если без email)'
				value={state.formUrl}
				maxLength={80}
				onChange={e => set({ formUrl: e.target.value })}
			/>
			{error && <p className='text-[12px] text-bad'>{error}</p>}
			<div className='flex gap-2'>
				<button
					type='button'
					className='btn btn-primary h-8 px-3 text-[12px]'
					disabled={!canSubmit || busy}
					onClick={onSubmit}>
					{busy ? 'создаю · · ·' : 'Создать в Allegro'}
				</button>
				<button
					type='button'
					className='btn btn-ghost h-8 px-3 text-[12px]'
					onClick={onCancel}
					disabled={busy}>
					Отмена
				</button>
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Типчек**

Run: `npm run build -w web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/GpsrPanel.tsx
git commit -m "feat: компонент GpsrPanel — выбор/создание GPSR, матчинг с источником"
```

---

## Task 10: Компонент `OfferRefsPanel`

**Files:**
- Create: `web/src/components/OfferRefsPanel.tsx`

Панель в колонке клона: 4 выпадашки (cennik dostawy / warunki zwrotów / reklamacje / gwarancja) из справочников target-аккаунта, матчинг по имени источника. Без inline-создания — это сложные сущности, рядом ссылка на настройки Allegro.

- [ ] **Step 1: Создать файл компонента**

Создать `web/src/components/OfferRefsPanel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { api, type ClonePayload, type OfferRefs } from '../api';

interface OfferRefsPanelProps {
	/** Account-scoped refs read off the source offer (preview.offerRefs). */
	sourceRefs: OfferRefs | null | undefined;
	/** Account the clone publishes to — lists are read here. */
	publishAccountId: string;
	/** true when source account ≠ publish account. */
	crossAccount: boolean;
	/** Emits the confirmed refs up to App for the clone payload. */
	onChange: (offerRefs: NonNullable<ClonePayload['offerRefs']>) => void;
}

type RefList = Array<{ id: string; name: string }>;

// Allegro seller settings — generic link shown when a ref isn't found in the
// target account (these dictionary entries can't be created from this tool).
const ALLEGRO_SETTINGS_URL = 'https://allegro.pl/moje-allegro/sprzedaz/ustawienia';

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** Match a source ref name against the target list; returns the id or ''. */
function matchByName(srcName: string | undefined, list: RefList): string {
	if (!srcName) return '';
	const hits = list.filter(r => norm(r.name) === norm(srcName));
	return hits.length === 1 ? hits[0].id : '';
}

export function OfferRefsPanel({
	sourceRefs,
	publishAccountId,
	crossAccount,
	onChange,
}: OfferRefsPanelProps) {
	const [shippingRates, setShippingRates] = useState<RefList>([]);
	const [returnPolicies, setReturnPolicies] = useState<RefList>([]);
	const [impliedWarranties, setImpliedWarranties] = useState<RefList>([]);
	const [warranties, setWarranties] = useState<RefList>([]);
	const [loading, setLoading] = useState(false);
	const [listError, setListError] = useState<string | null>(null);

	const [shippingRatesId, setShippingRatesId] = useState('');
	const [returnPolicyId, setReturnPolicyId] = useState('');
	const [impliedWarrantyId, setImpliedWarrantyId] = useState('');
	const [warrantyId, setWarrantyId] = useState('');

	// Load the target account's dictionaries whenever the publish account changes.
	useEffect(() => {
		if (!publishAccountId) return;
		setLoading(true);
		setListError(null);
		Promise.all([
			api.helpers.shippingRates(publishAccountId),
			api.helpers.returnPolicies(publishAccountId),
			api.helpers.impliedWarranties(publishAccountId),
			api.helpers.warranties(publishAccountId),
		])
			.then(([sr, rp, iw, wr]) => {
				setShippingRates(sr ?? []);
				setReturnPolicies(rp ?? []);
				setImpliedWarranties(iw ?? []);
				setWarranties(wr ?? []);
			})
			.catch(e => setListError((e as Error).message))
			.finally(() => setLoading(false));
	}, [publishAccountId]);

	// Match source ref names against the loaded target lists.
	useEffect(() => {
		if (loading) return;
		setShippingRatesId(matchByName(sourceRefs?.shippingRates?.name, shippingRates));
		setReturnPolicyId(matchByName(sourceRefs?.returnPolicy?.name, returnPolicies));
		setImpliedWarrantyId(
			matchByName(sourceRefs?.impliedWarranty?.name, impliedWarranties),
		);
		setWarrantyId(matchByName(sourceRefs?.warranty?.name, warranties));
	}, [loading, shippingRates, returnPolicies, impliedWarranties, warranties, sourceRefs]);

	// Emit the confirmed refs upward. NOTE: App.tsx must pass useCallback-stable onChange.
	useEffect(() => {
		onChange({
			shippingRates: shippingRatesId ? { id: shippingRatesId } : null,
			returnPolicy: returnPolicyId ? { id: returnPolicyId } : null,
			impliedWarranty: impliedWarrantyId ? { id: impliedWarrantyId } : null,
			warranty: warrantyId ? { id: warrantyId } : null,
		});
	}, [shippingRatesId, returnPolicyId, impliedWarrantyId, warrantyId, onChange]);

	return (
		<section className='panel'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
				<span className='label'>
					Справочники оферты · доставка / возвраты / гарантия
				</span>
				{loading && <span className='text-[11px] text-ink-faint'>· · ·</span>}
			</header>
			<div className='p-4 space-y-3'>
				{listError && (
					<div className='text-[13px] text-bad border border-bad/30 bg-badTint rounded-md px-3 py-2'>
						{listError}
					</div>
				)}
				<RefRow
					label='Cennik dostawy'
					sourceName={sourceRefs?.shippingRates?.name}
					value={shippingRatesId}
					onChange={setShippingRatesId}
					options={shippingRates}
				/>
				<RefRow
					label='Warunki zwrotów'
					sourceName={sourceRefs?.returnPolicy?.name}
					value={returnPolicyId}
					onChange={setReturnPolicyId}
					options={returnPolicies}
				/>
				<RefRow
					label='Reklamacje'
					sourceName={sourceRefs?.impliedWarranty?.name}
					value={impliedWarrantyId}
					onChange={setImpliedWarrantyId}
					options={impliedWarranties}
				/>
				<RefRow
					label='Gwarancja'
					sourceName={sourceRefs?.warranty?.name}
					value={warrantyId}
					onChange={setWarrantyId}
					options={warranties}
				/>
				{crossAccount && (
					<p className='text-[11px] text-ink-faint'>
						Кросс-аккаунт: ссылки матчатся по имени. Нет в списке —{' '}
						<a
							className='underline'
							href={ALLEGRO_SETTINGS_URL}
							target='_blank'
							rel='noreferrer'>
							создай в настройках Allegro ↗
						</a>
					</p>
				)}
			</div>
		</section>
	);
}

function RefRow({
	label,
	sourceName,
	value,
	onChange,
	options,
}: {
	label: string;
	sourceName: string | undefined;
	value: string;
	onChange: (id: string) => void;
	options: RefList;
}) {
	const unmatched = !!sourceName && !value;
	return (
		<div className='space-y-1'>
			<div className='flex items-center justify-between'>
				<span className='label'>{label}</span>
				{sourceName && (
					<span className='text-[11px] text-ink-faint'>
						источник: {sourceName}
					</span>
				)}
			</div>
			<select
				className={`input ${unmatched ? 'border-warn' : ''}`}
				value={value}
				onChange={e => onChange(e.target.value)}>
				<option value=''>— не выбрано —</option>
				{options.map(o => (
					<option key={o.id} value={o.id}>
						{o.name}
					</option>
				))}
			</select>
			{unmatched && (
				<p className='text-[11px] text-warn'>
					«{sourceName}» не найден в target-аккаунте — выбери из списка.
				</p>
			)}
		</div>
	);
}
```

- [ ] **Step 2: Типчек**

Run: `npm run build -w web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/OfferRefsPanel.tsx
git commit -m "feat: компонент OfferRefsPanel — выбор справочников доставки/возвратов/гарантий"
```

---

## Task 11: Подключение `GpsrPanel` и `OfferRefsPanel` в `App.tsx`

**Files:**
- Modify: `web/src/App.tsx` (импорты, state после `:98`, `buildPayload:300-313`, рендер после `ExtrasPanel:474-492`)

- [ ] **Step 1: Импорты**

В `web/src/App.tsx` добавить после строки 19 (`import { NewProductPanel } ...`):

```typescript
import { GpsrPanel } from './components/GpsrPanel';
import { OfferRefsPanel } from './components/OfferRefsPanel';
```

И в именованный импорт из `./api` (строки 2-10) добавить `type ClonePayload,`.

- [ ] **Step 2: Стейт и стабильные обработчики**

В `web/src/App.tsx` после строки `const [targetProduct, setTargetProduct] = useState<SelectedTargetProduct | null>(null);` (после строки 98) добавить:

```typescript
	const [gpsr, setGpsr] = useState<ClonePayload['gpsr']>(undefined);
	const [offerRefs, setOfferRefs] = useState<ClonePayload['offerRefs']>(undefined);
	const handleGpsrChange = useCallback(
		(g: NonNullable<ClonePayload['gpsr']>) => setGpsr(g),
		[],
	);
	const handleOfferRefsChange = useCallback(
		(r: NonNullable<ClonePayload['offerRefs']>) => setOfferRefs(r),
		[],
	);
```

- [ ] **Step 3: Прокинуть `gpsr` и `offerRefs` в `buildPayload`**

В `web/src/App.tsx` в `buildPayload` (строки 300-313) добавить перед `accountId:`:

```typescript
		targetProductId: targetProduct?.id,
		gpsr,
		offerRefs,
		accountId: publishAccountId || undefined,
```

- [ ] **Step 4: Отрендерить панели в колонке клона**

В `web/src/App.tsx` после `<ExtrasPanel ... />` и до блока `<div className='sticky bottom-4 space-y-2'>` (после строки 492) добавить:

```tsx
						{preview && (
							<GpsrPanel
								sourceGpsr={preview.gpsr}
								publishAccountId={publishAccountId}
								crossAccount={sourceAccountId !== publishAccountId}
								onChange={handleGpsrChange}
							/>
						)}

						{preview && (
							<OfferRefsPanel
								sourceRefs={preview.offerRefs}
								publishAccountId={publishAccountId}
								crossAccount={sourceAccountId !== publishAccountId}
								onChange={handleOfferRefsChange}
							/>
						)}
```

- [ ] **Step 5: Типчек**

Run: `npm run build -w web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat: GpsrPanel + OfferRefsPanel в колонке клона, gpsr/offerRefs в payload"
```

---

## Task 12: Группа «Сертификаты и безопасность» в `NewProductPanel`

**Files:**
- Modify: `web/src/components/NewProductPanel.tsx` (константа после `:22`, `required`/`optional:282-283`, рендер `:483-514`)

Параметры карточки с именами по регэкспу сертификатов/безопасности/батареи выносятся в отдельную всегда-видимую секцию. Логика отправки не меняется — те же `parameters[]`.

- [ ] **Step 1: Добавить регэксп-константу**

В `web/src/components/NewProductPanel.tsx` после строки 22 (`const DEFAULT_CATEGORY_ID = '491';`) добавить:

```typescript
// Имена категорийных параметров Allegro про сертификаты/безопасность/батарею —
// выносим в отдельную видимую секцию, а не прячем в «Необязательные».
const CERT_PARAM_RE = /certyfikat|zgodno|bateri|bezpiecze/i;
```

- [ ] **Step 2: Добавить третий бакет параметров**

В `web/src/components/NewProductPanel.tsx` заменить вычисления `required`/`optional` (строки 282-283):

```typescript
	const required = useMemo(() => params.filter(p => p.required), [params]);
	const certificates = useMemo(
		() => params.filter(p => !p.required && CERT_PARAM_RE.test(p.name)),
		[params],
	);
	const optional = useMemo(
		() => params.filter(p => !p.required && !CERT_PARAM_RE.test(p.name)),
		[params],
	);
```

- [ ] **Step 3: Отрендерить секцию сертификатов**

В `web/src/components/NewProductPanel.tsx` в секции `02 · Параметры`, между блоком `{required.length > 0 && (...)}` и блоком `{optional.length > 0 && (...)}` (после закрывающего `)}` блока `required` на строке 497), добавить:

```tsx
						{certificates.length > 0 && (
							<div className='space-y-2 border-t border-border-muted pt-3'>
								<div className='text-[11px] text-flame uppercase tracking-wide font-semibold'>
									Сертификаты и безопасность
								</div>
								{certificates.map(p => (
									<ParamRow
										key={p.id}
										param={p}
										value={values[p.id]}
										onChange={raw => setParamValue(p, raw)}
									/>
								))}
							</div>
						)}
```

- [ ] **Step 4: Типчек**

Run: `npm run build -w web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/NewProductPanel.tsx
git commit -m "feat: видимая группа «Сертификаты и безопасность» в NewProductPanel"
```

---

## Финальная проверка (после всех задач)

- [ ] **Полный билд + тесты**

Run: `npm run build && npm test`
Expected: оба зелёные.

- [ ] **Ручная проверка в sandbox** (требует подключённого sandbox-аккаунта)

1. Клон оферты с GPSR в том же аккаунте → в `GpsrPanel` производитель/лицо предвыбраны, текст безопасности подтянут; клон проходит.
2. Клон в другой аккаунт, где производитель есть → матч по имени+индексу, предвыбран.
3. Клон в другой аккаунт, где производителя нет → поле подсвечено, inline-форма раскрыта и предзаполнена; «Создать в Allegro» создаёт запись, она выбирается.
4. `OfferRefsPanel`: клон с cennik dostawy / warunki zwrotów → same-account предвыбрано; cross-account с совпадением имени → предвыбрано; без совпадения → подсветка.
5. «Создать товар», категория с параметрами сертификатов → секция «Сертификаты и безопасность» видна.
6. Клон с `b2b`/`taxSettings`/`additionalMarketplaces` → поля доходят до Allegro (видно в логе/превью-теле).

---

## Карта файлов

| Файл | Что делает | Задачи |
|---|---|---|
| `server/src/core/types.ts` | типы GPSR + `NamedRef`, `AllegroProductSetItem` | 2 |
| `server/src/core/allegro.ts` | методы справочников GPSR + ссылок оферты | 3, 4 |
| `server/src/core/clone.ts` | whitelist, `CloneOptions.gpsr/.offerRefs`, `resolveGpsr`, `resolveOfferRefs`, явный `productSet[0]` | 1, 5, 6 |
| `server/src/core/clone.test.ts` | тесты whitelist + GPSR + offerRefs | 1, 5, 6 |
| `server/src/routes/api.ts` | роуты `/api/gpsr/*` и `/api/helpers/warranties`, `gpsr`+`offerRefs` в схеме и превью | 7 |
| `web/src/api.ts` | типы + методы `api.gpsr.*` и `api.helpers.*` | 8 |
| `web/src/components/GpsrPanel.tsx` | **новый** — UI выбора/создания GPSR | 9 |
| `web/src/components/OfferRefsPanel.tsx` | **новый** — UI выбора справочников оферты | 10 |
| `web/src/App.tsx` | монтаж панелей, `gpsr`+`offerRefs` в clone-payload | 11 |
| `web/src/components/NewProductPanel.tsx` | группа «Сертификаты и безопасность» | 12 |
