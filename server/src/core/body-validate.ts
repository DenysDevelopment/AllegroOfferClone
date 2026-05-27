/**
 * Pre-flight body validation for Allegro POST endpoints. Catches the rules we
 * already know — image count, section items, description-in-images, shape
 * mismatches, read-only fields — so we don't burn Allegro requests on bodies
 * we can already tell are bad. Returns a list of issues; empty = OK.
 */

export interface ValidationIssue {
	level: 'error' | 'warn';
	message: string;
	path?: string;
}

/** Allegro caps `images` at 16 per offer/product. */
export const ALLEGRO_MAX_IMAGES = 16;
/** Allegro caps `description.sections[*].items` at 2 per section. */
export const ALLEGRO_MAX_ITEMS_PER_SECTION = 2;
/** Conservative upper bound on description section count. */
export const ALLEGRO_MAX_SECTIONS = 25;
/** Allegro caps product name length. */
export const ALLEGRO_MAX_NAME_LENGTH = 75;

type Kind = 'offer' | 'product';

export function validateAllegroBody(
	body: Record<string, unknown>,
	kind: Kind,
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	// images
	const imgs = (body as { images?: unknown }).images;
	if (!Array.isArray(imgs)) {
		issues.push({
			level: 'error',
			message: '`images` отсутствует или не массив',
			path: 'images',
		});
	} else {
		if (imgs.length < 1) {
			issues.push({
				level: 'error',
				message: 'минимум 1 картинка обязательна',
				path: 'images',
			});
		}
		if (imgs.length > ALLEGRO_MAX_IMAGES) {
			issues.push({
				level: 'error',
				message: `${imgs.length} картинок > ${ALLEGRO_MAX_IMAGES} (лимит Allegro)`,
				path: 'images',
			});
		}

		// Shape: must be uniform; offer expects string[], product expects {url}[]
		const shapes = new Set<'string' | 'object' | 'other'>();
		for (const it of imgs) {
			if (typeof it === 'string') shapes.add('string');
			else if (
				it &&
				typeof it === 'object' &&
				typeof (it as { url?: unknown }).url === 'string'
			)
				shapes.add('object');
			else shapes.add('other');
		}
		if (shapes.has('other')) {
			issues.push({
				level: 'error',
				message: 'images содержит записи неправильного типа',
				path: 'images',
			});
		}
		if (shapes.size > 1) {
			issues.push({
				level: 'error',
				message: `images содержит смешанные типы: ${[...shapes].join(', ')} (Allegro JsonMappingException)`,
				path: 'images',
			});
		}
		if (kind === 'offer' && shapes.has('object') && shapes.size === 1) {
			issues.push({
				level: 'error',
				message:
					'POST /sale/product-offers ожидает images как string[], а тут {url}[]',
				path: 'images',
			});
		}
		if (kind === 'product' && shapes.has('string') && shapes.size === 1) {
			issues.push({
				level: 'error',
				message:
					'POST /sale/products ожидает images как {url}[], а тут string[]',
				path: 'images',
			});
		}
	}

	// Collect image URLs (for description cross-check)
	const imageUrls = new Set<string>();
	if (Array.isArray(imgs)) {
		for (const it of imgs) {
			const url =
				typeof it === 'string'
					? it
					: it &&
						  typeof it === 'object' &&
						  typeof (it as { url?: unknown }).url === 'string'
						? (it as { url: string }).url
						: undefined;
			if (url) imageUrls.add(url);
		}
	}

	// description
	const desc = (body as { description?: unknown }).description;
	if (desc) {
		const sections = (desc as { sections?: unknown }).sections;
		if (!Array.isArray(sections)) {
			issues.push({
				level: 'error',
				message: 'description.sections не массив',
				path: 'description.sections',
			});
		} else {
			if (sections.length > ALLEGRO_MAX_SECTIONS) {
				issues.push({
					level: 'error',
					message: `${sections.length} секц > ${ALLEGRO_MAX_SECTIONS}`,
					path: 'description.sections',
				});
			}
			sections.forEach((s, si) => {
				const items = (s as { items?: unknown }).items;
				if (!Array.isArray(items)) {
					issues.push({
						level: 'error',
						message: `section[${si}].items не массив`,
						path: `description.sections[${si}].items`,
					});
					return;
				}
				if (items.length < 1) {
					issues.push({
						level: 'error',
						message: `section[${si}] пустая`,
						path: `description.sections[${si}].items`,
					});
				}
				if (items.length > ALLEGRO_MAX_ITEMS_PER_SECTION) {
					issues.push({
						level: 'error',
						message: `section[${si}] имеет ${items.length} элементов > ${ALLEGRO_MAX_ITEMS_PER_SECTION}`,
						path: `description.sections[${si}].items`,
					});
				}
				items.forEach((it, ii) => {
					const type = (it as { type?: string }).type;
					if (type === 'IMAGE') {
						const url = (it as { url?: string }).url;
						if (typeof url !== 'string' || !url.trim()) {
							issues.push({
								level: 'error',
								message: `IMAGE item без url`,
								path: `description.sections[${si}].items[${ii}].url`,
							});
						} else if (!imageUrls.has(url)) {
							issues.push({
								level: 'error',
								message: `IMAGE url отсутствует в body.images (правило Allegro): ${url}`,
								path: `description.sections[${si}].items[${ii}].url`,
							});
						}
					} else if (type === 'TEXT') {
						const content = (it as { content?: string }).content;
						if (typeof content !== 'string') {
							issues.push({
								level: 'error',
								message: `TEXT item без content`,
								path: `description.sections[${si}].items[${ii}].content`,
							});
						}
					} else {
						issues.push({
							level: 'error',
							message: `item.type должен быть TEXT или IMAGE: ${type}`,
							path: `description.sections[${si}].items[${ii}].type`,
						});
					}
				});
			});
		}
	}

	// additionalMarketplaces: no .publication (read-only)
	const am = (
		body as {
			additionalMarketplaces?: Record<string, Record<string, unknown>>;
		}
	).additionalMarketplaces;
	if (am && typeof am === 'object') {
		for (const [mkpKey, mkp] of Object.entries(am)) {
			if (mkp && typeof mkp === 'object' && 'publication' in mkp) {
				issues.push({
					level: 'error',
					message: `additionalMarketplaces.${mkpKey}.publication — read-only поле, Allegro вернёт UnknownJSONProperty`,
					path: `additionalMarketplaces.${mkpKey}.publication`,
				});
			}
		}
	}

	// name (for product creation)
	if (kind === 'product') {
		const name = (body as { name?: unknown }).name;
		if (typeof name !== 'string' || !name.trim()) {
			issues.push({
				level: 'error',
				message: 'name пустой',
				path: 'name',
			});
		} else if (name.length > ALLEGRO_MAX_NAME_LENGTH) {
			issues.push({
				level: 'error',
				message: `name (${name.length} симв) > ${ALLEGRO_MAX_NAME_LENGTH}`,
				path: 'name',
			});
		}
	}

	return issues;
}
