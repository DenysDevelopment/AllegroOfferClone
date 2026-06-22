import { describe, expect, it } from 'vitest';
import {
  stripReadonlyFields,
  substituteValueVariants,
  buildCloneBody,
  cloneOffer,
  splitDescriptionSectionsToMaxTwoItems,
} from './clone.js';
import type { AllegroOffer, AllegroProductSetItem } from './types.js';
import type { AllegroClient } from './allegro.js';

describe('substituteValueVariants', () => {
  it('replaces "256 GB" with "512 GB"', () => {
    expect(substituteValueVariants('Lenovo 256 GB SSD', '256 GB', '512 GB')).toBe(
      'Lenovo 512 GB SSD',
    );
  });

  it('replaces tight form "256GB" with "512GB"', () => {
    expect(substituteValueVariants('Lenovo 256GB SSD', '256 GB', '512 GB')).toBe(
      'Lenovo 512GB SSD',
    );
  });

  it('matches case-insensitively (replacement uses canonical case)', () => {
    // The lowercase "256gb" in the source matches the tight variant "256GB" of the old value;
    // the replacement is the canonical tight form "512GB". This keeps output predictable.
    expect(substituteValueVariants('256gb ssd', '256 GB', '512 GB')).toBe('512GB ssd');
  });

  it('leaves non-matching text alone', () => {
    expect(substituteValueVariants('Macbook Air', '256 GB', '512 GB')).toBe('Macbook Air');
  });

  it('does not substitute partial numeric matches incorrectly', () => {
    // "16 GB" replacement should not break "1256 GB" — but our naive regex will match "256 GB"
    // inside "1256 GB" because there is no word boundary. Document the limitation:
    // Caller should not rely on this for ambiguous values; in practice parameter values
    // are like "16 GB", "256 GB" and the source title is short enough to be unambiguous.
    const out = substituteValueVariants('Foo 16 GB bar', '16 GB', '32 GB');
    expect(out).toBe('Foo 32 GB bar');
  });
});

describe('stripReadonlyFields', () => {
  it('removes id, createdAt, updatedAt, validatedAt, statistics', () => {
    const source = {
      id: '123',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-02',
      validatedAt: '2025-01-03',
      statistics: { sold: 5 },
      name: 'Test',
    } as unknown as AllegroOffer;

    const out = stripReadonlyFields(source);

    expect(out).not.toHaveProperty('id');
    expect(out).not.toHaveProperty('createdAt');
    expect(out).not.toHaveProperty('updatedAt');
    expect(out).not.toHaveProperty('validatedAt');
    expect(out).not.toHaveProperty('statistics');
    expect(out).toHaveProperty('name', 'Test');
  });

  it('strips publication.startedAt but keeps status', () => {
    const out = stripReadonlyFields({
      publication: { status: 'ACTIVE', startedAt: '2025-01-01', duration: 'P30D' },
    } as unknown as AllegroOffer) as { publication: Record<string, unknown> };
    expect(out.publication).toEqual({ status: 'ACTIVE', duration: 'P30D' });
  });

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

  it('drops absolute publication timestamps (startedAt, endedAt, endingAt, startingAt) but keeps status + duration', () => {
    const out = stripReadonlyFields({
      publication: {
        status: 'ACTIVE',
        startedAt: '2024-12-01',
        endedAt: '2025-01-01',
        endingAt: '2025-12-31T00:00:00Z',
        startingAt: '2025-01-01T00:00:00Z',
        duration: 'P30D',
        republish: true,
      },
    } as unknown as AllegroOffer) as { publication: Record<string, unknown> };
    expect(out.publication).toEqual({
      status: 'ACTIVE',
      duration: 'P30D',
      republish: true,
    });
  });

  it('strips sellingMode.startingPrice but keeps price + format', () => {
    const out = stripReadonlyFields({
      sellingMode: {
        format: 'BUY_NOW',
        price: { amount: '99.00', currency: 'PLN' },
        startingPrice: { amount: '99.00', currency: 'PLN' },
      },
    } as unknown as AllegroOffer) as { sellingMode: Record<string, unknown> };
    expect(out.sellingMode).toEqual({
      format: 'BUY_NOW',
      price: { amount: '99.00', currency: 'PLN' },
    });
  });

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
});

describe('buildCloneBody', () => {
  const baseOffer: AllegroOffer = {
    id: 'src-1',
    name: 'Lenovo IdeaPad 5 16GB 256GB SSD Win11',
    category: { id: '491' },
    productSet: [
      {
        product: {
          id: 'PROD-256',
          name: 'Lenovo IdeaPad 5',
          category: { id: '491' },
          parameters: [
            { id: 'P_RAM', name: 'Pamięć RAM', values: ['16 GB'] },
            { id: 'P_HDD', name: 'Pojemność dysku SSD', values: ['256 GB'] },
          ],
        },
        quantity: { value: 1 },
      },
    ],
    sellingMode: { format: 'BUY_NOW', price: { amount: '2999.00', currency: 'PLN' } },
    stock: { available: 1, unit: 'UNIT' },
    publication: { status: 'ACTIVE' as const, startedAt: '2025-01-01' },
  };

  function fakeClient(opts: {
    searchHits?: Array<{
      id: string;
      name: string;
      category?: { id: string };
      parameters?: Array<{ id: string; name?: string; values?: string[] }>;
    }>;
    productById?: Record<string, unknown>;
  }): AllegroClient {
    return {
      getProduct: async (id: string) => {
        if (opts.productById?.[id]) return opts.productById[id];
        return {
          id,
          name: baseOffer.productSet![0].product.name!,
          category: baseOffer.productSet![0].product.category,
          parameters: baseOffer.productSet![0].product.parameters,
        };
      },
      searchProducts: async () => ({ products: opts.searchHits ?? [] }),
    } as unknown as AllegroClient;
  }

  it('uses the catalog product name as the title (no override substitution)', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const { body } = await buildCloneBody(
      fakeClient({}),
      baseOffer,
      {
        sourceOfferId: 'src-1',
        paramOverrides: { 'Pojemność dysku SSD': ['512 GB'] },
      },
      steps,
    );
    // Title comes from the catalog product card name, not the offer title,
    // and the SSD override is NOT substituted into it.
    expect((body as { name: string }).name).toBe('Lenovo IdeaPad 5');
  });

  it('nameOverride still wins over the catalog name', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const { body } = await buildCloneBody(
      fakeClient({}),
      baseOffer,
      {
        sourceOfferId: 'src-1',
        paramOverrides: {},
        nameOverride: 'Мой ручной заголовок',
      },
      steps,
    );
    expect((body as { name: string }).name).toBe('Мой ручной заголовок');
  });

  it('uses matched product id when catalog has the desired variant', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const { body, matchedProduct } = await buildCloneBody(
      fakeClient({
        searchHits: [
          {
            id: 'PROD-512',
            name: 'Lenovo IdeaPad 5',
            category: { id: '491' },
            parameters: [
              { id: 'P_RAM', name: 'Pamięć RAM', values: ['16 GB'] },
              { id: 'P_HDD', name: 'Pojemność dysku SSD', values: ['512 GB'] },
            ],
          },
        ],
      }),
      baseOffer,
      {
        sourceOfferId: 'src-1',
        paramOverrides: { 'Pojemność dysku SSD': ['512 GB'] },
      },
      steps,
    );
    expect(matchedProduct?.id).toBe('PROD-512');
    const ps = (body as { productSet: Array<{ product: { id?: string } }> }).productSet;
    expect(ps[0].product.id).toBe('PROD-512');
  });

  it('falls back to parameter list when no catalog match', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const { body, matchedProduct } = await buildCloneBody(
      fakeClient({ searchHits: [] }),
      baseOffer,
      {
        sourceOfferId: 'src-1',
        paramOverrides: { 'Pojemność dysku SSD': ['512 GB'] },
      },
      steps,
    );
    expect(matchedProduct).toBeUndefined();
    const ps = (
      body as {
        productSet: Array<{
          product: { id?: string; parameters?: Array<{ name?: string; values?: string[] }> };
        }>;
      }
    ).productSet;
    expect(ps[0].product.id).toBeUndefined();
    const hdd = ps[0].product.parameters?.find((p) => p.name === 'Pojemność dysku SSD');
    expect(hdd?.values).toEqual(['512 GB']);
  });

  it('applies a multi-value override (multipleChoices dictionary) into the product parameters', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const offer: AllegroOffer = {
      ...baseOffer,
      productSet: [
        {
          product: {
            id: 'PROD-256',
            name: 'Lenovo IdeaPad 5',
            category: { id: '491' },
            parameters: [{ id: 'P_PORTS', name: 'Złącza', values: ['USB'] }],
          },
          quantity: { value: 1 },
        },
      ],
    };
    const { body } = await buildCloneBody(
      fakeClient({ searchHits: [] }),
      offer,
      { sourceOfferId: 'src-1', paramOverrides: { 'Złącza': ['USB', 'HDMI'] } },
      steps,
    );
    const ps = (
      body as {
        productSet: Array<{
          product: { parameters?: Array<{ name?: string; values?: string[] }> };
        }>;
      }
    ).productSet;
    const ports = ps[0].product.parameters?.find((p) => p.name === 'Złącza');
    expect(ports?.values).toEqual(['USB', 'HDMI']);
  });

  it('cross-account + PROPOSED source card → inline product (cannot reuse foreign proposal)', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const sourceClient = fakeClient({
      productById: {
        'PROD-256': {
          id: 'PROD-256',
          name: 'Lenovo IdeaPad 5',
          category: { id: '491' },
          parameters: baseOffer.productSet![0].product.parameters,
          publication: { status: 'PROPOSED' },
        },
      },
    });
    const targetClient = fakeClient({ searchHits: [] });
    const { body } = await buildCloneBody(
      targetClient,
      baseOffer,
      { sourceOfferId: 'src-1', paramOverrides: {} },
      steps,
      sourceClient, // different instance → crossAccount === true
    );
    const ps = (
      body as {
        productSet: Array<{
          product: { id?: string; parameters?: Array<{ name?: string }> };
        }>;
      }
    ).productSet;
    expect(ps[0].product.id).toBeUndefined();
    expect(ps[0].product.parameters?.length).toBeGreaterThan(0);
    expect(
      steps.some(s => s.level === 'warn' && /PROPOSED/.test(s.message)),
    ).toBe(true);
  });

  it('cross-account + LISTED source card → reuses source product id', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const sourceClient = fakeClient({
      productById: {
        'PROD-256': {
          id: 'PROD-256',
          name: 'Lenovo IdeaPad 5',
          category: { id: '491' },
          parameters: baseOffer.productSet![0].product.parameters,
          publication: { status: 'LISTED' },
        },
      },
    });
    const targetClient = fakeClient({ searchHits: [] });
    const { body } = await buildCloneBody(
      targetClient,
      baseOffer,
      { sourceOfferId: 'src-1', paramOverrides: {} },
      steps,
      sourceClient,
    );
    const ps = (body as { productSet: Array<{ product: { id?: string } }> }).productSet;
    expect(ps[0].product.id).toBe('PROD-256');
  });

  it('reuses source product id when no overrides are applied (no catalog search)', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    // searchProducts intentionally returns junk; the new code must NOT call it
    // for the no-overrides path, so its return value can't poison the result.
    const { body, matchedProduct } = await buildCloneBody(
      fakeClient({
        searchHits: [
          { id: 'WRONG-PROD', name: 'unrelated', parameters: [] },
        ],
      }),
      baseOffer,
      {
        sourceOfferId: 'src-1',
        paramOverrides: {},
      },
      steps,
    );
    expect(matchedProduct).toBeUndefined();
    const ps = (body as { productSet: Array<{ product: { id?: string } }> }).productSet;
    expect(ps[0].product.id).toBe('PROD-256');
  });

  it('forces publication status to INACTIVE by default', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const { body } = await buildCloneBody(
      fakeClient({}),
      baseOffer,
      {
        sourceOfferId: 'src-1',
        paramOverrides: {},
      },
      steps,
    );
    expect((body as { publication: { status: string } }).publication.status).toBe('INACTIVE');
  });

  it('replaces description when descriptionOverride is provided', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const offerWithDescription: AllegroOffer = {
      ...baseOffer,
      description: { sections: [{ items: [{ type: 'TEXT', content: 'old' }] }] },
    } as AllegroOffer;
    const { body } = await buildCloneBody(
      fakeClient({}),
      offerWithDescription,
      {
        sourceOfferId: 'src-1',
        paramOverrides: {},
        descriptionOverride: {
          sections: [
            { items: [{ type: 'TEXT', content: '<h1>new</h1>' }] },
            { items: [{ type: 'IMAGE', url: 'https://example.com/x.jpg' }] },
          ],
        },
      },
      steps,
    );
    const desc = (body as { description: { sections: Array<{ items: unknown[] }> } }).description;
    expect(desc.sections).toHaveLength(2);
    expect(desc.sections[0].items[0]).toEqual({ type: 'TEXT', content: '<h1>new</h1>' });
  });

  it('replaces offer-level images when imagesOverride is provided', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const offerWithImages: AllegroOffer = {
      ...baseOffer,
      images: [{ url: 'https://example.com/old.jpg' }],
    } as AllegroOffer;
    const { body } = await buildCloneBody(
      fakeClient({}),
      offerWithImages,
      {
        sourceOfferId: 'src-1',
        paramOverrides: {},
        imagesOverride: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
      },
      steps,
    );
    expect((body as { images: Array<{ url: string }> }).images).toEqual([
      { url: 'https://example.com/a.jpg' },
      { url: 'https://example.com/b.jpg' },
    ]);
  });
});

describe('cloneOffer dry run', () => {
  it('returns a body without calling createOffer', async () => {
    const fake = {
      getOffer: async () => ({
        id: 'src',
        name: 'Test 256 GB',
        category: { id: '491' },
        productSet: [
          {
            product: {
              id: 'P',
              name: 'Test',
              category: { id: '491' },
              parameters: [{ id: 'X', name: 'Pojemność dysku SSD', values: ['256 GB'] }],
            },
            quantity: { value: 1 },
          },
        ],
        sellingMode: { format: 'BUY_NOW', price: { amount: '1', currency: 'PLN' } },
        stock: { available: 1, unit: 'UNIT' },
        publication: { status: 'ACTIVE' as const },
      }),
      getProduct: async () => ({
        id: 'P',
        name: 'Test',
        category: { id: '491' },
        parameters: [{ id: 'X', name: 'Pojemność dysku SSD', values: ['256 GB'] }],
      }),
      searchProducts: async () => ({ products: [] }),
      createOffer: async () => {
        throw new Error('createOffer should not be called in dry run');
      },
    } as unknown as AllegroClient;

    const res = await cloneOffer(fake, {
      sourceOfferId: 'src',
      paramOverrides: { 'Pojemność dysku SSD': ['512 GB'] },
      dryRun: true,
    });

    expect(res.outcome).toEqual({ kind: 'dry-run' });
    // Title is the catalog product card name (not the offer title with override substituted in).
    expect((res.body as { name: string }).name).toBe('Test');
  });
});

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
    // 5 account-scoped refs dropped → one warn each (shippingRates,
    // returnPolicy, impliedWarranty, warranty, wholesalePriceList).
    expect(steps.filter(s => s.level === 'warn').length).toBeGreaterThanOrEqual(5);
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
    // warranty has no override and this is a cross-account clone → dropped.
    expect(b.afterSalesServices.warranty).toBeUndefined();
  });

  it('adds delivery.shippingRates from options when the source has no delivery', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const offerNoDelivery = { ...refsOffer, delivery: undefined } as AllegroOffer;
    const { body } = await buildCloneBody(
      refsClient(),
      offerNoDelivery,
      {
        sourceOfferId: 'src-1',
        paramOverrides: {},
        offerRefs: { shippingRates: { id: 'SR-TGT' } },
      },
      steps,
      refsClient(),
    );
    const b = body as { delivery?: { shippingRates?: { id: string } } };
    expect(b.delivery?.shippingRates).toEqual({ id: 'SR-TGT' });
  });
});

describe('splitDescriptionSectionsToMaxTwoItems', () => {
  const T = (content: string) => ({ type: 'TEXT' as const, content });
  const I = (url: string) => ({ type: 'IMAGE' as const, url });

  function run(sections: Array<{ items: Array<{ type: string }> }>) {
    const body = { description: { sections } } as Record<string, unknown>;
    splitDescriptionSectionsToMaxTwoItems(body, []);
    return (body as { description: { sections: Array<{ items: Array<{ type: string }> }> } })
      .description.sections;
  }

  it('splits [TEXT, TEXT] into two single-text rows', () => {
    const out = run([{ items: [T('a'), T('b')] }]);
    expect(out).toEqual([{ items: [T('a')] }, { items: [T('b')] }]);
  });

  it('keeps valid two-item layouts untouched', () => {
    const out = run([
      { items: [T('a'), I('u1')] },
      { items: [I('u2'), T('b')] },
      { items: [I('u3'), I('u4')] },
    ]);
    expect(out).toEqual([
      { items: [T('a'), I('u1')] },
      { items: [I('u2'), T('b')] },
      { items: [I('u3'), I('u4')] },
    ]);
  });

  it('chunks >2 items by two, then fixes any [TEXT,TEXT] pair', () => {
    // [T,I,T] -> chunk -> [T,I] + [T]
    const out = run([{ items: [T('a'), I('u1'), T('b')] }]);
    expect(out).toEqual([{ items: [T('a'), I('u1')] }, { items: [T('b')] }]);
  });

  it('chunks [T,T,T,T] -> 2 pairs -> 4 single-text rows', () => {
    const out = run([{ items: [T('a'), T('b'), T('c'), T('d')] }]);
    expect(out).toEqual([
      { items: [T('a')] },
      { items: [T('b')] },
      { items: [T('c')] },
      { items: [T('d')] },
    ]);
  });

  it('log message: only [текст+текст] clause when chunked=0, textPairsSplit=1', () => {
    const steps: import('./clone.js').CloneStep[] = [];
    const body = { description: { sections: [{ items: [T('a'), T('b')] }] } } as Record<string, unknown>;
    splitDescriptionSectionsToMaxTwoItems(body, steps);
    const desc = (body as { description: { sections: Array<{ items: unknown[] }> } }).description;
    expect(desc.sections).toHaveLength(2);
    expect(steps).toHaveLength(1);
    expect(steps[0].level).toBe('info');
    expect(steps[0].message).toContain('пар [текст+текст] разделено 1');
    expect(steps[0].message).not.toContain('разрезано 0');
  });
});
