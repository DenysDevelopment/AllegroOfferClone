import type { DescriptionSections } from '../api';

// Allegro standardized description tag whitelist.
// Allegro rejects `<strong>` ("Błędny tag strong, dozwolone są: {b}") — only
// `<b>` is permitted for bold. Block tags Allegro accepts: h1, h2, p, ul, ol
// (+ `li` inside lists). Everything else is unwrapped (children bubble up).
//
// CRITICAL: a single TEXT item must NOT carry raw line breaks. Paste from Word /
// PDFs / other listings drops the whole multi-line blob into ONE `<p>` with
// `\n`, U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) between lines.
// Allegro then mangles that on its side (it splits/strips on those characters
// and silently loses chunks — that was the "opis ucina się w połowie / brakuje
// linii" bug). So we turn every soft break — `<br>`, blank line, `\n`, U+2028,
// U+2029 — into a real, separate `<p>`, exactly like Allegro's own web editor.
const ALLEGRO_INLINE_TAGS = new Set(['b']);
// Block-level wrappers we don't keep but that DO mark a paragraph boundary:
// their content is re-flowed into fresh `<p>` (children, not the wrapper).
const BLOCK_WRAPPER_TAGS = new Set([
	'div', 'section', 'article', 'header', 'footer', 'main', 'aside',
	'blockquote', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot',
	'tr', 'td', 'th', 'dl', 'dt', 'dd', 'nav', 'form', 'fieldset', 'pre',
]);

// Any run of newline / Unicode line+paragraph separators === one paragraph break.
const PARA_BREAK_RE = /[\r\n\u2028\u2029]+/;
const PARA_BREAK_RE_G = /[\r\n\u2028\u2029]+/g;
// Whitespace incl. non-breaking space (U+00A0). JS `\s` already covers U+00A0,
// U+2028 and U+2029, but we spell U+00A0 out for clarity.
const isBlankText = (s: string): boolean => s.replace(/[\s\u00a0]/g, '') === '';
const trimLead = (s: string): string => s.replace(/^[\s\u00a0]+/, '');
const trimTail = (s: string): string => s.replace(/[\s\u00a0]+$/, '');

export function sanitizeAllegroHtml(html: string): string {
	if (!html.trim()) return '';
	const doc = new DOMParser().parseFromString(
		`<!doctype html><html><body>${html}</body></html>`,
		'text/html',
	);

	const out: Element[] = []; // finished block elements, in order
	let inline: Node[] = []; // pending inline nodes for the current <p>

	// Drop blank leading/trailing text nodes, then trim the outer whitespace of
	// the first/last text node. Returns the cleaned list (mutates text content).
	const cleanEnds = (nodes: Node[]): Node[] => {
		const arr = nodes.slice();
		const blank = (n: Node) =>
			n.nodeType === Node.TEXT_NODE && isBlankText(n.textContent ?? '');
		while (arr.length && blank(arr[0])) arr.shift();
		while (arr.length && blank(arr[arr.length - 1])) arr.pop();
		const first = arr[0];
		if (first && first.nodeType === Node.TEXT_NODE)
			first.textContent = trimLead(first.textContent ?? '');
		const last = arr[arr.length - 1];
		if (last && last.nodeType === Node.TEXT_NODE)
			last.textContent = trimTail(last.textContent ?? '');
		return arr;
	};

	const hasContent = (nodes: Node[]): boolean =>
		nodes.some(
			n =>
				n.nodeType === Node.ELEMENT_NODE ||
				(n.nodeType === Node.TEXT_NODE && !isBlankText(n.textContent ?? '')),
		);

	// Emit the current inline buffer as a `<p>` (dropping it if blank).
	const flushParagraph = () => {
		const nodes = cleanEnds(inline);
		inline = [];
		if (!hasContent(nodes)) return;
		const p = doc.createElement('p');
		for (const n of nodes) p.appendChild(n);
		out.push(p);
	};

	// Inline-context build: keep `<b>` (and `<strong>`→`<b>`), unwrap everything
	// else, collapse paragraph-break chars to a single space (an inline run can't
	// span paragraphs in Allegro's model — that's what `<p>` boundaries are for).
	const buildInline = (el: Element): Node[] => {
		const tag = el.tagName.toLowerCase();
		if (tag === 'br') return [doc.createTextNode(' ')];
		const finalTag = tag === 'strong' ? 'b' : tag;
		const children: Node[] = [];
		for (const child of Array.from(el.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE) {
				children.push(
					doc.createTextNode((child.textContent ?? '').replace(PARA_BREAK_RE_G, ' ')),
				);
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				children.push(...buildInline(child as Element));
			}
		}
		if (ALLEGRO_INLINE_TAGS.has(finalTag)) {
			const fresh = doc.createElement(finalTag);
			for (const c of children) fresh.appendChild(c);
			return [fresh];
		}
		return children; // unwrap unknown inline (em, span, i, u, a, font…)
	};

	// Inline content of a block (heading / list item): same rules as buildInline
	// but operating on the element's children rather than wrapping the element.
	const buildInlineChildren = (el: Element): Node[] => {
		const res: Node[] = [];
		for (const child of Array.from(el.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE) {
				res.push(
					doc.createTextNode((child.textContent ?? '').replace(PARA_BREAK_RE_G, ' ')),
				);
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				res.push(...buildInline(child as Element));
			}
		}
		return res;
	};

	// Push text into the current paragraph, splitting on every paragraph break.
	const pushText = (raw: string) => {
		if (raw === '') return;
		const parts = raw.split(PARA_BREAK_RE);
		for (let i = 0; i < parts.length; i++) {
			if (parts[i] !== '') inline.push(doc.createTextNode(parts[i]));
			if (i < parts.length - 1) flushParagraph();
		}
	};

	const processBlock = (el: Element) => {
		const tag = el.tagName.toLowerCase();
		if (tag === 'h1' || tag === 'h2') {
			flushParagraph();
			const kids = cleanEnds(buildInlineChildren(el));
			if (hasContent(kids)) {
				const h = doc.createElement(tag);
				for (const k of kids) h.appendChild(k);
				out.push(h);
			}
			return;
		}
		if (tag === 'ul' || tag === 'ol') {
			flushParagraph();
			const list = doc.createElement(tag);
			for (const child of Array.from(el.children)) {
				if (child.tagName.toLowerCase() !== 'li') continue;
				const kids = cleanEnds(buildInlineChildren(child));
				if (!hasContent(kids)) continue;
				const li = doc.createElement('li');
				for (const k of kids) li.appendChild(k);
				list.appendChild(li);
			}
			if (list.children.length) out.push(list);
			return;
		}
		// <p>, <div> and generic block wrappers: paragraph boundary, then re-flow
		// the children (which re-paragraphs any internal breaks into fresh <p>).
		flushParagraph();
		for (const child of Array.from(el.childNodes)) processNode(child);
		flushParagraph();
	};

	function processNode(node: Node) {
		if (node.nodeType === Node.TEXT_NODE) {
			pushText(node.textContent ?? '');
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return;
		const el = node as Element;
		const tag = el.tagName.toLowerCase();
		if (tag === 'br') {
			flushParagraph();
			return;
		}
		if (
			tag === 'p' ||
			tag === 'h1' ||
			tag === 'h2' ||
			tag === 'ul' ||
			tag === 'ol' ||
			BLOCK_WRAPPER_TAGS.has(tag)
		) {
			processBlock(el);
			return;
		}
		const finalTag = tag === 'strong' ? 'b' : tag;
		if (ALLEGRO_INLINE_TAGS.has(finalTag)) {
			for (const n of buildInline(el)) inline.push(n);
			return;
		}
		if (tag === 'li') {
			// Stray <li> outside a list — treat it as its own paragraph.
			flushParagraph();
			for (const child of Array.from(el.childNodes)) processNode(child);
			flushParagraph();
			return;
		}
		// Unknown inline wrapper (span, em, i, u, a, font, small…): unwrap.
		for (const child of Array.from(el.childNodes)) processNode(child);
	}

	for (const child of Array.from(doc.body.childNodes)) processNode(child);
	flushParagraph();

	const container = doc.createElement('div');
	for (const el of out) container.appendChild(el);
	// Safety net: strip any paragraph that serialized to whitespace/nbsp only.
	return container.innerHTML.replace(/<p>(?:&nbsp;|\s)*<\/p>/g, '').trim();
}

/**
 * Sanitize a description's TEXT items for Allegro and pass IMAGE items through
 * UNCHANGED (raw source URLs). Drops empty TEXT pieces and empty sections.
 *
 * Used by the CLONE flow: the server re-hosts description images itself
 * (reuploadDescriptionImages) and dedupes them against the gallery by matching
 * the SOURCE url. If we re-uploaded here first, those urls would change and the
 * server's gallery-dedup could no longer match — leaving the same photo in the
 * gallery twice. So clone keeps the source urls and lets the server do the
 * single re-host. (Create-product still uses finalizeDescriptionForAllegro,
 * which re-uploads, because there is no server-side re-host on that path.)
 */
export function sanitizeDescriptionForAllegro(
	sections: DescriptionSections,
): DescriptionSections {
	const out: DescriptionSections['sections'] = [];
	for (const s of sections.sections) {
		const items: typeof s.items = [];
		for (const it of s.items) {
			if (it.type === 'TEXT') {
				const cleaned = sanitizeAllegroHtml(it.content);
				if (cleaned.trim()) items.push({ type: 'TEXT', content: cleaned });
			} else {
				const trimmed = it.url.trim();
				if (trimmed) items.push({ type: 'IMAGE', url: trimmed });
			}
		}
		if (items.length > 0) out.push({ items });
	}
	return { sections: out };
}

/**
 * Prepare a description for Allegro: sanitize TEXT-item HTML, re-upload each
 * IMAGE-item URL via `uploadByUrl` so the resulting URLs are "attached" to
 * the new offer/proposal (Allegro otherwise rejects with
 * `ConstraintViolationException.DescriptionImageNotAttached`). Drops empty
 * TEXT pieces and empty sections.
 */
export async function finalizeDescriptionForAllegro(
	sections: DescriptionSections,
	uploadByUrl: (url: string) => Promise<{ location: string }>,
): Promise<DescriptionSections> {
	const out: DescriptionSections['sections'] = [];
	for (const s of sections.sections) {
		const items: typeof s.items = [];
		for (const it of s.items) {
			if (it.type === 'TEXT') {
				const cleaned = sanitizeAllegroHtml(it.content);
				if (cleaned.trim()) items.push({ type: 'TEXT', content: cleaned });
			} else {
				const trimmed = it.url.trim();
				if (!trimmed) continue;
				try {
					const r = await uploadByUrl(trimmed);
					items.push({ type: 'IMAGE', url: r.location });
				} catch (err) {
					throw new Error(
						`Не удалось перезалить картинку описания (${trimmed}): ${
							(err as Error).message
						}`,
					);
				}
			}
		}
		if (items.length > 0) out.push({ items });
	}
	return { sections: out };
}
