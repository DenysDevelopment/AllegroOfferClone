import { Router, type Request, type RequestHandler } from 'express';
import express from 'express';
import { z } from 'zod';
import type { AllegroClient } from '../core/allegro.js';
import { cloneOffer, buildCloneBody } from '../core/clone.js';
import type { AccountRegistry } from '../core/registry.js';
import type { AllegroOffer } from '../core/types.js';

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
  dryRun: z.boolean().default(false),
});

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
  } else if (rp) {
    // Unknown shape (no `type` discriminant) — pass it through as-is rather
    // than silently dropping it.
    out.responsibleProducer = rp;
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

  const srId = offer.delivery?.shippingRates?.id;
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

export function apiRouter(registry: AccountRegistry): Router {
  const r = Router();

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
      // Independent — resolve GPSR and offer refs in parallel.
      const [gpsr, offerRefs] = await Promise.all([
        resolveOfferGpsr(client, offer),
        resolveOfferRefsPreview(client, offer),
      ]);
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

  return r;
}
