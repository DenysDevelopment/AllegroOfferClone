import type { AllegroClient } from './allegro.js';
import type {
	AllegroOffer,
	AllegroParameter,
	AllegroProduct,
	ProductSearchHit,
	PublicationCommandStatus,
} from './types.js';

export type DescriptionItem =
	| { type: 'TEXT'; content: string }
	| { type: 'IMAGE'; url: string };

export interface DescriptionOverride {
	sections: Array<{ items: DescriptionItem[] }>;
}

export interface CloneOptions {
	sourceOfferId: string;
	/** Map of parameter name (e.g. "Pojemność dysku SSD") → new value (e.g. "512 GB"). */
	paramOverrides: Record<string, string>;
	/** Override the new offer title. If omitted, we try to substitute old values with new in the source title. */
	nameOverride?: string;
	/** Override the price (PLN). */
	priceOverride?: string;
	/** Override the available stock. */
	stockOverride?: number;
	/**
	 * If 'INACTIVE', the new offer is created in draft state. If 'ACTIVE', it goes live as soon as it's accepted.
	 * Default: 'INACTIVE' for safety — operator can review then activate.
	 */
	publicationStatus?: 'ACTIVE' | 'INACTIVE';
	/** Replace the description sections wholesale (text/image items in their section structure). */
	descriptionOverride?: DescriptionOverride;
	/** Replace the offer-level image gallery (array of URLs). */
	imagesOverride?: string[];
	/** Dry run: build the body but don't POST. */
	dryRun?: boolean;
}

export type StepLevel = 'info' | 'warn' | 'error' | 'success';

export interface CloneStep {
	level: StepLevel;
	message: string;
	detail?: unknown;
}

export interface CloneResult {
	steps: CloneStep[];
	body: unknown;
	/** New offer payload (from 201) or last command status (from 202). */
	outcome?:
		| { kind: 'created'; offerId: string; offer: AllegroOffer }
		| { kind: 'queued'; commandId: string; status: PublicationCommandStatus }
		| { kind: 'dry-run' };
	error?: { message: string; status?: number; body?: unknown };
}

/**
 * Build the POST body for a cloned offer with parameter overrides applied.
 * Returns the body plus the diagnostic step log so callers can render progress.
 *
 * Strategy:
 *   1. Take the source offer.
 *   2. Try to find a catalog product with the new parameters.
 *   3. If found → set productSet[0].product = { id: <new product id> }.
 *   4. If not found → keep source product.id but inject overridden parameters[]
 *      so Allegro can find/create a matching product. (This may yield 422
 *      PARAMETER_MISMATCH; the caller should fall back to id-less submission.)
 */
export async function buildCloneBody(
	client: AllegroClient,
	source: AllegroOffer,
	options: CloneOptions,
	steps: CloneStep[],
): Promise<{
	body: Record<string, unknown>;
	matchedProduct?: ProductSearchHit;
}> {
	const productSetItem = source.productSet?.[0];
	const sourceProduct = productSetItem?.product;
	const sourceProductId = sourceProduct?.id;

	if (!sourceProduct) {
		throw new Error(
			'У оферты-источника нет productSet — клонирование невозможно',
		);
	}

	let categoryId = source.category?.id ?? sourceProduct.category?.id;
	let productName = sourceProduct.name;
	let sourceParams: AllegroParameter[] = sourceProduct.parameters ?? [];
	let hydratedImages: unknown = sourceProduct.images;

	// Always fetch the canonical product when an id is present — Allegro's GET /offer
	// response often only includes a partial product (just the id, or missing name/images),
	// and we need a real product name + images for both the catalog search and any
	// fallback product creation.
	if (sourceProductId) {
		try {
			const full = await client.getProduct(sourceProductId);
			productName = productName || full.name;
			categoryId = categoryId ?? full.category?.id;
			if (sourceParams.length === 0 && full.parameters) {
				sourceParams = full.parameters as AllegroParameter[];
			}
			if (
				!hydratedImages ||
				(Array.isArray(hydratedImages) && hydratedImages.length === 0)
			) {
				hydratedImages = full.images;
			}
			steps.push({
				level: 'info',
				message: `Карточка: ${full.name}`,
				detail: { productId: sourceProductId, categoryId },
			});
		} catch (err) {
			steps.push({
				level: 'warn',
				message: `Не удалось загрузить продукт ${sourceProductId}, использую данные оферты`,
				detail: (err as Error).message,
			});
		}
	}

	// Last-resort fallback: if we still don't have a product name, reuse the offer title.
	// Some offers are listed without a catalog link, in which case `source.name` is all we have.
	if (!productName) {
		productName = source.name;
	}

	if (!categoryId) {
		throw new Error('Не удалось определить категорию оферты-источника');
	}

	const overrideEntries = Object.entries(options.paramOverrides);

	// Build the desired parameter list: source params + applied overrides.
	const desiredParams: AllegroParameter[] = sourceParams.map(p => ({ ...p }));
	const oldValues: Array<{ name: string; old?: string; new: string }> = [];

	for (const [paramName, newValue] of overrideEntries) {
		const idx = desiredParams.findIndex(
			p => (p.name ?? '').toLowerCase() === paramName.toLowerCase(),
		);
		if (idx === -1) {
			steps.push({
				level: 'warn',
				message: `Параметр «${paramName}» не найден на источнике - добавлю как новый`,
			});
			desiredParams.push({ id: '', name: paramName, values: [newValue] });
			oldValues.push({ name: paramName, new: newValue });
		} else {
			// Dictionary params keep the human label in `valuesLabels` and `values` is null —
			// fall back to it so title-substitution can find what to replace ("16 GB" etc.).
			const old =
				desiredParams[idx].valuesLabels?.[0] ?? desiredParams[idx].values?.[0];
			desiredParams[idx] = {
				...desiredParams[idx],
				values: [newValue],
				// Drop dictionary id — Allegro will resolve from the value
				valuesIds: undefined,
			};
			oldValues.push({ name: paramName, old, new: newValue });
		}
	}

	// Try to find an existing catalog product matching the new param values.
	let matchedProduct: ProductSearchHit | undefined;
	if (productName) {
		try {
			const phrase = buildSearchPhrase(productName, oldValues);
			steps.push({ level: 'info', message: `Ищу в каталоге: «${phrase}»` });
			const hits = await client.searchProducts({
				phrase,
				categoryId,
				limit: 20,
			});
			matchedProduct = pickBestMatch(hits, desiredParams);
			if (matchedProduct) {
				steps.push({
					level: 'success',
					message: `${matchedProduct.id} — ${matchedProduct.name}`,
				});
			} else {
				steps.push({
					level: 'info',
					message: 'Карточка не найдена — отправляю с явными параметрами',
				});
			}
		} catch (err) {
			steps.push({
				level: 'warn',
				message: `Поиск в каталоге упал: ${(err as Error).message}`,
			});
		}
	}

	// Build the new product payload.
	// When no catalog match is found, Allegro will create a new product from the data we send
	// and requires at least one image, so we hydrate from offer / product as fallback.
	let fallbackImages: string[] = [];
	if (!matchedProduct) {
		fallbackImages = normalizeImageUrls(hydratedImages);
		if (fallbackImages.length === 0)
			fallbackImages = normalizeImageUrls(source.images);
		if (fallbackImages.length === 0) {
			steps.push({
				level: 'warn',
				message:
					'Не нашёл изображений у источника — Allegro может отклонить создание нового продукта',
			});
		}
	}

	const newProduct: AllegroProduct = matchedProduct
		? { id: matchedProduct.id }
		: {
				category: { id: categoryId },
				...(productName ? { name: productName } : {}),
				parameters: desiredParams.filter(p => p.id),
				...(fallbackImages.length ? { images: fallbackImages } : {}),
			};

	const newName =
		options.nameOverride ??
		rewriteTitle(source.name ?? productName ?? '', oldValues);
	if (newName !== source.name) {
		steps.push({
			level: 'info',
			message: `Название: «${source.name}» → «${newName}»`,
		});
	}

	const overriddenDescription = options.descriptionOverride
		? options.descriptionOverride
		: source.description;
	if (options.descriptionOverride) {
		const items = options.descriptionOverride.sections.flatMap(s => s.items);
		const txt = items.filter(i => i.type === 'TEXT').length;
		const img = items.filter(i => i.type === 'IMAGE').length;
		steps.push({
			level: 'info',
			message: `Описание заменено: ${options.descriptionOverride.sections.length} секц. (${txt} текст, ${img} картинок)`,
		});
	}

	// Allegro's GET response returns offer-level images as `{url: string}[]`. The POST
	// endpoint accepts the same shape, so we normalize a plain `string[]` override into it.
	const overriddenImages: AllegroOffer['images'] = options.imagesOverride
		? options.imagesOverride.map(url => ({ url }))
		: source.images;
	if (options.imagesOverride) {
		steps.push({
			level: 'info',
			message: `Картинки заменены: ${options.imagesOverride.length}`,
		});
	}

	const body = stripReadonlyFields({
		...source,
		name: newName,
		description: overriddenDescription,
		images: overriddenImages,
		productSet: [
			{
				...(productSetItem ?? {}),
				product: newProduct,
				// productSet quantity = how many units of the product are in this set
				// (almost always 1 for laptops). It's NOT the available stock — and Allegro
				// requires it to be ≥ 1, so we never let it slip to 0 even if source said so.
				quantity: {
					value: Math.max(1, productSetItem?.quantity?.value ?? 1),
				},
			},
		],
		sellingMode: applyPriceOverride(source.sellingMode, options.priceOverride),
		// stock.available is how many of these offers can actually be sold. If the source
		// has 0 (sold-out / inactive), we default to 1 — otherwise Allegro rejects with 422.
		stock: {
			...(source.stock ?? { unit: 'UNIT' }),
			available:
				options.stockOverride !== undefined
					? options.stockOverride
					: Math.max(1, source.stock?.available ?? 1),
		},
		publication: {
			...(source.publication ?? {}),
			status: options.publicationStatus ?? 'INACTIVE',
		},
	});

	return { body: body as Record<string, unknown>, matchedProduct };
}

/**
 * Allegro returns product images either as `string[]` (just URLs) or `{ url: string }[]`,
 * but when *creating* a new product the POST body expects `string[]`. This helper
 * normalises any of those shapes into a flat array of URL strings.
 */
function normalizeImageUrls(input: unknown): string[] {
	if (!Array.isArray(input)) return [];
	const out: string[] = [];
	for (const item of input) {
		if (typeof item === 'string') {
			out.push(item);
		} else if (
			item &&
			typeof item === 'object' &&
			'url' in item &&
			typeof (item as { url?: unknown }).url === 'string'
		) {
			out.push((item as { url: string }).url);
		}
	}
	return out;
}

function applyPriceOverride(
	selling: AllegroOffer['sellingMode'],
	override: string | undefined,
): AllegroOffer['sellingMode'] {
	if (!override) return selling;
	return {
		...(selling ?? {}),
		price: { amount: override, currency: selling?.price?.currency ?? 'PLN' },
	};
}

/**
 * Build a search phrase from the product name with old parameter values
 * substituted for new ones, e.g.:
 *   "Lenovo IdeaPad 5 16GB 256GB SSD" + ssd 256→512  →  "Lenovo IdeaPad 5 16GB 512GB SSD"
 */
function buildSearchPhrase(
	productName: string,
	changes: Array<{ name: string; old?: string; new: string }>,
): string {
	let phrase = productName;
	for (const c of changes) {
		if (!c.old) continue;
		phrase = substituteValueVariants(phrase, c.old, c.new);
	}
	return phrase;
}

/** Try several common formatting variations when substituting parameter values into a string. */
export function substituteValueVariants(
	s: string,
	oldVal: string,
	newVal: string,
): string {
	const variants = expandVariants(oldVal);
	const targets = expandVariants(newVal);
	let out = s;
	for (let i = 0; i < variants.length; i++) {
		const re = new RegExp(escapeRegExp(variants[i]), 'gi');
		if (re.test(out)) {
			out = out.replace(re, targets[i]);
		}
	}
	return out;
}

function expandVariants(v: string): string[] {
	// "256 GB" → ["256 GB", "256GB", "256gb"]
	// "16 GB"  → ["16 GB",  "16GB",  "16gb"]
	const trimmed = v.trim();
	const tight = trimmed.replace(/\s+/g, '');
	return Array.from(
		new Set([trimmed, tight, tight.toLowerCase(), tight.toUpperCase()]),
	);
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Score catalog hits by how many of the desired parameter values they match.
 * Returns the best-scoring hit, or undefined if no hit matches at least the
 * overridden parameters.
 */
function pickBestMatch(
	hits: ProductSearchHit[],
	desired: AllegroParameter[],
): ProductSearchHit | undefined {
	let best: { hit: ProductSearchHit; score: number } | undefined;
	for (const hit of hits) {
		const score = scoreParameterMatch(hit.parameters ?? [], desired);
		if (!best || score > best.score) {
			best = { hit, score };
		}
	}
	if (!best || best.score <= 0) return undefined;
	return best.hit;
}

function scoreParameterMatch(
	have: AllegroParameter[],
	want: AllegroParameter[],
): number {
	let score = 0;
	for (const w of want) {
		if (!w.values?.length) continue;
		const h = have.find(
			x =>
				x.id === w.id ||
				(w.name && x.name?.toLowerCase() === w.name.toLowerCase()),
		);
		if (!h) continue;
		const valueMatch = h.values?.some(v =>
			w.values?.some(wv => normalizeValue(v) === normalizeValue(wv)),
		);
		if (valueMatch) score += 1;
	}
	return score;
}

function normalizeValue(v: string): string {
	return v.replace(/\s+/g, '').toLowerCase();
}

function rewriteTitle(
	title: string,
	changes: Array<{ name: string; old?: string; new: string }>,
): string {
	let out = title;
	for (const c of changes) {
		if (c.old) {
			out = substituteValueVariants(out, c.old, c.new);
		}
	}
	return out;
}

/**
 * Whitelist of top-level fields that Allegro accepts in POST /sale/product-offers.
 * Anything outside this list is server-managed metadata (id, createdAt, statistics,
 * additionalMarketplaces, base, endedBy, warnings, validation, marketplace, …) and
 * must be removed before submission, otherwise Allegro returns 422 UnknownJSONProperty.
 */
const POST_OFFER_TOP_LEVEL_WHITELIST = new Set([
	'name',
	'category',
	'productSet',
	'ean',
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
	'promotion',
	'fundraisingCampaign',
	'compatibilityList',
	'language',
	'messageToSellerForm',
]);

// Note: deliberately exclude startingAt/endingAt — copying absolute timestamps
// from the source offer is a footgun (they may already be in the past). Allegro
// will compute fresh dates from `duration` when the new offer is published.
const PUBLICATION_WHITELIST = new Set([
	'status',
	'duration',
	'republish',
	'markets',
]);

const SELLING_MODE_READONLY = new Set(['currentPrice']);

/**
 * Strip server-managed and read-only fields that must not appear in the
 * POST body when creating a new offer. Uses a whitelist for top-level keys
 * because Allegro's GET response carries many fields the POST endpoint rejects.
 */
export function stripReadonlyFields(o: AllegroOffer): Record<string, unknown> {
	const out: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(o)) {
		if (
			POST_OFFER_TOP_LEVEL_WHITELIST.has(key) &&
			value !== undefined &&
			value !== null
		) {
			out[key] = value;
		}
	}

	if (out.sellingMode && typeof out.sellingMode === 'object') {
		const sm = { ...(out.sellingMode as Record<string, unknown>) };
		for (const k of SELLING_MODE_READONLY) delete sm[k];
		// startingPrice is only valid for auction-style offers (AUCTION / ADVERTISEMENT_BUY_NOW)
		if (sm.format === 'BUY_NOW') delete sm.startingPrice;
		out.sellingMode = sm;
	}

	if (out.publication && typeof out.publication === 'object') {
		const orig = out.publication as Record<string, unknown>;
		const cleaned: Record<string, unknown> = {};
		for (const k of PUBLICATION_WHITELIST) {
			if (orig[k] !== undefined && orig[k] !== null) cleaned[k] = orig[k];
		}
		out.publication = cleaned;
	}

	return out;
}

export async function cloneOffer(
	client: AllegroClient,
	options: CloneOptions,
): Promise<CloneResult> {
	const steps: CloneStep[] = [];
	const result: CloneResult = { steps, body: undefined };

	steps.push({
		level: 'info',
		message: `Загружаю оферту ${options.sourceOfferId}`,
	});
	const source = await client.getOffer(options.sourceOfferId);
	steps.push({
		level: 'info',
		message: `Источник: «${source.name}» (статус: ${source.publication?.status ?? '?'})`,
	});

	const { body } = await buildCloneBody(client, source, options, steps);
	result.body = body;

	if (options.dryRun) {
		steps.push({
			level: 'info',
			message: 'Превью — тело собрано, не отправлено',
		});
		result.outcome = { kind: 'dry-run' };
		return result;
	}

	steps.push({ level: 'info', message: 'POST /sale/product-offers' });
	try {
		const created = await client.createOffer(body);
		// Both 201 (created) and 202 (created, validation pending) return the offer body
		// with its `id` — they are NOT publication-command IDs. We treat both as success.
		if (
			(created.status === 201 || created.status === 202) &&
			created.offer?.id
		) {
			if (created.status === 202) {
				steps.push({
					level: 'info',
					message: 'Создана с pending-валидацией',
				});
			}
			steps.push({
				level: 'success',
				message: `Оферта создана: ${created.offer.id}`,
			});
			result.outcome = {
				kind: 'created',
				offerId: created.offer.id,
				offer: created.offer,
			};
			return result;
		}
		steps.push({
			level: 'warn',
			message: `Неожиданный статус ответа: ${created.status}`,
		});
		return result;
	} catch (err) {
		const allegroErr = err as {
			status?: number;
			body?: unknown;
			message: string;
		};
		steps.push({
			level: 'error',
			message: allegroErr.message ?? 'Неизвестная ошибка',
			detail: allegroErr.body,
		});
		result.error = {
			message: allegroErr.message ?? 'Неизвестная ошибка',
			status: allegroErr.status,
			body: allegroErr.body,
		};
		return result;
	}
}
