# Photo-Ref IMAGE Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow IMAGE-items in the description editor to hold a `{{photo:N}}` token in their `url` field — pick a photo-by-number via "+ Фото" pickers (per-section bottom + per-IMAGE-row), render the row as a chip-style preview, and expand to a real IMAGE-item at publish.

**Architecture:** Keep the `DescriptionItem` union unchanged — `IMAGE.url` is now allowed to be a `{{photo:N}}` token client-side. Extend the existing `expandPhotoChips` to resolve such IMAGE-items (or drop them out-of-range). Relax the server template schema to accept either a URL or a photo token in `IMAGE.url`. Extract a shared `PhotoPicker` component for the two new picker spots.

**Tech Stack:** TypeScript, React 18, Vite, Tailwind (web); Express + Zod (server); vitest.

Spec: `docs/superpowers/specs/2026-05-26-photo-ref-image-items-design.md`

---

## File Structure

**Created:**
- `web/src/components/PhotoPicker.tsx` — small reusable button-with-thumbnail-grid-dropdown component.

**Modified:**
- `web/src/components/shortcodes.ts` — add `parsePhotoRefUrl`; extend `expandPhotoChips` to handle IMAGE items.
- `web/src/components/shortcodes.test.ts` — tests for the new behavior.
- `server/src/routes/api.ts` — add a relaxed template-only description schema.
- `web/src/components/DescriptionEditor.tsx` — "+ Фото" in the per-section bottom toolbar; "+ Фото" between URL input and ✕ on each IMAGE row; photo-ref IMAGE-row render variant.

---

## Task 1: `parsePhotoRefUrl` + extend `expandPhotoChips` for IMAGE items

**Files:**
- Modify: `web/src/components/shortcodes.ts`
- Test: `web/src/components/shortcodes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/components/shortcodes.test.ts` (after the existing `describe` blocks). First, add `parsePhotoRefUrl` to the existing `./shortcodes` import. Then add:

```ts
describe('parsePhotoRefUrl', () => {
  it('parses {{photo:N}} into a 1-based index', () => {
    expect(parsePhotoRefUrl('{{photo:1}}')).toEqual({ idx: 1 });
    expect(parsePhotoRefUrl('{{photo:42}}')).toEqual({ idx: 42 });
  });

  it('returns null for an ordinary URL', () => {
    expect(parsePhotoRefUrl('https://cdn.allegro.pl/x.jpg')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parsePhotoRefUrl('')).toBeNull();
  });

  it('does not match when there is text around the token', () => {
    expect(parsePhotoRefUrl(' {{photo:1}}')).toBeNull();
    expect(parsePhotoRefUrl('{{photo:1}}/')).toBeNull();
    expect(parsePhotoRefUrl('A {{photo:1}} B')).toBeNull();
  });

  it('does not match when there is whitespace inside the braces', () => {
    expect(parsePhotoRefUrl('{{ photo:1 }}')).toBeNull();
  });
});

describe('expandPhotoChips — IMAGE items', () => {
  it('resolves a photo-ref IMAGE item to a real-URL IMAGE item', () => {
    const r = expandPhotoChips(
      { sections: [{ items: [{ type: 'IMAGE', url: '{{photo:1}}' }] }] },
      ['http://x/a.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'IMAGE', url: 'http://x/a.jpg' },
    ]);
    expect(r.unresolved).toEqual([]);
  });

  it('drops an out-of-range photo-ref IMAGE item and reports the key', () => {
    const r = expandPhotoChips(
      { sections: [{ items: [{ type: 'IMAGE', url: '{{photo:7}}' }] }] },
      ['http://x/a.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([]);
    expect(r.unresolved).toEqual(['photo:7']);
  });

  it('passes a real-URL IMAGE item through unchanged', () => {
    const r = expandPhotoChips(
      {
        sections: [
          { items: [{ type: 'IMAGE', url: 'http://x/keep.jpg' }] },
        ],
      },
      ['http://x/other.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'IMAGE', url: 'http://x/keep.jpg' },
    ]);
  });

  it('handles TEXT with inline chip + IMAGE photo-ref in one section', () => {
    const r = expandPhotoChips(
      {
        sections: [
          {
            items: [
              { type: 'TEXT', content: 'before {{photo:1}} after' },
              { type: 'IMAGE', url: '{{photo:2}}' },
            ],
          },
        ],
      },
      ['http://x/a.jpg', 'http://x/b.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'TEXT', content: 'before ' },
      { type: 'IMAGE', url: 'http://x/a.jpg' },
      { type: 'TEXT', content: ' after' },
      { type: 'IMAGE', url: 'http://x/b.jpg' },
    ]);
    expect(r.unresolved).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w web -- shortcodes`
Expected: FAIL — `parsePhotoRefUrl` is not exported; `expandPhotoChips` does not currently transform IMAGE-items containing photo tokens.

- [ ] **Step 3: Add `parsePhotoRefUrl` and extend `expandPhotoChips`**

In `web/src/components/shortcodes.ts`, add `parsePhotoRefUrl` near the top — right after `PHOTO_KEY_RE` (around line 10–11):

```ts
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
```

Then modify `expandPhotoChips`. Find the line `if (it.type !== 'TEXT') { items.push(it); continue; }` inside the inner loop and replace that branch with logic that ALSO handles IMAGE items. The new full inner `for` loop body becomes:

```ts
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
```

(Read the function before editing to make sure your replacement preserves the surrounding `for (const it of s.items)` loop and the outer `sections.map(...)`. The TEXT branch logic is the EXISTING logic copied verbatim — only the IMAGE branch is new.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w web -- shortcodes`
Expected: PASS — all existing tests + 9 new tests (5 `parsePhotoRefUrl` + 4 `expandPhotoChips IMAGE`).

- [ ] **Step 5: Build check**

Run: `npm run build -w web`
Expected: clean build, zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/shortcodes.ts web/src/components/shortcodes.test.ts
git commit -m "feat: parsePhotoRefUrl + expandPhotoChips handles IMAGE items"
```

---

## Task 2: Server — relax template schema for photo-ref IMAGE urls

**Files:**
- Modify: `server/src/routes/api.ts`

The existing `descriptionSchema` (used by `cloneSchema` / `proposeProductSchema`) keeps `IMAGE.url: z.string().url()` — strict. For template create/update we add a separate schema that allows EITHER a URL OR a `{{photo:N}}` token.

- [ ] **Step 1: Add the relaxed schemas**

In `server/src/routes/api.ts`, right AFTER the existing `descriptionSchema` declaration (around lines 16–20), insert:

```ts
// Templates may carry `{{photo:N}}` tokens in IMAGE.url — they are resolved
// to real URLs client-side via `expandPhotoChips` before the offer/product
// payload reaches `descriptionSchema` (which stays strict).
const templateDescriptionItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TEXT'), content: z.string() }),
  z.object({
    type: z.literal('IMAGE'),
    url: z.union([
      z.string().url(),
      z.string().regex(/^\{\{photo:\d+\}\}$/),
    ]),
  }),
]);
const templateDescriptionSections = z
  .array(z.object({ items: z.array(templateDescriptionItemSchema).min(1) }))
  .min(1);
```

- [ ] **Step 2: Switch template schemas to the relaxed sections**

In the same file, find `templateCreateSchema` and change `sections: descriptionSchema.shape.sections` to `sections: templateDescriptionSections`:

```ts
const templateCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  sections: templateDescriptionSections,
});
```

Find `templateUpdateSchema` and do the same:

```ts
const templateUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  sections: templateDescriptionSections.optional(),
});
```

- [ ] **Step 3: Verify the server compiles**

Run: `npm run build -w server`
Expected: clean build, zero TypeScript errors.

- [ ] **Step 4: Verify both schemas behave correctly with curl**

The dev server (`npm run dev`) auto-reloads. Then:

```bash
# Photo-ref IMAGE allowed in a template (expect 201):
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/description-templates \
  -H 'Content-Type: application/json' \
  -d '{"name":"PhotoRefTest","sections":[{"items":[{"type":"IMAGE","url":"{{photo:1}}"}]}]}'

# Real URL still allowed (expect 201):
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/description-templates \
  -H 'Content-Type: application/json' \
  -d '{"name":"UrlTest","sections":[{"items":[{"type":"IMAGE","url":"https://example.com/a.jpg"}]}]}'

# Garbage url still rejected (expect 400):
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/description-templates \
  -H 'Content-Type: application/json' \
  -d '{"name":"BadTest","sections":[{"items":[{"type":"IMAGE","url":"not-a-url"}]}]}'
```

Clean up afterwards by deleting the two test templates via `DELETE /api/description-templates/<id>` (use ids from the response).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/api.ts
git commit -m "feat: relaxed template schema — IMAGE.url accepts photo tokens"
```

---

## Task 3: `PhotoPicker` shared component

**Files:**
- Create: `web/src/components/PhotoPicker.tsx`

A small reusable button-with-thumbnail-grid-dropdown component, used in two new places in `DescriptionEditor` (Task 4). Self-contained, no external deps beyond React.

- [ ] **Step 1: Create the component**

Create `web/src/components/PhotoPicker.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';

interface PhotoPickerProps {
	photoUrls: string[];
	/** Called with the 1-based photo index when a thumbnail is picked. */
	onPick: (n: number) => void;
	/** Button label. Defaults to "+ Фото". */
	label?: string;
	/** Override the button's className when a non-default style is needed. */
	buttonClassName?: string;
	/** Tooltip on the toggle button. */
	title?: string;
}

/**
 * Picker button + thumbnail-grid dropdown. Disabled when there are no photos.
 * Closes on outside-click. Designed to be dropped next to other inline actions.
 */
export function PhotoPicker({
	photoUrls,
	onPick,
	label = '+ Фото',
	buttonClassName,
	title = 'Вставить фото',
}: PhotoPickerProps) {
	const [open, setOpen] = useState(false);
	const wrapperRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const onDocMouseDown = (e: MouseEvent) => {
			if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener('mousedown', onDocMouseDown);
		return () => document.removeEventListener('mousedown', onDocMouseDown);
	}, [open]);

	return (
		<div className='relative' ref={wrapperRef}>
			<button
				type='button'
				onMouseDown={e => e.preventDefault()}
				onClick={() => setOpen(o => !o)}
				disabled={photoUrls.length === 0}
				title={title}
				className={
					buttonClassName ?? 'btn btn-ghost h-7 px-2 text-[12px] disabled:opacity-40'
				}>
				{label}
			</button>
			{open && photoUrls.length > 0 && (
				<div className='absolute z-20 mt-1 max-h-72 w-56 overflow-auto rounded-md border border-border bg-card shadow-lg p-1'>
					<div className='grid grid-cols-3 gap-1'>
						{photoUrls.map((url, i) => (
							<button
								key={i}
								type='button'
								onMouseDown={e => e.preventDefault()}
								onClick={() => {
									onPick(i + 1);
									setOpen(false);
								}}
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
	);
}
```

- [ ] **Step 2: Build check**

Run: `npm run build -w web`
Expected: clean build (component is unused at this point — that's fine, TS does not flag unused exports).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/PhotoPicker.tsx
git commit -m "feat: PhotoPicker shared component"
```

---

## Task 4: `DescriptionEditor` — section-bottom + per-row "+ Фото" + photo-ref render

**Files:**
- Modify: `web/src/components/DescriptionEditor.tsx`

Three changes to `DescriptionEditor`:
1. Import `PhotoPicker` and `parsePhotoRefUrl`.
2. Add a "+ Фото" button to the per-section bottom toolbar — adds a new IMAGE-item with `url = '{{photo:N}}'`.
3. In the IMAGE-row JSX: if the URL is a photo-ref token, render a chip-style row (thumbnail of `photoUrls[N-1]` + `Фото · N` badge); otherwise render the existing URL input. In URL-input mode, also add a per-row "+ Фото" button between the URL input and the ✕ — picking N converts that row's url to `{{photo:N}}`.

- [ ] **Step 1: Add imports**

At the top of `web/src/components/DescriptionEditor.tsx`, change the existing shortcodes import (currently `import { chipHtml, chipsHtmlToTokens, tokensToChipsHtml } from './shortcodes';`) to:

```ts
import {
	chipHtml,
	chipsHtmlToTokens,
	parsePhotoRefUrl,
	tokensToChipsHtml,
} from './shortcodes';
```

Add a new import line right after it:

```ts
import { PhotoPicker } from './PhotoPicker';
```

- [ ] **Step 2: Add the per-section "+ Фото" button**

Find the per-section bottom button row (around lines 254–267 of the current file). It currently looks like:

```tsx
							<div className='flex gap-1 pt-1'>
								<button
									type='button'
									onClick={() => addItem(sIdx, 'TEXT')}
									className='btn btn-ghost h-7 px-2 text-[12px]'>
									+ текст
								</button>
								<button
									type='button'
									onClick={() => addItem(sIdx, 'IMAGE')}
									className='btn btn-ghost h-7 px-2 text-[12px]'>
									+ картинка
								</button>
							</div>
```

Add the `PhotoPicker` as a third entry inside the same flex row, AFTER the "+ картинка" button:

```tsx
							<div className='flex gap-1 pt-1'>
								<button
									type='button'
									onClick={() => addItem(sIdx, 'TEXT')}
									className='btn btn-ghost h-7 px-2 text-[12px]'>
									+ текст
								</button>
								<button
									type='button'
									onClick={() => addItem(sIdx, 'IMAGE')}
									className='btn btn-ghost h-7 px-2 text-[12px]'>
									+ картинка
								</button>
								<PhotoPicker
									photoUrls={photoUrls}
									onPick={n => {
										const next = sections.map((sec, i) =>
											i === sIdx
												? {
														items: [
															...sec.items,
															{ type: 'IMAGE' as const, url: `{{photo:${n}}}` },
														],
													}
												: sec,
										);
										setSections(next);
									}}
								/>
							</div>
```

(`setSections` and `sections` are the existing state already used by `addItem` — see how `addItem` updates them. Adding a photo-ref item could not reuse `addItem` because that helper hard-codes `url: ''`; doing it inline is fine.)

- [ ] **Step 3: Render photo-ref IMAGE row + per-row "+ Фото" button**

Find the IMAGE-row JSX (current lines ~215–241). It currently looks like:

```tsx
									) : (
										<div className='grid grid-cols-[56px_1fr] gap-2'>
											<div className='aspect-square w-14 h-14 border border-border rounded-md overflow-hidden bg-soft flex items-center justify-center'>
												{it.url ? (
													<img
														src={it.url}
														alt=''
														loading='lazy'
														className='w-full h-full object-contain'
														onError={e => {
															(e.target as HTMLImageElement).style.opacity =
																'0.2';
														}}
													/>
												) : (
													<span className='text-ink-faint text-[10px]'>—</span>
												)}
											</div>
											<input
												className='input font-mono text-[12px]'
												placeholder='https://…'
												value={it.url}
												onChange={e =>
													updateItem(sIdx, iIdx, { url: e.target.value })
												}
											/>
										</div>
									)}
```

Replace it with a version that branches on `parsePhotoRefUrl`:

```tsx
									) : (() => {
										const photoRef = parsePhotoRefUrl(it.url);
										if (photoRef) {
											const previewUrl =
												photoRef.idx >= 1 && photoRef.idx <= photoUrls.length
													? photoUrls[photoRef.idx - 1]
													: undefined;
											const missing = previewUrl === undefined;
											return (
												<div className='grid grid-cols-[56px_1fr] gap-2 items-center'>
													<div className='aspect-square w-14 h-14 border border-border rounded-md overflow-hidden bg-soft flex items-center justify-center'>
														{previewUrl ? (
															<img
																src={previewUrl}
																alt=''
																loading='lazy'
																className='w-full h-full object-cover'
																onError={e => {
																	(e.target as HTMLImageElement).style.opacity =
																		'0.2';
																}}
															/>
														) : (
															<span className='text-ink-faint text-[10px]'>
																—
															</span>
														)}
													</div>
													<span
														className={
															missing
																? 'var-chip var-chip--missing'
																: 'var-chip'
														}>
														{missing
															? `Фото · ${photoRef.idx} · нет`
															: `Фото · ${photoRef.idx}`}
													</span>
												</div>
											);
										}
										return (
											<div className='grid grid-cols-[56px_1fr_auto] gap-2 items-center'>
												<div className='aspect-square w-14 h-14 border border-border rounded-md overflow-hidden bg-soft flex items-center justify-center'>
													{it.url ? (
														<img
															src={it.url}
															alt=''
															loading='lazy'
															className='w-full h-full object-contain'
															onError={e => {
																(e.target as HTMLImageElement).style.opacity =
																	'0.2';
															}}
														/>
													) : (
														<span className='text-ink-faint text-[10px]'>—</span>
													)}
												</div>
												<input
													className='input font-mono text-[12px]'
													placeholder='https://…'
													value={it.url}
													onChange={e =>
														updateItem(sIdx, iIdx, { url: e.target.value })
													}
												/>
												<PhotoPicker
													photoUrls={photoUrls}
													onPick={n =>
														updateItem(sIdx, iIdx, {
															url: `{{photo:${n}}}`,
														})
													}
													buttonClassName='btn btn-ghost h-10 w-10 px-0 text-ink-faint hover:text-ink text-[11px] disabled:opacity-40'
													label='+ Фото'
													title='Превратить в ссылку на фото оффера'
												/>
											</div>
										);
									})()}
```

Notes on the diff:
- The outer ternary `{it.type === 'TEXT' ? <RichTextarea/> : <imageRow/>}` is preserved — only the `else` branch's JSX changes.
- The URL-input row's grid template changes from `[56px_1fr]` to `[56px_1fr_auto]` to accommodate the per-row picker.
- The chip-style photo-ref row uses `[56px_1fr]` (no picker), so its grid template stays narrow.
- `updateItem` is the existing helper inside `DescriptionEditor` that updates one item by section+item index.

- [ ] **Step 4: Build check**

Run: `npm run build -w web`
Expected: clean build, zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/DescriptionEditor.tsx
git commit -m "feat: + Фото in section toolbar + per-IMAGE-row, photo-ref render"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: server + web suites both pass (server: 39; web shortcodes: 39+9 = 48).

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: server + web builds both succeed.

- [ ] **Step 3: Manual smoke test in the browser**

With `npm run dev` running, open http://localhost:5173 and:

1. **Clone-offer flow:** load a source offer with ≥3 photos. In «Описание» panel, in any section's bottom toolbar click **+ Фото** → pick photo 2 → confirm a chip-style IMAGE row appears showing photo #2's thumbnail and the badge `Фото · 2`.
2. Click **+ картинка** → an empty URL row appears → click the per-row **+ Фото** button (between URL input and ✕) → pick photo 1 → confirm that row also converts to a photo-ref chip-style row pointing at photo 1.
3. Reorder images in the «Фото» panel (move what was photo 1 to position 3) → confirm both chip-style rows' previews update live to reflect the new positions.
4. Save the description (with at least one photo-ref IMAGE row) as a template — confirm the POST succeeds (no 400 from the server).
5. Switch to a different source offer, apply the template → photo-ref IMAGE rows now show the NEW offer's photos at the same positions. If the new offer has fewer photos, the rows render as «Фото · N · нет», and the apply alert lists the missing keys.
6. Run a dry-run clone — open the request payload and confirm `descriptionOverride` sections contain real-URL IMAGE items at the spots that had photo-refs (and no `{{photo:N}}` strings).
7. **Create-product flow:** repeat steps 1–2 in `NewProductPanel` — confirm the same behavior, and that the proposed-product payload sends real URLs.

- [ ] **Step 4: Final commit (only if verification produced a fix)**

```bash
git add -A
git commit -m "fix: photo-ref-image-items verification fixes"
```

---

## Self-Review Notes

- **Spec coverage:**
  - §Model (`{{photo:N}}` in IMAGE.url; `parsePhotoRefUrl`) → Task 1.
  - §UI 6.1 "+ Фото" in section bottom → Task 4 Step 2.
  - §UI 6.2 "+ Фото" per-IMAGE-row → Task 4 Step 3.
  - §UI 6.3 Photo-ref row render → Task 4 Step 3.
  - §Publish-time expansion (IMAGE branch in `expandPhotoChips`) → Task 1 Step 3.
  - §Server template schema relaxation → Task 2.
  - §Templates carry photo-ref IMAGE items → automatic (Tasks 1 + 2 enable it); verified in Task 5 Steps 4–5.
  - §Tests for `parsePhotoRefUrl` and `expandPhotoChips` IMAGE → Task 1 Step 1.
- **Type consistency:** `parsePhotoRefUrl(s) → { idx: number } | null` used in shortcodes.ts (Task 1) and DescriptionEditor.tsx (Task 4) with the same shape. `PhotoPicker.onPick: (n: number) => void` consumed in both Task 4 placements identically. `descriptionItemSchema` (strict) and `templateDescriptionItemSchema` (relaxed) coexist with the right route mappings.
- **Placeholder scan:** no TBDs; every step has full code or a concrete command + expected outcome.
- **YAGNI:** no panel-header "+ Фото", no URL↔photo-ref toggle on the same row, no drag-n-drop — matches the spec.
