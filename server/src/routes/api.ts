import { Router, type Request, type RequestHandler } from 'express';
import express from 'express';
import path from 'node:path';
import { z } from 'zod';
import type { AllegroClient } from '../core/allegro.js';
import { cloneOffer, buildCloneBody } from '../core/clone.js';
import type { AccountRegistry } from '../core/registry.js';
import { TemplateStore } from '../core/templates.js';

const descriptionItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TEXT'), content: z.string() }),
  z.object({ type: z.literal('IMAGE'), url: z.string().url() }),
]);

const descriptionSchema = z.object({
  sections: z
    .array(z.object({ items: z.array(descriptionItemSchema).min(1) }))
    .min(1),
});

const templateCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  sections: descriptionSchema.shape.sections,
});

const templateUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    sections: descriptionSchema.shape.sections.optional(),
  })
  .refine((p) => p.name !== undefined || p.sections !== undefined, {
    message: 'at least one of name, sections is required',
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
  dryRun: z.boolean().default(false),
});

declare module 'express-serve-static-core' {
  interface Request {
    /** Target/publish account (writes go here). */
    allegro?: AllegroClient;
    accountId?: string;
    /** Source/browse account (the active account in UI — owns the offers being read). */
    sourceAllegro?: AllegroClient;
    sourceAccountId?: string;
  }
}

export function apiRouter(registry: AccountRegistry, dataDir: string): Router {
  const r = Router();

  const templateStore = new TemplateStore(
    path.join(dataDir, 'description-templates.json'),
  );

  const pickAccount: RequestHandler = (req, _res, next) => {
    // Source (browse) = X-Account-Id header > ?account= > default.
    // Target (publish) = body.accountId > source. Body override only used by
    // POSTs that actually publish (clone, propose product).
    const fromBody =
      req.body && typeof req.body === 'object' && 'accountId' in req.body
        ? String((req.body as { accountId?: unknown }).accountId ?? '')
        : '';
    const headerVal = req.header('x-account-id');
    const queryVal = typeof req.query.account === 'string' ? req.query.account : '';
    const sourceWanted = headerVal || queryVal || undefined;
    const targetWanted = fromBody || sourceWanted;

    const source = registry.resolveOrDefault(sourceWanted);
    const target = registry.resolveOrDefault(targetWanted);
    req.sourceAllegro = source.allegro;
    req.sourceAccountId = source.config.accountId;
    req.allegro = target.allegro;
    req.accountId = target.config.accountId;
    next();
  };

  // Apply to JSON routes after express.json() has parsed the body.
  r.use(pickAccount);

  r.get('/me', async (req, res, next) => {
    try {
      res.json(await req.allegro!.me());
    } catch (e) {
      next(e);
    }
  });

  r.get('/offers/:id', async (req, res, next) => {
    try {
      const offer = await req.allegro!.getOffer(req.params.id);
      res.json(offer);
    } catch (e) {
      next(e);
    }
  });

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
      const result = await cloneOffer(req.allegro!, parsed.data, req.sourceAllegro!);
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
      const source = req.sourceAllegro!;
      const target = req.allegro!;
      const offer = await source.getOffer(parsed.data.sourceOfferId);
      const steps: Parameters<typeof buildCloneBody>[3] = [];
      const { body, matchedProduct } = await buildCloneBody(target, offer, parsed.data, steps, source);
      res.json({ steps, body, matchedProduct });
    } catch (e) {
      next(e);
    }
  });

  r.get('/commands/:id', async (req, res, next) => {
    try {
      res.json(await req.allegro!.getCommandStatus(req.params.id));
    } catch (e) {
      next(e);
    }
  });

  r.get('/helpers/shipping-rates', async (req, res, next) => {
    try {
      res.json(await req.allegro!.listShippingRates());
    } catch (e) {
      next(e);
    }
  });

  r.get('/helpers/return-policies', async (req, res, next) => {
    try {
      res.json(await req.allegro!.listReturnPolicies());
    } catch (e) {
      next(e);
    }
  });

  r.get('/helpers/implied-warranties', async (req, res, next) => {
    try {
      res.json(await req.allegro!.listImpliedWarranties());
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
      res.json({ matchingCategories: await req.allegro!.matchCategories(phrase) });
    } catch (e) {
      next(e);
    }
  });

  r.get('/categories/:id/parameters', async (req, res, next) => {
    try {
      res.json(await req.allegro!.getCategoryParameters(req.params.id));
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
    const pageId = req.query.pageId ? String(req.query.pageId) : undefined;
    try {
      const result = await req.allegro!.searchProducts({ phrase, categoryId, pageId });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  r.get('/products/:id', async (req, res, next) => {
    try {
      res.json(await req.allegro!.getProduct(req.params.id));
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
      const result = await req.allegro!.proposeProduct(body);
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
      res.json(await req.allegro!.uploadImageByUrl(url.data));
    } catch (e) {
      next(e);
    }
  });

  const allowedImageMime = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const rawImage = express.raw({ type: () => true, limit: '12mb' });

  // The binary-upload route needs the account picker AFTER the raw parser
  // (so the JSON-body pickAccount middleware above doesn't apply here — the
  // raw parser leaves req.body as a Buffer, no 'accountId' field is read).
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
        await req.allegro!.uploadImageBinary(
          req.body,
          ct as 'image/jpeg' | 'image/png' | 'image/webp',
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  // --- description templates (global, account-independent) ---

  r.get('/description-templates', async (_req, res, next) => {
    try {
      res.json({ templates: await templateStore.list() });
    } catch (e) {
      next(e);
    }
  });

  r.post('/description-templates', async (req, res, next) => {
    const parsed = templateCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'VALIDATION', details: parsed.error.format() });
    }
    try {
      const created = await templateStore.create(
        parsed.data.name,
        parsed.data.sections,
      );
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  });

  r.put('/description-templates/:id', async (req, res, next) => {
    const parsed = templateUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'VALIDATION', details: parsed.error.format() });
    }
    try {
      const updated = await templateStore.update(req.params.id, parsed.data);
      if (!updated) {
        return res.status(404).json({ error: 'NOT_FOUND' });
      }
      res.json(updated);
    } catch (e) {
      next(e);
    }
  });

  r.delete('/description-templates/:id', async (req, res, next) => {
    try {
      const existed = await templateStore.remove(req.params.id);
      if (!existed) {
        return res.status(404).json({ error: 'NOT_FOUND' });
      }
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return r;
}
