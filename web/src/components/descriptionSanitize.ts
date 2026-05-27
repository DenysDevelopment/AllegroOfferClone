import type { DescriptionSections } from '../api';

// Allegro standardized description tag whitelist.
// Allegro rejects `<strong>` ("Błędny tag strong, dozwolone są: {b}") — only
// `<b>` is permitted for bold. `<br>` becomes a paragraph split. Anything else
// is unwrapped (children bubble up). Raw text at the top level is wrapped in
// `<p>` since Allegro rejects bare text between blocks.
const ALLEGRO_BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'ul', 'ol']);
const ALLEGRO_INLINE_TAGS = new Set(['b']);
const ALLEGRO_LIST_CHILD_TAG = 'li';

export function sanitizeAllegroHtml(html: string): string {
	if (!html.trim()) return '';
	const doc = new DOMParser().parseFromString(
		`<!doctype html><html><body>${html}</body></html>`,
		'text/html',
	);
	const out: Node[] = [];
	let inlineBuffer: Node[] = [];

	const flushInline = () => {
		const hasContent = inlineBuffer.some(
			n =>
				(n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim()) ||
				n.nodeType === Node.ELEMENT_NODE,
		);
		if (hasContent) {
			const p = doc.createElement('p');
			for (const n of inlineBuffer) p.appendChild(n);
			out.push(p);
		}
		inlineBuffer = [];
	};

	const rebuild = (el: Element): Node[] => {
		const tag = el.tagName.toLowerCase();
		// <br> turns into paragraph break — render as marker; outer logic flushes <p>.
		if (tag === 'br') return [doc.createTextNode('\n\n')];
		// <strong> → <b> (Allegro only allows <b>).
		const finalTag = tag === 'strong' ? 'b' : tag;
		const isAllowed =
			ALLEGRO_BLOCK_TAGS.has(finalTag) ||
			ALLEGRO_INLINE_TAGS.has(finalTag) ||
			finalTag === ALLEGRO_LIST_CHILD_TAG;
		const childNodes: Node[] = [];
		for (const child of Array.from(el.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE) {
				childNodes.push(doc.createTextNode(child.textContent ?? ''));
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				childNodes.push(...rebuild(child as Element));
			}
		}
		if (!isAllowed) {
			// unwrap: bubble children up
			return childNodes;
		}
		const fresh = doc.createElement(finalTag);
		for (const c of childNodes) fresh.appendChild(c);
		return [fresh];
	};

	for (const child of Array.from(doc.body.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			const t = child.textContent ?? '';
			if (t.includes('\n\n')) {
				const parts = t.split(/\n\n+/);
				for (let i = 0; i < parts.length; i++) {
					if (parts[i]) inlineBuffer.push(doc.createTextNode(parts[i]));
					if (i < parts.length - 1) flushInline();
				}
			} else if (t.trim()) {
				inlineBuffer.push(doc.createTextNode(t));
			}
		} else if (child.nodeType === Node.ELEMENT_NODE) {
			const built = rebuild(child as Element);
			for (const n of built) {
				if (n.nodeType === Node.TEXT_NODE) {
					inlineBuffer.push(n);
				} else if (
					n.nodeType === Node.ELEMENT_NODE &&
					ALLEGRO_BLOCK_TAGS.has((n as Element).tagName.toLowerCase())
				) {
					flushInline();
					out.push(n);
				} else {
					inlineBuffer.push(n);
				}
			}
		}
	}
	flushInline();

	const container = doc.createElement('div');
	for (const n of out) container.appendChild(n);
	// Drop empty <p></p>
	return container.innerHTML.replace(/<p>\s*<\/p>/g, '').trim();
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
