import type { AllegroClient } from './allegro.js';
import { validateAllegroBody, type ValidationIssue } from './body-validate.js';
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
	/**
	 * Force-bind the new offer to this catalog product id, ignoring source offer's
	 * product and any catalog search. The product card's parameters/images become
	 * the source of truth — source offer is reduced to a "commercial template"
	 * (price, stock, delivery, returns).
	 */
	targetProductId?: string;
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
	sourceClient: AllegroClient = client,
): Promise<{
	body: Record<string, unknown>;
	matchedProduct?: ProductSearchHit;
}> {
	// When source ≠ target, source's PROPOSED (user-suggested, not yet globally
	// listed) product cards are NOT reusable by id — only the proposer's account
	// can bind offers to them. We need to detect this so we can fall back to
	// inline product data and let the target's account create its own proposal.
	const crossAccount = sourceClient !== client;
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
	let sourceProductStatus: string | undefined;

	// Always fetch the canonical product when an id is present — Allegro's GET /offer
	// response often only includes a partial product (just the id, or missing name/images),
	// and we need a real product name + images for both the catalog search and any
	// fallback product creation. Fetch via SOURCE client: for PROPOSED cards the
	// target account would 404, the proposer's account always has access.
	if (sourceProductId) {
		try {
			const full = await sourceClient.getProduct(sourceProductId);
			productName = productName || full.name;
			categoryId = categoryId ?? full.category?.id;
			sourceProductStatus = (full as { publication?: { status?: string } })
				.publication?.status;
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
				message: `Карточка: ${full.name}${sourceProductStatus ? ` (${sourceProductStatus})` : ''}`,
				detail: { productId: sourceProductId, categoryId, status: sourceProductStatus },
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

	// If the operator explicitly bound a target product from the catalog, swap
	// the productSet item to point at it and skip parameter search entirely.
	if (options.targetProductId && options.targetProductId !== sourceProductId) {
		steps.push({
			level: 'info',
			message: `Привязка к товару из каталога: ${options.targetProductId}`,
		});
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

	// Catalog search is only useful when overrides may shift the offer to a
	// DIFFERENT product card. With no overrides we just reuse the source's
	// productId — no API call needed and zero risk of a false-negative.
	const hasOverrides = overrideEntries.length > 0;

	// Cross-account binding only works for LISTED product cards. PROPOSED cards
	// are private to the proposer's account, so we have to either re-propose in
	// the target account (via inline data) or search for an equivalent LISTED card.
	const canReuseSourceCard =
		!!sourceProductId &&
		(!crossAccount || sourceProductStatus !== 'PROPOSED');

	if (
		crossAccount &&
		sourceProductId &&
		sourceProductStatus === 'PROPOSED' &&
		!options.targetProductId
	) {
		steps.push({
			level: 'warn',
			message:
				'Карточка источника — PROPOSED (предложена другим аккаунтом). Целевой аккаунт не может на неё ссылаться: ищу аналог в каталоге или предложу свою.',
		});
	}

	let matchedProduct: ProductSearchHit | undefined;
	// Search the catalog when there are overrides (looking for a different card)
	// OR when source's card is unreusable across accounts (looking for an equivalent).
	const shouldSearchCatalog =
		hasOverrides || (sourceProductId && !canReuseSourceCard);
	if (productName && shouldSearchCatalog) {
		try {
			const phrase = buildSearchPhrase(productName, oldValues);
			steps.push({ level: 'info', message: `Ищу в каталоге: «${phrase}»` });
			const { products: hits } = await client.searchProducts({
				phrase,
				categoryId,
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

	const reusingSourceCard =
		!options.targetProductId &&
		!matchedProduct &&
		!hasOverrides &&
		canReuseSourceCard;

	// When we end up with no productId at all we let Allegro derive a new product
	// from inline data — that requires at least one image.
	const willUseInlineProduct =
		!options.targetProductId && !matchedProduct && !reusingSourceCard;

	let fallbackImages: string[] = [];
	if (willUseInlineProduct) {
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

	const newProduct: AllegroProduct = options.targetProductId
		? { id: options.targetProductId }
		: matchedProduct
			? { id: matchedProduct.id }
			: reusingSourceCard
				? { id: sourceProductId! }
				: {
						category: { id: categoryId },
						...(productName ? { name: productName } : {}),
						parameters: desiredParams.filter(p => p.id),
						...(fallbackImages.length ? { images: fallbackImages } : {}),
					};

	if (reusingSourceCard) {
		steps.push({
			level: 'info',
			message: `Привязка к карточке источника: ${sourceProductId}`,
		});
	} else if (willUseInlineProduct && sourceProductId && productName) {
		steps.push({
			level: 'info',
			message: `Отправляю inline-карточку «${productName}» — Allegro подберёт или создаст эквивалент в target-аккаунте`,
		});
	}

	// Title defaults to the CATALOG product card name (productName), not the
	// offer's listing title — operator can still type nameOverride. We do NOT
	// substitute parameter overrides into it (per product decision 2026-05-28).
	const newName = options.nameOverride ?? productName ?? source.name ?? '';
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

	// When a target product is bound, the OFFER body should not carry source's
	// product-level data (category/parameters/images/description/name) — Allegro
	// pulls those from the catalog product card. Otherwise source's mismatched
	// category/parameters will fight the new product and produce 422.
	//
	// We still honour explicit operator overrides (nameOverride, imagesOverride,
	// descriptionOverride), since those are deliberately per-offer changes.
	const isTargetBind = Boolean(options.targetProductId);

	const baseOffer = isTargetBind
		? stripProductLevelFields(source)
		: { ...source };

	const body = stripReadonlyFields({
		...baseOffer,
		// Name: keep source-derived only when not bound to a different product.
		// On target-bind we let the catalog name through, unless operator typed one.
		...(options.nameOverride
			? { name: options.nameOverride }
			: isTargetBind
				? {}
				: { name: newName }),
		...(options.descriptionOverride
			? { description: options.descriptionOverride }
			: isTargetBind
				? {}
				: { description: overriddenDescription }),
		...(options.imagesOverride
			? { images: options.imagesOverride.map(url => ({ url })) }
			: isTargetBind
				? {}
				: { images: overriddenImages }),
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
		// delivery / afterSalesServices / discounts: resolve account-scoped refs
		// (shipping rates, return policy, warranties, wholesale price list) —
		// must come after ...baseOffer so it overrides the source's copies.
		...(resolveOfferRefs(source, options, crossAccount, steps) as Partial<AllegroOffer>),
	} as AllegroOffer);

	if (isTargetBind) {
		steps.push({
			level: 'info',
			message:
				'Привязка к каталогу: name/description/images/category/parameters берутся из карточки товара',
		});
	}

	return { body: body as Record<string, unknown>, matchedProduct };
}

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

	if (sourceItem?.safetyInformation != null) {
		out.safetyInformation = sourceItem.safetyInformation;
	}
	if (sourceItem?.marketedBeforeGPSRObligation != null) {
		out.marketedBeforeGPSRObligation = sourceItem.marketedBeforeGPSRObligation;
	}

	if (options.gpsr) {
		// `value` sets the field, `null` explicitly clears it (drop from `out`),
		// `undefined` leaves whatever was seeded above untouched. Handled
		// symmetrically for all three fields.
		const g = options.gpsr;
		if (g.responsibleProducer) out.responsibleProducer = g.responsibleProducer;
		else if (g.responsibleProducer === null) delete out.responsibleProducer;
		if (g.responsiblePerson) out.responsiblePerson = g.responsiblePerson;
		else if (g.responsiblePerson === null) delete out.responsiblePerson;
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
		if (!crossAccount) {
			// Same account — carry the source ref. Prefer id; fall back to a
			// name-only ref (Allegro allows { name } dictionary lookups too).
			if (sourceRef.id) return { id: sourceRef.id };
			if (sourceRef.name) return { name: sourceRef.name };
			return undefined;
		}
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
	const hasAssOverride =
		options.offerRefs?.returnPolicy !== undefined ||
		options.offerRefs?.impliedWarranty !== undefined ||
		options.offerRefs?.warranty !== undefined;
	if (srcAss || hasAssOverride) {
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
		out.afterSalesServices = ass;
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

/**
 * When binding to a catalog product, drop source offer's product-level fields
 * so they don't override the catalog data. Keeps offer-level commercial fields
 * (sellingMode, stock, delivery, payments, afterSalesServices, publication).
 */
function stripProductLevelFields(source: AllegroOffer): AllegroOffer {
	const out: AllegroOffer = { ...source };
	delete out.category;
	delete out.name;
	delete out.description;
	delete out.images;
	delete out.parameters;
	delete (out as { ean?: unknown }).ean;
	return out;
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

/**
 * Whitelist of top-level fields that Allegro accepts in POST /sale/product-offers.
 * Anything outside this list is server-managed metadata (id, createdAt, statistics,
 * base, endedBy, warnings, validation, marketplace, …) and must be removed before
 * submission, otherwise Allegro returns 422 UnknownJSONProperty.
 */
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

/**
 * Re-upload every IMAGE-item URL inside the description through the target
 * account's `POST /sale/images?url=...` so the resulting URLs are "attached"
 * to the new offer being created. Allegro otherwise rejects the create with
 * `ConstraintViolationException.DescriptionImageNotAttached`. Mutates body
 * in place. Failures are reported as warn steps but don't abort the clone
 * (the create call will surface the same problem with a clearer message).
 */
async function reuploadDescriptionImages(
	client: AllegroClient,
	body: Record<string, unknown>,
	steps: CloneStep[],
): Promise<void> {
	const desc = (body as { description?: DescriptionOverride }).description;
	if (!desc?.sections?.length) return;
	let ok = 0;
	let fail = 0;
	let same = 0;
	for (const s of desc.sections) {
		for (const it of s.items) {
			if (it.type !== 'IMAGE') continue;
			const url = it.url?.trim();
			if (!url) continue;
			try {
				const r = await client.uploadImageByUrl(url);
				const newUrl = r.location;
				const unchanged = newUrl === url;
				if (unchanged) same++;
				it.url = newUrl;
				ok++;
				steps.push({
					level: unchanged ? 'warn' : 'info',
					message:
						`desc-img re-upload: ${shortenUrl(url)} → ${shortenUrl(newUrl)}` +
						(unchanged ? ' (Allegro dedup — same URL)' : ''),
				});
			} catch (err) {
				fail++;
				steps.push({
					level: 'warn',
					message: `Не удалось перезалить картинку описания (${url}): ${(err as Error).message}`,
				});
			}
		}
	}
	if (ok > 0 || fail > 0) {
		steps.push({
			level: same > 0 ? 'warn' : 'info',
			message:
				`Описательные картинки перезалиты: ${ok}` +
				(same > 0 ? ` (из них ${same} вернулись с тем же URL — dedup)` : '') +
				(fail > 0 ? ` (не удалось: ${fail})` : ''),
		});
	}
}

function shortenUrl(u: string): string {
	const m = u.match(/^https?:\/\/[^/]+\/(?:original|s?\d+x?\d*)?\/?(.{0,40}).*$/);
	return m ? `…/${m[1]}` : u.length > 60 ? `${u.slice(0, 60)}…` : u;
}

/**
 * When the offer is bound to a catalog product (productSet[0].product.id),
 * Allegro pulls the catalog product's description and validates ITS IMAGE
 * URLs against the offer's `images` gallery — exactly like for offer-level
 * descriptions. Fetch the catalog product and append every URL referenced by
 * its description / images that's not already in `body.images`. Mutates in
 * place; non-fatal on fetch failure.
 */
async function syncCatalogProductImagesToGallery(
	client: AllegroClient,
	body: Record<string, unknown>,
	steps: CloneStep[],
): Promise<void> {
	const productSet = (
		body as { productSet?: Array<{ product?: { id?: string } }> }
	).productSet;
	const productId = productSet?.[0]?.product?.id;
	if (!productId) return;

	let product: Awaited<ReturnType<typeof client.getProduct>>;
	try {
		product = await client.getProduct(productId);
	} catch (err) {
		steps.push({
			level: 'warn',
			message: `Не удалось получить карточку товара ${productId}: ${(err as Error).message}`,
		});
		return;
	}

	const urls = new Set<string>();
	const productImages = (product as { images?: unknown }).images;
	if (Array.isArray(productImages)) {
		for (const img of productImages) {
			const url =
				typeof img === 'string'
					? img
					: typeof img === 'object' && img !== null
						? (img as { url?: string }).url
						: undefined;
			if (url) urls.add(url.trim());
		}
	}
	const productDesc = (product as { description?: unknown }).description;
	if (productDesc && typeof productDesc === 'object') {
		const sections =
			(productDesc as { sections?: unknown }).sections ??
			(productDesc as { standardized?: { sections?: unknown } }).standardized
				?.sections;
		if (Array.isArray(sections)) {
			for (const s of sections) {
				const items = (s as { items?: unknown }).items;
				if (!Array.isArray(items)) continue;
				for (const it of items) {
					if ((it as { type?: string }).type !== 'IMAGE') continue;
					const url = (it as { url?: string }).url?.trim();
					if (url) urls.add(url);
				}
			}
		}
	}

	if (urls.size === 0) {
		steps.push({
			level: 'info',
			message: `Карточка товара ${productId}: нет картинок к синхронизации`,
		});
		return;
	}

	const bodyImages =
		(body as { images?: { url: string }[] }).images?.slice() ?? [];
	const gallery = new Set(
		bodyImages.map(i => i.url).filter((u): u is string => Boolean(u)),
	);
	let added = 0;
	for (const url of urls) {
		if (!gallery.has(url)) {
			bodyImages.push({ url });
			gallery.add(url);
			added++;
		}
	}
	(body as { images?: { url: string }[] }).images = bodyImages;
	steps.push({
		level: 'info',
		message: `Карточка товара ${productId}: ${urls.size} картинок, добавлено в галерею ${added}`,
	});
}

/**
 * Allegro requires every URL inside `description.sections[*].items[type=IMAGE]`
 * to also appear in the offer's top-level `images` array. Without this the
 * service returns `ConstraintViolationException.DescriptionImageNotAttached`
 * (in Polish: "Opis zawiera niezałączone zdjęcie"). Append any description
 * image URL that's missing from the gallery; mutates body in place.
 */
export function syncDescriptionImagesToGallery(
	body: Record<string, unknown>,
	steps: CloneStep[],
): void {
	const desc = (body as { description?: DescriptionOverride }).description;
	if (!desc?.sections?.length) return;
	const bodyImages =
		(body as { images?: { url: string }[] }).images?.slice() ?? [];
	const gallery = new Set(
		bodyImages.map(i => i.url).filter((u): u is string => Boolean(u)),
	);
	const added: string[] = [];
	for (const s of desc.sections) {
		for (const it of s.items) {
			if (it.type !== 'IMAGE') continue;
			const url = it.url?.trim();
			if (!url) continue;
			if (!gallery.has(url)) {
				bodyImages.push({ url });
				gallery.add(url);
				added.push(url);
			}
		}
	}
	if (added.length === 0) return;
	(body as { images?: { url: string }[] }).images = bodyImages;
	steps.push({
		level: 'info',
		message: `Описательные картинки добавлены в галерею: ${added.length} (требование Allegro — описательные URL должны быть в images)`,
	});
}

/**
 * Allegro caps `body.images` at 16 per offer. If we exceed the cap (e.g. user
 * override 16 + description IMAGE items), trim to 16 — and DROP any description
 * IMAGE-items whose URLs didn't make the cut (otherwise Allegro would reject
 * with DescriptionImageNotAttached). Mutates body in place.
 */
const ALLEGRO_MAX_IMAGES = 16;
export function capImagesAndPruneDescription(
	body: Record<string, unknown>,
	steps: CloneStep[],
): void {
	const bodyImages = (body as { images?: { url: string }[] }).images;
	if (!bodyImages || bodyImages.length <= ALLEGRO_MAX_IMAGES) return;

	// Description IMAGE URLs are "must keep" — Allegro rejects the offer if
	// any description URL isn't in `images`. Gallery (override) URLs are
	// "nice to have" — we drop the tail of them to fit the 16-image cap,
	// preserving the original order so the gallery thumbnail stays put.
	const desc = (body as { description?: DescriptionOverride }).description;
	const descUrls = new Set<string>();
	if (desc?.sections?.length) {
		for (const s of desc.sections) {
			for (const it of s.items) {
				if (it.type === 'IMAGE' && it.url) descUrls.add(it.url);
			}
		}
	}
	const mustKeepCount = bodyImages.filter(img => descUrls.has(img.url)).length;
	const slotsForOptional = Math.max(0, ALLEGRO_MAX_IMAGES - mustKeepCount);

	const kept: { url: string }[] = [];
	let optionalSeen = 0;
	for (const img of bodyImages) {
		if (descUrls.has(img.url)) {
			if (kept.length < ALLEGRO_MAX_IMAGES) kept.push(img);
		} else if (optionalSeen < slotsForOptional) {
			kept.push(img);
			optionalSeen++;
		}
	}
	const keptUrls = new Set(kept.map(i => i.url).filter(Boolean));
	(body as { images?: { url: string }[] }).images = kept;

	// Defensive: drop description IMAGE-items whose URLs didn't make it
	// (only possible when descUrls > 16 itself).
	let prunedItems = 0;
	if (desc?.sections?.length) {
		const nextSections: typeof desc.sections = [];
		for (const s of desc.sections) {
			const items = s.items.filter(it => {
				if (it.type !== 'IMAGE') return true;
				if (keptUrls.has(it.url)) return true;
				prunedItems++;
				return false;
			});
			if (items.length > 0) nextSections.push({ items });
		}
		desc.sections = nextSections;
	}

	const droppedOptional = bodyImages.length - kept.length - prunedItems;
	steps.push({
		level: 'warn',
		message:
			`Галерея ужата до ${ALLEGRO_MAX_IMAGES} (было ${bodyImages.length})` +
			`; убрано из хвоста галереи: ${droppedOptional}` +
			(prunedItems > 0
				? `; из описания убрано: ${prunedItems}`
				: '; описательные картинки сохранены полностью'),
	});
}

/**
 * Allegro accepts `images` as either `string[]` OR `{url: string}[]` but NOT
 * a mix of the two — a heterogeneous array breaks Jackson deserialization
 * (`JsonMappingException` at the first index where the shape changes). GET
 * returns strings and our helpers push `{url}` objects, so we normalize
 * everything to `{url}` here, in place.
 */
function normalizeImagesShape(
	body: Record<string, unknown>,
	steps: CloneStep[],
): void {
	const imgs = (body as { images?: unknown }).images;
	if (!Array.isArray(imgs)) return;
	let convertedStrings = 0;
	const out: { url: string }[] = [];
	for (const it of imgs) {
		if (typeof it === 'string') {
			out.push({ url: it });
			convertedStrings++;
		} else if (
			it &&
			typeof it === 'object' &&
			typeof (it as { url?: unknown }).url === 'string'
		) {
			out.push({ url: (it as { url: string }).url });
		}
	}
	(body as { images: { url: string }[] }).images = out;
	if (convertedStrings > 0) {
		steps.push({
			level: 'info',
			message: `images нормализованы: ${convertedStrings} строковых URL → {url}-объекты (Allegro не принимает смешанный массив)`,
		});
	}
}

/**
 * Final image-shape pass: Allegro's POST /sale/product-offers schema accepts
 * `images` as a flat array of URL strings (`string[]`) — not as
 * `{url: string}[]`, which is what /sale/products accepts. Mixed shapes or
 * pure `{url}[]` here cause `JsonMappingException` at images[0]. Internally
 * helpers prefer `{url}` objects so they can dedupe and reason about entries,
 * so we convert back to strings just before the create call.
 */
function imagesObjectsToStrings(
	body: Record<string, unknown>,
	steps: CloneStep[],
): void {
	const imgs = (body as { images?: unknown }).images;
	if (!Array.isArray(imgs)) return;
	const out: string[] = [];
	for (const it of imgs) {
		if (typeof it === 'string') out.push(it);
		else if (
			it &&
			typeof it === 'object' &&
			typeof (it as { url?: unknown }).url === 'string'
		) {
			out.push((it as { url: string }).url);
		}
	}
	(body as { images: string[] }).images = out;
	steps.push({
		level: 'info',
		message: `images приведены к string[] (Allegro offer-POST требует именно эту форму): ${out.length} URL`,
	});
}

/**
 * Diagnostic: log each body.images entry's keys + full URL so we can compare
 * "good" vs "bad" entries from Allegro's 422 responses (e.g. `images[9]`).
 */
function logImagesShape(
	body: Record<string, unknown>,
	steps: CloneStep[],
): void {
	const imgs = (body as { images?: unknown[] }).images;
	if (!Array.isArray(imgs)) return;
	const summary: string[] = [];
	for (let i = 0; i < imgs.length; i++) {
		const it = imgs[i];
		if (typeof it !== 'object' || it === null) {
			summary.push(`#${i} ${typeof it} ${JSON.stringify(it)}`);
		} else {
			const keys = Object.keys(it).sort().join(',');
			const url = (it as { url?: unknown }).url;
			summary.push(
				`#${i} keys=[${keys}] url=${typeof url === 'string' ? url : JSON.stringify(url)}`,
			);
		}
	}
	steps.push({
		level: 'info',
		message: `images shape (${imgs.length}):\n${summary.join('\n')}`,
	});
}

/**
 * Allegro's POST /sale/product-offers rejects unknown properties with
 * `UnknownJSONProperty`. Source offers (returned by GET) include read-only
 * sub-fields that GET sets but POST doesn't accept — most notably
 * `additionalMarketplaces.<marketplace>.publication`. Strip them in place.
 */
function stripReadOnlyPostFields(
	body: Record<string, unknown>,
	steps: CloneStep[],
): void {
	const am = (
		body as {
			additionalMarketplaces?: Record<string, Record<string, unknown>>;
		}
	).additionalMarketplaces;
	if (!am || typeof am !== 'object') return;
	let removed = 0;
	for (const marketplace of Object.values(am)) {
		if (
			marketplace &&
			typeof marketplace === 'object' &&
			'publication' in marketplace
		) {
			delete marketplace.publication;
			removed++;
		}
	}
	if (removed > 0) {
		steps.push({
			level: 'info',
			message: `Из additionalMarketplaces удалены read-only поля publication: ${removed}`,
		});
	}
}

/**
 * Allegro's `standardized.sections[*].items` must hold 1 or 2 items, AND the
 * layout [TEXT, TEXT] (two text blocks in one row) is explicitly forbidden.
 * This function:
 *   1. Chunks any section with >2 items into ≤2-item chunks, preserving order.
 *   2. Splits any resulting [TEXT, TEXT] pair into two single-text rows.
 * Mutates body in place.
 */
export function splitDescriptionSectionsToMaxTwoItems(
	body: Record<string, unknown>,
	steps: CloneStep[],
): void {
	const desc = (body as { description?: DescriptionOverride }).description;
	if (!desc?.sections?.length) return;
	let chunked = 0;
	let textPairsSplit = 0;
	const next: typeof desc.sections = [];
	for (const s of desc.sections) {
		// 1) Chunk any section with >2 items into ≤2-item chunks, preserving order.
		const chunks: DescriptionItem[][] =
			s.items.length <= 2
				? [s.items]
				: (() => {
						chunked++;
						const acc: DescriptionItem[][] = [];
						for (let i = 0; i < s.items.length; i += 2) {
							acc.push(s.items.slice(i, i + 2));
						}
						return acc;
					})();
		// 2) Any [TEXT, TEXT] pair is illegal on Allegro — split into two single rows.
		for (const items of chunks) {
			if (
				items.length === 2 &&
				items[0].type === 'TEXT' &&
				items[1].type === 'TEXT'
			) {
				textPairsSplit++;
				next.push({ items: [items[0]] });
				next.push({ items: [items[1]] });
			} else {
				next.push({ items });
			}
		}
	}
	if (chunked > 0 || textPairsSplit > 0) {
		desc.sections = next;
		const clauses: string[] = [];
		if (chunked > 0)
			clauses.push(`секц. с >2 элементами разрезано ${chunked}`);
		if (textPairsSplit > 0)
			clauses.push(`пар [текст+текст] разделено ${textPairsSplit} (Allegro запрещает два текста в строке)`);
		steps.push({
			level: 'info',
			message: `Описание нормализовано: ${clauses.join('; ')}`,
		});
	}
}

export async function cloneOffer(
	client: AllegroClient,
	options: CloneOptions,
	sourceClient: AllegroClient = client,
): Promise<CloneResult> {
	const steps: CloneStep[] = [];
	const result: CloneResult = { steps, body: undefined };

	steps.push({
		level: 'info',
		message: `Загружаю оферту ${options.sourceOfferId}`,
	});
	// Source offer is read with the offer owner's credentials — only that account
	// has access (Allegro returns 403 OfferAccessDeniedException otherwise).
	const source = await sourceClient.getOffer(options.sourceOfferId);
	steps.push({
		level: 'info',
		message: `Источник: «${source.name}» (статус: ${source.publication?.status ?? '?'})`,
	});

	const { body } = await buildCloneBody(client, source, options, steps, sourceClient);
	result.body = body;

	if (options.dryRun) {
		steps.push({
			level: 'info',
			message: 'Превью — тело собрано, не отправлено',
		});
		result.outcome = { kind: 'dry-run' };
		return result;
	}

	// Normalize body.images shape: Allegro returns `string[]` from GET but our
	// helpers push `{url}` objects. A mixed array (some strings + some objects)
	// causes Allegro POST to return `JsonMappingException` at the first index
	// where the shape changes. Convert everything to `{url}` up front.
	normalizeImagesShape(body, steps);
	// When the offer is bound to a catalog product AND body.description is NOT
	// overridden, Allegro uses the catalog's description — its IMAGE URLs must
	// then be in `images`. When body.description IS overridden, Allegro uses
	// our description, so catalog images are not validated and syncing them
	// just wastes precious image slots (Allegro caps `images` at 16).
	if (!(body as { description?: unknown }).description) {
		await syncCatalogProductImagesToGallery(client, body, steps);
	}
	// Re-upload description IMAGE URLs through this account's upload endpoint so
	// they're freshly attached to this account — covers cross-account clones
	// where source URLs were uploaded under the source's session.
	await reuploadDescriptionImages(client, body, steps);
	// Allegro rule (per developer.allegro.pl): each URL appearing in
	// `description.sections[*].items[type=IMAGE]` MUST also appear in `images`
	// (the offer gallery). Otherwise Allegro returns
	// `ConstraintViolationException.DescriptionImageNotAttached`, even if the
	// URL was freshly uploaded. Sync description URLs into `images`.
	syncDescriptionImagesToGallery(body, steps);
	// Allegro caps `images` at 16 per offer. Trim if needed, and remove any
	// description IMAGE-items whose URLs got dropped — those would otherwise
	// trigger DescriptionImageNotAttached again.
	capImagesAndPruneDescription(body, steps);
	// Allegro requires each `description.sections[*].items` array to hold AT MOST
	// 2 items. Source offers (or appended templates) can produce longer sections;
	// split them into ≤2-item chunks, preserving order.
	splitDescriptionSectionsToMaxTwoItems(body, steps);
	// Strip read-only fields that creep in from source offer — Allegro rejects
	// them with `UnknownJSONProperty` on POST (e.g.
	// `additionalMarketplaces.<marketplace>.publication`).
	stripReadOnlyPostFields(body, steps);
	// Allegro POST /sale/product-offers expects `images` as `string[]`
	// (the GET-shape), NOT `{url: string}[]` (the one /sale/products accepts).
	// Convert back to strings just before send.
	imagesObjectsToStrings(body, steps);
	// Final diagnostic: log the shape of body.images so we can compare what
	// Allegro accepts vs. rejects.
	logImagesShape(body, steps);

	// Pre-flight validation: catch any rule we already know so we don't burn
	// an Allegro request on a body we can already tell is bad.
	const issues = validateAllegroBody(body, 'offer');
	if (issues.length > 0) {
		const errors = issues.filter(i => i.level === 'error');
		for (const i of issues) {
			steps.push({
				level: i.level,
				message: `validation: ${i.path ?? '?'}: ${i.message}`,
			});
		}
		if (errors.length > 0) {
			result.error = {
				message: `Не отправлено в Allegro — найдено ${errors.length} проблем(ы) при предварительной валидации (см. шаги).`,
				body: { validationIssues: errors satisfies ValidationIssue[] },
			};
			return result;
		}
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
