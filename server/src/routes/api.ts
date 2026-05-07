import { Router } from 'express';
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

const cloneSchema = z.object({
  sourceOfferId: z.string().min(1),
  paramOverrides: z.record(z.string(), z.string()).default({}),
  nameOverride: z.string().optional(),
  priceOverride: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  stockOverride: z.number().int().min(0).optional(),
  publicationStatus: z.enum(['ACTIVE', 'INACTIVE']).default('INACTIVE'),
  descriptionOverride: descriptionSchema.optional(),
  imagesOverride: z.array(z.string().url()).optional(),
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

  return r;
}
