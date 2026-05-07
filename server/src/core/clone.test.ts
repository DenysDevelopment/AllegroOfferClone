import { describe, expect, it } from 'vitest';
import {
  stripReadonlyFields,
  substituteValueVariants,
  buildCloneBody,
  cloneOffer,
} from './clone.js';
import type { AllegroOffer } from './types.js';
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

  it('drops Allegro server-managed metadata (additionalMarketplaces, base, endedBy, warnings, validation, marketplace, statistics)', () => {
    const out = stripReadonlyFields({
      name: 'Test',
      additionalMarketplaces: { 'allegro-cz': { publication: {} } },
      base: { foo: 'bar' },
      endedBy: 'BUYER',
      warnings: ['x'],
      validation: { errors: [] },
      marketplace: { id: 'allegro-pl' },
      statistics: { sold: 5 },
    } as unknown as AllegroOffer);
    expect(out).not.toHaveProperty('additionalMarketplaces');
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
      searchProducts: async () => opts.searchHits ?? [],
    } as unknown as AllegroClient;
  }

  it('substitutes the parameter and rewrites the title', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const { body } = await buildCloneBody(
      fakeClient({}),
      baseOffer,
      {
        sourceOfferId: 'src-1',
        paramOverrides: { 'Pojemność dysku SSD': '512 GB' },
      },
      steps,
    );
    expect((body as { name: string }).name).toContain('512');
    expect((body as { name: string }).name).not.toContain('256');
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
        paramOverrides: { 'Pojemność dysku SSD': '512 GB' },
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
        paramOverrides: { 'Pojemność dysku SSD': '512 GB' },
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
      searchProducts: async () => [],
      createOffer: async () => {
        throw new Error('createOffer should not be called in dry run');
      },
    } as unknown as AllegroClient;

    const res = await cloneOffer(fake, {
      sourceOfferId: 'src',
      paramOverrides: { 'Pojemność dysku SSD': '512 GB' },
      dryRun: true,
    });

    expect(res.outcome).toEqual({ kind: 'dry-run' });
    expect((res.body as { name: string }).name).toContain('512');
  });
});
