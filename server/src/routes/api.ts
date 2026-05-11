import { Router, type Request } from 'express';
import express from 'express';
import { z } from 'zod';
import type { AllegroClient } from '../core/allegro.js';
import { cloneOffer, buildCloneBody } from '../core/clone.js';

const descriptionItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TEXT'), content: z.string() }),
  z.object({ type: z.literal('IMAGE'), url: z.string().url() }),
]);

const descriptionSchema = z.object({
  sections: z
    .array(z.object({ items: z.array(descriptionItemSchema).min(1) }))
    .min(1),
});

const productParameterSchema = z
  .object({
    id: z.string().min(1),
    values: z.array(z.string()).optional(),
    valuesIds: z.array(z.string()).optional(),
  })
  .refine(
    (p) => (p.values && p.values.length > 0) || (p.valuesIds && p.valuesIds.length > 0),
    { message: 'parameter must have at least one of: values, valuesIds' },
  );

const proposeProductSchema = z.object({
  name: z.string().min(1).max(75),
  category: z.object({ id: z.string().min(1) }),
  language: z.string().default('pl-PL'),
  images: z.array(z.string().url()).min(1).max(16),
  parameters: z.array(productParameterSchema).min(1),
  description: descriptionSchema.optional(),
});

const cloneSchema = z.object({
  sourceOfferId: z.string().min(1),
  paramOverrides: z.record(z.string(), z.string()).default({}),
  nameOverride: z.string().optional(),
  priceOverride: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  stockOverride: z.number().int().min(0).optional(),
  publicationStatus: z.enum(['ACTIVE', 'INACTIVE']).default('INACTIVE'),
  descriptionOverride: descriptionSchema.optional(),
  imagesOverride: z.array(z.string().url()).optional(),
  targetProductId: z.string().min(1).optional(),
  useOwnOfferData: z.boolean().optional(),
  dryRun: z.boolean().default(false),
});

export function apiRouter(client: AllegroClient): Router {
  const r = Router();

  r.get('/me', async (_req, res, next) => {
    try {
      res.json(await client.me());
    } catch (e) {
      next(e);
    }
  });

  r.get('/offers/:id', async (req, res, next) => {
    try {
      const offer = await client.getOffer(req.params.id);
      res.json(offer);
    } catch (e) {
      next(e);
    }
  });

  r.get('/offers/:id/preview', async (req, res, next) => {
    try {
      const offer = await client.getOffer(req.params.id);
      const sourceProductId = offer.productSet?.[0]?.product?.id;
      const product = sourceProductId ? await client.getProduct(sourceProductId) : null;
      const categoryId = offer.category?.id ?? offer.productSet?.[0]?.product?.category?.id;
      const categoryParameters = categoryId
        ? await client.getCategoryParameters(categoryId)
        : null;
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
      });
    } catch (e) {
      next(e);
    }
  });

  r.post('/clone', async (req, res, next) => {
    const parsed = cloneSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'VALIDATION', details: parsed.error.format() });
    }
    try {
      const result = await cloneOffer(client, parsed.data);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  r.post('/clone/preview', async (req, res, next) => {
    const parsed = cloneSchema.safeParse({ ...req.body, dryRun: true });
    if (!parsed.success) {
      return res.status(400).json({ error: 'VALIDATION', details: parsed.error.format() });
    }
    try {
      const offer = await client.getOffer(parsed.data.sourceOfferId);
      const steps: Parameters<typeof buildCloneBody>[3] = [];
      const { body, matchedProduct } = await buildCloneBody(client, offer, parsed.data, steps);
      res.json({ steps, body, matchedProduct });
    } catch (e) {
      next(e);
    }
  });

  r.get('/commands/:id', async (req, res, next) => {
    try {
      res.json(await client.getCommandStatus(req.params.id));
    } catch (e) {
      next(e);
    }
  });

  r.get('/helpers/shipping-rates', async (_req, res, next) => {
    try {
      res.json(await client.listShippingRates());
    } catch (e) {
      next(e);
    }
  });

  r.get('/helpers/return-policies', async (_req, res, next) => {
    try {
      res.json(await client.listReturnPolicies());
    } catch (e) {
      next(e);
    }
  });

  r.get('/helpers/implied-warranties', async (_req, res, next) => {
    try {
      res.json(await client.listImpliedWarranties());
    } catch (e) {
      next(e);
    }
  });

  // --- catalog: matching categories ---

  r.get('/categories/match', async (req, res, next) => {
    const phrase = String(req.query.name ?? req.query.phrase ?? '').trim();
    if (!phrase) {
      return res.status(400).json({ error: 'VALIDATION', message: 'name is required' });
    }
    try {
      res.json({ matchingCategories: await client.matchCategories(phrase) });
    } catch (e) {
      next(e);
    }
  });

  r.get('/categories/:id/parameters', async (req, res, next) => {
    try {
      res.json(await client.getCategoryParameters(req.params.id));
    } catch (e) {
      next(e);
    }
  });

  // --- products: search & lookup existing catalog ---

  r.get('/products/search', async (req, res, next) => {
    const phrase = String(req.query.phrase ?? req.query.name ?? '').trim();
    if (!phrase) {
      return res
        .status(400)
        .json({ error: 'VALIDATION', message: 'phrase is required' });
    }
    const categoryId = req.query.categoryId
      ? String(req.query.categoryId)
      : undefined;
    const limit = req.query.limit
      ? Math.min(50, Math.max(1, Number(req.query.limit)))
      : 20;
    try {
      const products = await client.searchProducts({ phrase, categoryId, limit });
      res.json({ products });
    } catch (e) {
      next(e);
    }
  });

  r.get('/products/:id', async (req, res, next) => {
    try {
      res.json(await client.getProduct(req.params.id));
    } catch (e) {
      next(e);
    }
  });

  // --- products: propose a new product card ---

  r.post('/products', async (req, res, next) => {
    const parsed = proposeProductSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'VALIDATION', details: parsed.error.format() });
    }
    const { images, ...rest } = parsed.data;
    const body = { ...rest, images: images.map((url) => ({ url })) };
    try {
      const result = await client.proposeProduct(body);
      if (result.status === 409) {
        return res.status(409).json({
          error: 'PRODUCT_EXISTS',
          message: 'Такой товар уже есть в каталоге Allegro',
          existingLocation: result.existingLocation,
        });
      }
      res.status(201).json(result.product);
    } catch (e) {
      next(e);
    }
  });

  r.post('/products/preview', async (req, res) => {
    const parsed = proposeProductSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'VALIDATION', details: parsed.error.format() });
    }
    const { images, ...rest } = parsed.data;
    res.json({ body: { ...rest, images: images.map((url) => ({ url })) } });
  });

  // --- images upload (rehosts to Allegro CDN) ---

  r.post('/images/upload-url', async (req, res, next) => {
    const url = z.string().url().safeParse(req.body?.url);
    if (!url.success) {
      return res.status(400).json({ error: 'VALIDATION', message: 'valid url required' });
    }
    try {
      res.json(await client.uploadImageByUrl(url.data));
    } catch (e) {
      next(e);
    }
  });

  const allowedImageMime = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const rawImage = express.raw({ type: () => true, limit: '12mb' });

  r.post('/images/upload', rawImage, async (req: Request, res, next) => {
    const ct = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!allowedImageMime.has(ct)) {
      return res.status(415).json({
        error: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Content-Type must be image/jpeg, image/png, or image/webp',
      });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'VALIDATION', message: 'empty body' });
    }
    try {
      res.json(
        await client.uploadImageBinary(
          req.body,
          ct as 'image/jpeg' | 'image/png' | 'image/webp',
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  return r;
}
