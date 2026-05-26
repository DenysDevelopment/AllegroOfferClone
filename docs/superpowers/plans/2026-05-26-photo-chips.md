# Photo Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- []`) syntax for tracking.

**Goal:** Add positional photo references (`{{photo:N}}`) to description text — rendered as non-editable chips in the editor, expanded into real IMAGE items at publish time using the offer's image list.

**Architecture:** Extend the existing variable-chip pipeline (`shortcodes.ts`) with a second chip kind discriminated by a `photo:` prefix in the token key. Add a "+ Фото" picker to the description toolbar, thread the offer's image list through `DescriptionEditor` → `RichTextarea`, and run a new pure `expandPhotoChips` pass after `flattenVars` when building each offer/product payload.

**Tech Stack:** TypeScript, React 18 + Vite (web), Tailwind, vitest (web tests).

Spec: `docs/superpowers/specs/2026-05-26-photo-chips-design.md`

---

## File Structure

**Modified:**
- `web/src/components/shortcodes.ts` — extend `chipHtml`/`tokensToChipsHtml`/`chipsHtmlToTokens` to handle photo tokens; add `expandPhotoChips`.
- `web/src/components/shortcodes.test.ts` — tests for the new behavior.
- `web/src/components/DescriptionEditor.tsx` — `photoUrls?` prop, "+ Фото" picker in `RichTextarea`.
- `web/src/App.tsx` — pass `imageUrls` to `DescriptionEditor`, run `expandPhotoChips` in the clone payload.
- `web/src/components/NewProductPanel.tsx` — pass `images` to `DescriptionEditor`, run `expandPhotoChips` in `buildPayload`.

---

## Task 1: shortcode utilities — photo chip support + `expandPhotoChips`

**Files:**
- Modify: `web/src/components/shortcodes.ts`
- Test: `web/src/components/shortcodes.test.ts`

- [ ] **Step 1: Write the failing tests**

In `web/src/components/shortcodes.test.ts`, add `expandPhotoChips` to the existing `./shortcodes` import. Then append these blocks at the end of the file (after the existing `describe` blocks, before the final newline):

```ts
describe('chipHtml — photo variant', () => {
  it('renders a photo chip with `Фото · N`', () => {
    const html = chipHtml('photo:1', new Map(), ['http://x/a.jpg']);
    expect(html).toContain('data-photo-idx="1"');
    expect(html).toContain('Фото · 1');
    expect(html).toContain('contenteditable="false"');
    expect(html).not.toContain('var-chip--missing');
  });

  it('marks a photo chip as missing when N is out of range', () => {
    const html = chipHtml('photo:5', new Map(), ['http://x/a.jpg']);
    expect(html).toContain('var-chip--missing');
    expect(html).toContain('Фото · 5 · нет');
  });

  it('does not put a data-var-key on a photo chip', () => {
    const html = chipHtml('photo:2', new Map(), ['a', 'b']);
    expect(html).not.toContain('data-var-key');
  });
});

describe('tokensToChipsHtml — photo tokens', () => {
  it('renders {{photo:N}} as a photo chip', () => {
    const html = tokensToChipsHtml('A {{photo:1}} B', new Map(), [
      'http://x/a.jpg',
    ]);
    expect(html).toContain('data-photo-idx="1"');
    expect(html).toContain('Фото · 1');
  });

  it('keeps variable tokens working alongside photo tokens', () => {
    const html = tokensToChipsHtml(
      '{{SSD}} and {{photo:1}}',
      new Map([['SSD', '512 GB']]),
      ['http://x/a.jpg'],
    );
    expect(html).toContain('data-var-key="SSD"');
    expect(html).toContain('SSD · 512 GB');
    expect(html).toContain('data-photo-idx="1"');
  });
});

describe('chipsHtmlToTokens — photo chips', () => {
  it('round-trips a photo chip', () => {
    const chips = tokensToChipsHtml('{{photo:3}}', new Map(), [
      'a',
      'b',
      'c',
    ]);
    expect(chipsHtmlToTokens(chips)).toBe('{{photo:3}}');
  });

  it('round-trips a mix of variable and photo chips', () => {
    const chips = tokensToChipsHtml(
      'X {{SSD}} Y {{photo:2}} Z',
      new Map([['SSD', '512 GB']]),
      ['a', 'b'],
    );
    expect(chipsHtmlToTokens(chips)).toBe('X {{SSD}} Y {{photo:2}} Z');
  });
});

describe('expandPhotoChips', () => {
  it('splits a TEXT item around a resolved photo token', () => {
    const r = expandPhotoChips(
      { sections: [{ items: [{ type: 'TEXT', content: 'A {{photo:1}} B' }] }] },
      ['http://x/a.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'TEXT', content: 'A ' },
      { type: 'IMAGE', url: 'http://x/a.jpg' },
      { type: 'TEXT', content: ' B' },
    ]);
    expect(r.unresolved).toEqual([]);
  });

  it('handles multiple photo tokens in one TEXT item', () => {
    const r = expandPhotoChips(
      {
        sections: [
          { items: [{ type: 'TEXT', content: '{{photo:1}}{{photo:2}} tail' }] },
        ],
      },
      ['http://x/a.jpg', 'http://x/b.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'IMAGE', url: 'http://x/a.jpg' },
      { type: 'IMAGE', url: 'http://x/b.jpg' },
      { type: 'TEXT', content: ' tail' },
    ]);
  });

  it('drops empty TEXT pieces when chips are at the edges', () => {
    const r = expandPhotoChips(
      { sections: [{ items: [{ type: 'TEXT', content: '{{photo:1}}' }] }] },
      ['http://x/a.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'IMAGE', url: 'http://x/a.jpg' },
    ]);
  });

  it('leaves an out-of-range token in the TEXT and reports it', () => {
    const r = expandPhotoChips(
      { sections: [{ items: [{ type: 'TEXT', content: 'A {{photo:7}} B' }] }] },
      ['http://x/a.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'TEXT', content: 'A {{photo:7}} B' },
    ]);
    expect(r.unresolved).toEqual(['photo:7']);
  });

  it('preserves an IMAGE item untouched', () => {
    const r = expandPhotoChips(
      { sections: [{ items: [{ type: 'IMAGE', url: 'http://x/y.jpg' }] }] },
      [],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'IMAGE', url: 'http://x/y.jpg' },
    ]);
  });

  it('returns the original TEXT item when it has no photo tokens', () => {
    const original = {
      sections: [{ items: [{ type: 'TEXT' as const, content: 'plain text' }] }],
    };
    const r = expandPhotoChips(original, ['a']);
    expect(r.sections.sections[0].items[0]).toEqual({
      type: 'TEXT',
      content: 'plain text',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w web -- shortcodes`
Expected: FAIL — `expandPhotoChips` is not exported; `chipHtml`/`tokensToChipsHtml` don't accept a `photoUrls` third argument yet.

- [ ] **Step 3: Update `chipHtml`, `tokensToChipsHtml`, `chipsHtmlToTokens`, add `expandPhotoChips`**

In `web/src/components/shortcodes.ts`, add a photo-key regex below `CHIP_ATTR` (around line 7):

```ts
/** Recognises a photo-reference token key (1-based index). */
const PHOTO_KEY_RE = /^photo:(\d+)$/;
```

Replace the existing `chipHtml` function (lines ~89–97) with:

```ts
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
```

Replace `tokensToChipsHtml` with the photo-aware version:

```ts
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
```

Replace `chipsHtmlToTokens` so it picks up both chip-kinds:

```ts
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
```

Add `expandPhotoChips` to the end of the file (after `flattenVars`):

```ts
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
        if (it.type !== 'TEXT') {
          items.push(it);
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w web -- shortcodes`
Expected: PASS — all existing tests + the new ones (~13 new) pass.

- [ ] **Step 5: Verify the full build**

Run: `npm run build -w web`
Expected: clean build, zero TypeScript errors. (Existing `chipHtml` / `tokensToChipsHtml` callers pass two args; the added third arg is optional, so they keep compiling.)

- [ ] **Step 6: Commit**

```bash
git add web/src/components/shortcodes.ts web/src/components/shortcodes.test.ts
git commit -m "feat: photo chip support + expandPhotoChips in shortcodes"
```

---

## Task 2: "+ Фото" picker in `RichTextarea`

**Files:**
- Modify: `web/src/components/DescriptionEditor.tsx`

This task adds an optional `photoUrls` prop on `DescriptionEditor`, threads it to `RichTextarea`, and adds a second toolbar dropdown (the photo picker) right next to "+ Переменная". The varMap chip-refresh effect is generalised to also refresh photo chips when `photoUrls` changes.

- [ ] **Step 1: Extend `DescriptionEditor` Props**

In `web/src/components/DescriptionEditor.tsx`, in the `Props` interface, add (next to `varMap?`):

```ts
	/** Current offer photos (CDN URLs). Optional — used by the «+ Фото»
	 *  picker and by chip rendering so `{{photo:N}}` chips show the
	 *  right missing/ok state live as the photo list changes. */
	photoUrls?: string[];
```

Add a stable module-level empty array near `EMPTY_VAR_MAP`:

```ts
/** Stable empty photo list — default for consumers without photos. */
const EMPTY_PHOTO_URLS: string[] = [];
```

In the function destructuring (where `varMap = EMPTY_VAR_MAP` is), add:

```ts
	photoUrls = EMPTY_PHOTO_URLS,
```

- [ ] **Step 2: Pass `photoUrls` to each `<RichTextarea>`**

Find the `<RichTextarea ... />` call inside `DescriptionEditor` and add the prop:

```tsx
									<RichTextarea
										value={it.content}
										onChange={v => updateItem(sIdx, iIdx, { content: v })}
										varMap={varMap}
										photoUrls={photoUrls}
									/>
```

- [ ] **Step 3: Add `photoUrls` to `RichTextarea`'s prop type**

Change `RichTextarea`'s prop type from:

```ts
}: {
	value: string;
	onChange: (next: string) => void;
	varMap: Map<string, string>;
}) {
```

to:

```ts
}: {
	value: string;
	onChange: (next: string) => void;
	varMap: Map<string, string>;
	photoUrls: string[];
}) {
```

- [ ] **Step 4: Thread `photoUrls` through `RichTextarea`'s effects and helpers**

Inside `RichTextarea`, every call to `chipHtml(...)` or `tokensToChipsHtml(...)` must pass `photoUrls` as the third argument. The current calls are in:

a) The mount effect — change `el.innerHTML = tokensToChipsHtml(value, varMap)` to:

```ts
		ref.current.innerHTML = tokensToChipsHtml(value, varMap, photoUrls);
```

b) The external-value effect — change `el.innerHTML = tokensToChipsHtml(value, varMap)` to:

```ts
			el.innerHTML = tokensToChipsHtml(value, varMap, photoUrls);
```

…and extend the effect's dependency array from `[value, varMap]` to `[value, varMap, photoUrls]`.

c) The chip-refresh effect — find:

```ts
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		for (const chip of Array.from(el.querySelectorAll('[data-var-key]'))) {
			const key = chip.getAttribute('data-var-key') ?? '';
			const tmp = document.createElement('div');
			tmp.innerHTML = chipHtml(key, varMap);
			...
		}
	}, [varMap]);
```

and replace it with a version that walks BOTH chip kinds and uses the photo-aware `chipHtml`:

```ts
	// varMap or photoUrls changed: refresh chip labels in place without
	// rewriting innerHTML, so the caret is not disturbed.
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		for (const chip of Array.from(
			el.querySelectorAll('[data-var-key], [data-photo-idx]'),
		)) {
			const photoIdx = chip.getAttribute('data-photo-idx');
			const key =
				photoIdx !== null
					? `photo:${photoIdx}`
					: (chip.getAttribute('data-var-key') ?? '');
			const tmp = document.createElement('div');
			tmp.innerHTML = chipHtml(key, varMap, photoUrls);
			const fresh = tmp.firstElementChild;
			if (fresh) {
				chip.className = fresh.className;
				chip.textContent = fresh.textContent;
			}
		}
	}, [varMap, photoUrls]);
```

d) `emitAndRenderChips` — change `el.innerHTML = tokensToChipsHtml(tokenHtml, varMap)` to:

```ts
		el.innerHTML = tokensToChipsHtml(tokenHtml, varMap, photoUrls);
```

e) `insertVariable` — change `chipHtml(key, varMap)` to `chipHtml(key, varMap, photoUrls)`:

```ts
			document.execCommand(
				'insertHTML',
				false,
				chipHtml(key, varMap, photoUrls) + '&nbsp;',
			);
```

- [ ] **Step 5: Add the photo picker state + close-on-outside-click**

Inside `RichTextarea`, alongside the existing `varMenuOpen` state and `pickerRef`, add:

```ts
	const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
	const photoPickerRef = useRef<HTMLDivElement | null>(null);
```

Add a sibling click-outside effect for the photo picker (place it right after the existing var-picker outside-click effect):

```ts
	// Close the photo picker when clicking outside it.
	useEffect(() => {
		if (!photoMenuOpen) return;
		const onDocMouseDown = (e: MouseEvent) => {
			if (!photoPickerRef.current?.contains(e.target as Node)) {
				setPhotoMenuOpen(false);
			}
		};
		document.addEventListener('mousedown', onDocMouseDown);
		return () => document.removeEventListener('mousedown', onDocMouseDown);
	}, [photoMenuOpen]);
```

- [ ] **Step 6: Add an `insertPhoto` helper**

Inside `RichTextarea`, next to `insertVariable`, add:

```ts
	const insertPhoto = (n: number) => {
		const el = ref.current;
		if (!el) return;
		el.focus();
		try {
			document.execCommand(
				'insertHTML',
				false,
				chipHtml(`photo:${n}`, varMap, photoUrls) + '&nbsp;',
			);
		} catch {
			/* ignored */
		}
		setPhotoMenuOpen(false);
		emit();
	};
```

- [ ] **Step 7: Render the "+ Фото" button + dropdown**

Find the existing toolbar fragment that contains `<div className='relative' ref={pickerRef}>` and its `+ Переменная` button. Right after that whole `<div className='relative' ref={pickerRef}>...</div>` block (still inside the same parent `<div className='flex items-start gap-1.5'>`), add:

```tsx
				<div className='relative' ref={photoPickerRef}>
					<button
						type='button'
						onMouseDown={e => e.preventDefault()}
						onClick={() => setPhotoMenuOpen(o => !o)}
						disabled={photoUrls.length === 0}
						title='Вставить фото'
						className='btn btn-ghost h-7 px-2 text-[11px] border border-border disabled:opacity-40'>
						+ Фото
					</button>
					{photoMenuOpen && photoUrls.length > 0 && (
						<div className='absolute z-20 mt-1 max-h-72 w-56 overflow-auto rounded-md border border-border bg-card shadow-lg p-1'>
							<div className='grid grid-cols-3 gap-1'>
								{photoUrls.map((url, i) => (
									<button
										key={i}
										type='button'
										onMouseDown={e => e.preventDefault()}
										onClick={() => insertPhoto(i + 1)}
										title={`Фото ${i + 1}`}
										className='relative aspect-square overflow-hidden rounded border border-border bg-soft hover:border-flame-ring focus:border-flame-ring outline-none'>
										<img
											src={url}
											alt=''
											loading='lazy'
											className='absolute inset-0 h-full w-full object-cover'
											onError={e => {
												(e.target as HTMLImageElement).style.opacity = '0.2';
											}}
										/>
										<span className='absolute bottom-0.5 left-0.5 rounded bg-card/80 px-1 text-[10px] font-medium text-ink'>
											{i + 1}
										</span>
									</button>
								))}
							</div>
						</div>
					)}
				</div>
```

- [ ] **Step 8: Verify the build**

Run: `npm run build -w web`
Expected: clean build, zero TypeScript errors. (Existing consumers — `App.tsx`, `NewProductPanel.tsx` — render `<DescriptionEditor>` without `photoUrls`; the prop is optional so they still compile. The picker stays disabled there until Task 3 wires real values.)

- [ ] **Step 9: Commit**

```bash
git add web/src/components/DescriptionEditor.tsx
git commit -m "feat: + Фото picker in RichTextarea, photoUrls prop"
```

---

## Task 3: Wire `photoUrls` and `expandPhotoChips` into both consumers

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/NewProductPanel.tsx`

### Part A — `App.tsx` (clone-offer flow)

- [ ] **Step 1: Import `expandPhotoChips`**

In `web/src/App.tsx`, extend the existing import from `./components/shortcodes`:

```ts
import {
	buildVarMap,
	expandPhotoChips,
	flattenVars,
} from './components/shortcodes';
```

(If the current import is on a single line, change it to the multi-line form above; otherwise just add `expandPhotoChips` to the named imports.)

- [ ] **Step 2: Add `photoUrls={cleanedImages}` to `<DescriptionEditor>`**

`cleanedImages` is the existing `useMemo` that holds trimmed-non-empty image URLs (search for `const cleanedImages = useMemo`). Update the `<DescriptionEditor ... />` usage so that, alongside the existing props, it gets:

```tsx
								photoUrls={cleanedImages}
```

The full props block on `<DescriptionEditor>` should now include `value`, `onChange`, `dirty`, `onReset`, `varMap`, `templates`, the four template handlers, and the new `photoUrls`.

- [ ] **Step 3: Run `expandPhotoChips` in `cleanedDescription`**

Find the existing `cleanedDescription` `useMemo` (it currently strips empties, then runs `flattenVars`). Replace its body with the version that also runs `expandPhotoChips` after flatten:

```ts
	// Strip empty TEXT items, drop emptied sections, flatten {{variables}}
	// to plain text, then expand {{photo:N}} chips into real IMAGE items
	// — so Allegro receives no tokens.
	const cleanedDescription = useMemo<DescriptionSections | undefined>(() => {
		const cleaned = description.sections
			.map(s => ({
				items: s.items.filter(it =>
					it.type === 'TEXT' ? it.content.trim() : it.url.trim(),
				),
			}))
			.filter(s => s.items.length > 0);
		if (cleaned.length === 0) return undefined;
		const flat = flattenVars({ sections: cleaned }, varMap).sections;
		return expandPhotoChips(flat, cleanedImages).sections;
	}, [description, varMap, cleanedImages]);
```

- [ ] **Step 4: Build check**

Run: `npm run build -w web`
Expected: clean build, zero TypeScript errors.

- [ ] **Step 5: Commit Part A**

```bash
git add web/src/App.tsx
git commit -m "feat: wire photoUrls + expandPhotoChips into App clone flow"
```

### Part B — `NewProductPanel.tsx` (create-product flow)

- [ ] **Step 6: Import `expandPhotoChips`**

In `web/src/components/NewProductPanel.tsx`, extend the existing import from `./shortcodes`:

```ts
import {
	buildCategoryVarMap,
	expandPhotoChips,
	flattenVars,
} from './shortcodes';
```

- [ ] **Step 7: Pass `photoUrls={images}` to `<DescriptionEditor>`**

Find the `<DescriptionEditor>` usage near the bottom of `NewProductPanel.tsx` (around line 543). Add to its props:

```tsx
				photoUrls={images}
```

The component's `images` state (a `string[]` of CDN URLs) is the right input — same one fed to `ImagesEditor`.

- [ ] **Step 8: Apply `expandPhotoChips` inside `buildPayload`**

In `buildPayload`, the current code does:

```ts
		const sections: DescriptionSections['sections'] = [];
		const { sections: flatDescription } = flattenVars(description, varMap);
		for (const s of flatDescription.sections) {
```

Replace those three lines with a version that also runs `expandPhotoChips` BEFORE the existing per-item TEXT-sanitize / IMAGE-reupload loop. The cleaned (token-free) image URLs we pass to it are the same ones the payload uses (`images.map(u => u.trim()).filter(Boolean)`), so build that intermediate variable up front:

```ts
		const sections: DescriptionSections['sections'] = [];
		const cleanedImages = images.map(u => u.trim()).filter(Boolean);
		const flat = flattenVars(description, varMap).sections;
		const expanded = expandPhotoChips(flat, cleanedImages).sections;
		for (const s of expanded.sections) {
```

Then, lower down in `buildPayload`, the existing line `images: images.map(u => u.trim()).filter(Boolean),` should be changed to reuse the local variable to avoid duplicating the trim/filter:

```ts
			images: cleanedImages,
```

- [ ] **Step 9: Build + tests**

Run: `npm run build -w web` — clean build expected.
Run: `npm test` (repo root) — all suites pass.

- [ ] **Step 10: Commit Part B**

```bash
git add web/src/components/NewProductPanel.tsx
git commit -m "feat: wire photoUrls + expandPhotoChips into NewProductPanel"
```

---

## Task 4: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: server suite passes; web suite includes all existing tests + the new photo-chip tests, all green.

- [ ] **Step 2: Build everything**

Run: `npm run build`
Expected: server + web builds succeed.

- [ ] **Step 3: Manual smoke test in the browser**

With `npm run dev` running (HMR), open http://localhost:5173 and:

1. **Clone-offer flow:** load a source offer with ≥3 photos. In «Описание» click into a TEXT item, click **+ Фото** — confirm a dropdown shows thumbnails with numbers 1, 2, 3. Click photo #2 — confirm a chip `Фото · 2` appears in the text.
2. Reorder images in the «Фото» panel (move slot 2 to slot 1) — confirm the chip's text updates live (still `Фото · 2`, but visually still points to the new slot 2; verify by clicking dry-run clone and inspecting the payload).
3. Remove all photos — confirm `+ Фото` button gets disabled and existing chips switch to the missing style (`Фото · N · нет`).
4. Run a dry-run clone — open the request payload and confirm the `descriptionOverride` sections contain the right `IMAGE` items where the chip was placed (and no `{{photo:N}}` tokens reach Allegro).
5. **Templates carry photo chips:** save a description with photo chips as a template, switch to a different source offer, apply the template — confirm chips resolve to the NEW offer's photos.
6. **NewProductPanel flow:** in the create-product panel, add a few image URLs, then click into the description editor → `+ Фото` works the same way.

- [ ] **Step 4: Final commit (only if verification produced a fix)**

```bash
git add -A
git commit -m "fix: photo-chip verification fixes"
```

---

## Self-Review Notes

- **Spec coverage:**
  - §1 Model (token / chip / IMAGE-item) → Task 1 (`chipHtml`, `expandPhotoChips`).
  - §2 Discriminator (`photo:` prefix) → Task 1 (`PHOTO_KEY_RE`).
  - §3 UI «+ Фото» picker → Task 2 (Step 7) + outside-click (Step 5).
  - §4 Live missing/ok refresh on photoUrls change → Task 2 (Step 4c, deps `[varMap, photoUrls]`).
  - §5 Publish-time `expandPhotoChips` → Task 1 + wired in Task 3 (both `App.tsx` and `NewProductPanel.tsx`).
  - §6 Templates carry photo chips → automatic; verified in Task 4 step 3 case 5.
  - §7 Tests for `expandPhotoChips` + round-trips → Task 1 Step 1.
- **Type consistency:** `chipHtml(key, varMap, photoUrls?: string[])`, `tokensToChipsHtml(html, varMap, photoUrls?: string[])`, `chipsHtmlToTokens(html)` (unchanged signature, internally handles both chip kinds), `expandPhotoChips(description, photoUrls) → { sections, unresolved }` — same shape as `flattenVars`. `DescriptionEditor` adds `photoUrls?: string[]` (optional, defaults to `EMPTY_PHOTO_URLS`). All call sites in Tasks 2–3 match.
- **Placeholder scan:** no TBDs, every step has full code or a concrete command + expected outcome.
- **YAGNI:** no server storage, no in-chip thumbnail previews, no drag-n-drop, no per-section photo templates — matches the spec.
