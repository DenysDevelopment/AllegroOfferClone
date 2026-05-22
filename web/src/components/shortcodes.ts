import type { DescriptionSections, OfferParameter } from '../api';

/** Matches a `{{ key }}` token. The key may contain spaces but not braces. */
const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Attribute carrying the raw variable key on a chip span. */
const CHIP_ATTR = 'data-var-key';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Display value of an offer parameter: labels preferred, then raw values + unit. */
function paramValue(p: OfferParameter): string {
  const labels = (p.valuesLabels ?? []).filter(Boolean);
  if (labels.length) return labels.join(', ');
  const vals = (p.values ?? []).filter(Boolean);
  if (!vals.length) return '';
  const joined = vals.join(', ');
  return p.unit ? `${joined} ${p.unit}` : joined;
}

export interface VarMapInput {
  parameters: OfferParameter[];
  /** Parameter-name -> override value (overrides win over the source value). */
  overrides: Record<string, string>;
  title?: string;
  price?: string;
}

/**
 * Builds a key -> resolved-value map. Keys are parameter names plus the
 * built-ins `@title` and `@price`.
 */
export function buildVarMap(input: VarMapInput): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of input.parameters) {
    const name = (p.name ?? '').trim();
    if (!name) continue;
    map.set(name, paramValue(p));
  }
  for (const [name, value] of Object.entries(input.overrides)) {
    const k = name.trim();
    if (k && value.trim()) map.set(k, value.trim());
  }
  if (input.title != null) map.set('@title', input.title);
  if (input.price != null) map.set('@price', input.price);
  return map;
}

/** Chip HTML for a single key, using the current var map for the value. */
export function chipHtml(key: string, varMap: Map<string, string>): string {
  const value = varMap.get(key);
  const missing = value === undefined || value === '';
  const label = missing
    ? escapeHtml(key)
    : `${escapeHtml(key)} · ${escapeHtml(value)}`;
  const cls = missing ? 'var-chip var-chip--missing' : 'var-chip';
  return `<span class="${cls}" ${CHIP_ATTR}="${escapeHtml(key)}" contenteditable="false">${label}</span>`;
}

/** Replaces `{{key}}` tokens in an HTML string with chip spans. */
export function tokensToChipsHtml(
  html: string,
  varMap: Map<string, string>,
): string {
  return html.replace(TOKEN_RE, (_m, rawKey: string) =>
    chipHtml(rawKey.trim(), varMap),
  );
}

/** Replaces chip spans in an HTML string back with `{{key}}` tokens. */
export function chipsHtmlToTokens(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  for (const chip of Array.from(tmp.querySelectorAll(`[${CHIP_ATTR}]`))) {
    const key = chip.getAttribute(CHIP_ATTR) ?? '';
    chip.replaceWith(document.createTextNode(`{{${key}}}`));
  }
  return tmp.innerHTML;
}

export interface FlattenResult {
  sections: DescriptionSections;
  /** Keys of tokens that had no value and were left in place. */
  unresolved: string[];
}

/**
 * Replaces `{{key}}` tokens in every TEXT item with the escaped resolved value.
 * Unknown keys are left as literal tokens and reported in `unresolved`.
 */
export function flattenVars(
  description: DescriptionSections,
  varMap: Map<string, string>,
): FlattenResult {
  const unresolved = new Set<string>();
  const sections = {
    sections: description.sections.map((s) => ({
      items: s.items.map((it) => {
        if (it.type !== 'TEXT') return it;
        const content = it.content.replace(TOKEN_RE, (full, rawKey: string) => {
          const key = rawKey.trim();
          const value = varMap.get(key);
          if (value === undefined || value === '') {
            unresolved.add(key);
            return full;
          }
          return escapeHtml(value);
        });
        return { ...it, content };
      }),
    })),
  };
  return { sections, unresolved: [...unresolved] };
}
