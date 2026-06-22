import type { CategoryParameter, DescriptionSections, OfferParameter, ProductParameterValue } from '../api';

/** Matches a `{{ key }}` token. The key may contain spaces but not braces. */
const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Attribute carrying the raw variable key on a chip span. */
const CHIP_ATTR = 'data-var-key';

/** Recognises a photo-reference token key (1-based index). */
const PHOTO_KEY_RE = /^photo:(\d+)$/;

/** Matches a photo-ref URL exactly (`{{photo:N}}` with no surrounding text). */
const PHOTO_REF_URL_RE = /^\{\{photo:(\d+)\}\}$/;

/**
 * Returns `{ idx }` (1-based) if `s` is exactly a `{{photo:N}}` token,
 * otherwise `null`. Used to tell apart photo-ref IMAGE-items from real URLs.
 */
export function parsePhotoRefUrl(s: string): { idx: number } | null {
  const m = PHOTO_REF_URL_RE.exec(s);
  return m ? { idx: Number(m[1]) } : null;
}

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
  /** Parameter-name -> override values. A non-empty override wins over the
   *  source value; empty/blank values are ignored ("not overridden"). */
  overrides: Record<string, string[]>;
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
  for (const [name, values] of Object.entries(input.overrides)) {
    const k = name.trim();
    const joined = values.map((v) => v.trim()).filter(Boolean).join(', ');
    if (k && joined) map.set(k, joined);
  }
  if (input.title) map.set('@title', input.title);
  if (input.price) map.set('@price', input.price);
  return map;
}

/**
 * Builds a var map from the new-product category-parameter form: maps each
 * parameter's name to the operator's entered value. Dictionary value-ids are
 * resolved to their text via the parameter's own `dictionary`; the parameter
 * `unit` is appended when present.
 */
export function buildCategoryVarMap(
  params: CategoryParameter[],
  values: Record<string, ProductParameterValue>,
  opts?: { title?: string; price?: string },
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of params) {
    const name = (p.name ?? '').trim();
    if (!name) continue;
    const v = values[p.id];
    if (!v) continue;
    let resolved = '';
    if (v.valuesIds?.length) {
      resolved = v.valuesIds
        .map((id) => p.dictionary?.find((d) => d.id === id)?.value ?? '')
        .filter(Boolean)
        .join(', ');
    } else if (v.values?.length) {
      resolved = v.values.filter(Boolean).join(', ');
    }
    resolved = resolved.trim();
    if (!resolved) continue;
    map.set(name, p.unit ? `${resolved} ${p.unit}` : resolved);
  }
  if (opts?.title) map.set('@title', opts.title);
  if (opts?.price) map.set('@price', opts.price);
  return map;
}

/** Chip HTML for a single key, using the current var map / photo list. */
export function chipHtml(
  key: string,
  varMap: Map<string, string>,
  photoUrls: string[] = [],
): string {
  const photoMatch = PHOTO_KEY_RE.exec(key);
  if (photoMatch) {
    const n = Number(photoMatch[1]);
    const missing = n < 1 || n > photoUrls.length;
    const label = missing ? `Фото · ${n} · нет` : `Фото · ${n}`;
    const cls = missing ? 'var-chip var-chip--missing' : 'var-chip';
    return `<span class="${cls}" data-photo-idx="${n}" contenteditable="false">${escapeHtml(label)}</span>`;
  }
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
  photoUrls: string[] = [],
): string {
  return html.replace(TOKEN_RE, (_m, rawKey: string) =>
    chipHtml(rawKey.trim(), varMap, photoUrls),
  );
}

/** Replaces chip spans in an HTML string back with `{{key}}` tokens. */
export function chipsHtmlToTokens(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const chips = Array.from(
    tmp.querySelectorAll(`[${CHIP_ATTR}], [data-photo-idx]`),
  );
  if (chips.length === 0) return tmp.innerHTML;
  // Swap each chip for an alphanumeric marker, then substitute the real
  // `{{key}}` tokens AFTER serialization — keeps keys containing & < > "
  // intact and avoids any HTML re-escaping pitfalls.
  const keys: string[] = [];
  const marker = `vartok${Math.random().toString(36).slice(2)}`;
  for (const chip of chips) {
    const photoIdx = chip.getAttribute('data-photo-idx');
    const key =
      photoIdx !== null
        ? `photo:${photoIdx}`
        : (chip.getAttribute(CHIP_ATTR) ?? '');
    keys.push(key);
    chip.replaceWith(document.createTextNode(`${marker}${keys.length - 1}end`));
  }
  return tmp.innerHTML.replace(
    new RegExp(`${marker}(\\d+)end`, 'g'),
    (_m, i) => `{{${keys[Number(i)]}}}`,
  );
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

/** Matches a `{{photo:N}}` token (1-based index). */
const PHOTO_TOKEN_RE = /\{\{\s*photo:(\d+)\s*\}\}/g;

/**
 * Replaces `{{photo:N}}` tokens in every TEXT item with real IMAGE items,
 * resolving N to `photoUrls[N-1]` (1-based). Out-of-range tokens are left
 * literal in the TEXT and their keys are reported in `unresolved`.
 */
export function expandPhotoChips(
  description: DescriptionSections,
  photoUrls: string[],
): { sections: DescriptionSections; unresolved: string[] } {
  const unresolved = new Set<string>();
  const sections = {
    sections: description.sections.map((s) => {
      const items: typeof s.items = [];
      for (const it of s.items) {
        if (it.type === 'IMAGE') {
          const ref = parsePhotoRefUrl(it.url);
          if (ref === null) {
            items.push(it);
          } else if (ref.idx >= 1 && ref.idx <= photoUrls.length) {
            items.push({ type: 'IMAGE', url: photoUrls[ref.idx - 1] });
          } else {
            unresolved.add(`photo:${ref.idx}`);
            // Dropped: Allegro would reject the literal token URL.
          }
          continue;
        }
        const text = it.content;
        const re = new RegExp(PHOTO_TOKEN_RE.source, 'g');
        let lastIdx = 0;
        let cursor = '';
        let split = false;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const n = Number(m[1]);
          const url = n >= 1 && n <= photoUrls.length ? photoUrls[n - 1] : null;
          cursor += text.slice(lastIdx, m.index);
          if (url) {
            split = true;
            if (cursor) items.push({ type: 'TEXT', content: cursor });
            cursor = '';
            items.push({ type: 'IMAGE', url });
          } else {
            unresolved.add(`photo:${n}`);
            cursor += m[0];
          }
          lastIdx = re.lastIndex;
        }
        cursor += text.slice(lastIdx);
        if (!split) {
          items.push(it);
        } else if (cursor) {
          items.push({ type: 'TEXT', content: cursor });
        }
      }
      return { items };
    }),
  };
  return { sections, unresolved: [...unresolved] };
}
