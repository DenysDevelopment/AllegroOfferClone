import type { DescriptionItem } from '../api';

/** The five row layouts Allegro allows for a description section. */
export type Layout =
	| 'text'
	| 'image'
	| 'text-image'
	| 'image-text'
	| 'image-image';

/** Ordered list for UI (add-row buttons + per-row selector). */
export const LAYOUTS: { value: Layout; label: string }[] = [
	{ value: 'text', label: 'Только текст' },
	{ value: 'image', label: 'Только фото' },
	{ value: 'text-image', label: 'Текст + фото' },
	{ value: 'image-text', label: 'Фото + текст' },
	{ value: 'image-image', label: 'Два фото' },
];

/** Item-type sequence each layout expects. */
const LAYOUT_SHAPE: Record<Layout, Array<'TEXT' | 'IMAGE'>> = {
	text: ['TEXT'],
	image: ['IMAGE'],
	'text-image': ['TEXT', 'IMAGE'],
	'image-text': ['IMAGE', 'TEXT'],
	'image-image': ['IMAGE', 'IMAGE'],
};

/**
 * Detect a section's layout from its items. Single item → text/image.
 * Two items → the matching pair. Anything else (empty, or the illegal
 * [TEXT,TEXT]) falls back to 'text' so legacy data still renders and the
 * selector self-heals when the operator changes it.
 */
export function detectLayout(items: DescriptionItem[]): Layout {
	if (items.length >= 2) {
		const a = items[0].type;
		const b = items[1].type;
		if (a === 'TEXT' && b === 'IMAGE') return 'text-image';
		if (a === 'IMAGE' && b === 'TEXT') return 'image-text';
		if (a === 'IMAGE' && b === 'IMAGE') return 'image-image';
		return a === 'IMAGE' ? 'image' : 'text';
	}
	if (items.length === 1) return items[0].type === 'IMAGE' ? 'image' : 'text';
	return 'text';
}

/**
 * Reshape `items` to match `layout`, preserving content by type: existing
 * TEXT contents and IMAGE urls are pulled (in order) into the new slots of
 * the same type; missing slots become empty items; extras are dropped.
 */
export function relayoutSection(
	items: DescriptionItem[],
	layout: Layout,
): DescriptionItem[] {
	const texts = items.filter(
		(i): i is Extract<DescriptionItem, { type: 'TEXT' }> => i.type === 'TEXT',
	);
	const images = items.filter(
		(i): i is Extract<DescriptionItem, { type: 'IMAGE' }> => i.type === 'IMAGE',
	);
	let ti = 0;
	let ii = 0;
	return LAYOUT_SHAPE[layout].map<DescriptionItem>(t =>
		t === 'TEXT'
			? { type: 'TEXT', content: texts[ti++]?.content ?? '' }
			: { type: 'IMAGE', url: images[ii++]?.url ?? '' },
	);
}
