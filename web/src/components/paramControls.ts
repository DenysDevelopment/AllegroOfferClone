import type { CategoryParameter, OfferParameter } from '../api';

export type ControlKind = 'dict-single' | 'dict-multi' | 'number' | 'range' | 'text';

/** Above this many dictionary entries, prefer a <select> over a radio group. */
export const SELECT_THRESHOLD = 6;

export function controlKind(p: CategoryParameter): ControlKind {
	const r = (p.restrictions ?? {}) as { multipleChoices?: boolean; range?: boolean };
	if (p.type === 'dictionary') return r.multipleChoices ? 'dict-multi' : 'dict-single';
	if (p.type === 'integer' || p.type === 'float') return r.range ? 'range' : 'number';
	return 'text';
}

export function useSelectForDictionary(p: CategoryParameter): boolean {
	return (p.dictionary?.length ?? 0) > SELECT_THRESHOLD;
}

export function allowsCustomValue(p: CategoryParameter): boolean {
	const o = (p.options ?? {}) as {
		customValuesEnabled?: boolean;
		ambiguousValueId?: string | null;
	};
	return p.type === 'dictionary' && !!o.customValuesEnabled && !!o.ambiguousValueId;
}

export function findOfferParam(
	cat: CategoryParameter,
	offerParams: OfferParameter[],
): OfferParameter | undefined {
	return offerParams.find(
		op =>
			op.id === cat.id ||
			(!!cat.name && op.name?.toLowerCase() === cat.name.toLowerCase()),
	);
}

/** Current values of an offer parameter: dictionary labels first, else raw values. */
export function offerParamCurrentValues(op: OfferParameter | undefined): string[] {
	if (!op) return [];
	const labels = (op.valuesLabels ?? []).filter(Boolean) as string[];
	if (labels.length) return labels;
	return (op.values ?? []).filter(Boolean) as string[];
}

/** Working-value seed keyed by parameter name, from the source offer's parameters. */
export function seedParamValues(
	categoryParameters: CategoryParameter[],
	offerParameters: OfferParameter[],
): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	for (const cat of categoryParameters) {
		const name = (cat.name ?? '').trim();
		if (!name) continue;
		out[name] = offerParamCurrentValues(findOfferParam(cat, offerParameters));
	}
	return out;
}

function sameValues(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	const sb = new Set(b);
	return a.every(v => sb.has(v));
}

/** Returns only the parameters whose working value differs from the seed. */
export function diffOverrides(
	working: Record<string, string[]>,
	seed: Record<string, string[]>,
): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	for (const [name, values] of Object.entries(working)) {
		const cleaned = values.map(v => v.trim()).filter(Boolean);
		if (cleaned.length === 0) continue; // emptied = not an override
		const base = (seed[name] ?? []).map(v => v.trim()).filter(Boolean);
		if (!sameValues(cleaned, base)) out[name] = cleaned;
	}
	return out;
}
