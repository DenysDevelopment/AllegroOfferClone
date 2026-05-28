# Клон: заголовок из каталога + раскладки строк описания — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заголовок клона берётся из карточки каталога Allegro, а описание собирается из валидных «строк-раскладок» и больше не разваливается.

**Architecture:** Сервер (`clone.ts`) меняет дефолт title на `product.name` и доводит `splitDescriptionSectionsToMaxTwoItems` до гаранта валидных секций; `body-validate.ts` ловит запрещённую пару `[TEXT,TEXT]`. Клиент получает чистый модуль раскладок `descriptionLayout.ts`, на нём перестраивается `DescriptionEditor` (строка = раскладка, 2-элементные строки рисуются в две колонки), а `App.tsx` берёт авто-title из `product.name`.

**Tech Stack:** TypeScript, React, Vite, Vitest (server + web — оба воркспейса), Tailwind.

**Спека:** `docs/superpowers/specs/2026-05-28-clone-title-and-description-layout-design.md`

**Правила Allegro по строке описания:** допустимы `[TEXT]`, `[IMAGE]`, `[TEXT,IMAGE]`, `[IMAGE,TEXT]`, `[IMAGE,IMAGE]`. Запрещено `[TEXT,TEXT]`.

---

## Task 1: Сервер — title клона из карточки каталога

**Files:**
- Modify: `server/src/core/clone.ts:330-332` (расчёт `newName`), `server/src/core/clone.ts:745-756` (удалить неиспользуемую `rewriteTitle`)
- Test: `server/src/core/clone.test.ts:199-212` (правка существующего теста) + новый тест

Поведение: при отсутствии `options.nameOverride` берём название карточки каталога
(`productName`, уже вычислено выше в `buildCloneBody`), fallback на `source.name`.
Подстановка оверрайдов в title больше не делается.

- [ ] **Step 1: Обновить существующий тест под новое поведение**

В `server/src/core/clone.test.ts` заменить тест на строках 199-212 целиком на:

```ts
  it('uses the catalog product name as the title (no override substitution)', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const { body } = await buildCloneBody(
      fakeClient({}),
      baseOffer,
      {
        sourceOfferId: 'src-1',
        paramOverrides: { 'Pojemność dysku SSD': '512 GB' },
      },
      steps,
    );
    // Title comes from the catalog product card name, not the offer title,
    // and the SSD override is NOT substituted into it.
    expect((body as { name: string }).name).toBe('Lenovo IdeaPad 5');
  });

  it('nameOverride still wins over the catalog name', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const { body } = await buildCloneBody(
      fakeClient({}),
      baseOffer,
      {
        sourceOfferId: 'src-1',
        paramOverrides: {},
        nameOverride: 'Мой ручной заголовок',
      },
      steps,
    );
    expect((body as { name: string }).name).toBe('Мой ручной заголовок');
  });
```

- [ ] **Step 2: Запустить тесты — убедиться, что новый title-тест падает**

Run: `npm run test -w server -- -t "catalog product name"`
Expected: FAIL — текущий код возвращает `rewriteTitle(...)` = `Lenovo IdeaPad 5 16GB 512GB SSD Win11`, а не `Lenovo IdeaPad 5`.

- [ ] **Step 3: Изменить расчёт `newName`**

В `server/src/core/clone.ts` заменить (строки 330-332):

```ts
	const newName =
		options.nameOverride ??
		rewriteTitle(source.name ?? productName ?? '', oldValues);
```

на:

```ts
	// Title defaults to the CATALOG product card name (productName), not the
	// offer's listing title — operator can still type nameOverride. We do NOT
	// substitute parameter overrides into it (per product decision 2026-05-28).
	const newName = options.nameOverride ?? productName ?? source.name ?? '';
```

- [ ] **Step 4: Удалить неиспользуемую функцию `rewriteTitle`**

В `server/src/core/clone.ts` удалить весь блок (строки 745-756):

```ts
function rewriteTitle(
	title: string,
	changes: Array<{ name: string; old?: string; new: string }>,
): string {
	let out = title;
	for (const c of changes) {
		if (c.old) {
			out = substituteValueVariants(out, c.old, c.new);
		}
	}
	return out;
}
```

(`substituteValueVariants` остаётся — её использует `buildSearchPhrase`.)

- [ ] **Step 5: Запустить весь серверный тест-набор**

Run: `npm run test -w server`
Expected: PASS (включая оба новых title-теста).

- [ ] **Step 6: Коммит**

```bash
git add server/src/core/clone.ts server/src/core/clone.test.ts
git commit -m "feat: clone title defaults to catalog product name"
```

---

## Task 2: Сервер — безопасная разбивка секций (никогда `[TEXT,TEXT]`)

**Files:**
- Modify: `server/src/core/clone.ts:1242-1267` (`splitDescriptionSectionsToMaxTwoItems`)
- Test: `server/src/core/clone.test.ts` (новый `describe` в конце файла)

`splitDescriptionSectionsToMaxTwoItems` экспортируется. Функция мутирует
`body.description.sections` на месте.

- [ ] **Step 1: Добавить тесты разбивки**

Добавить в конец `server/src/core/clone.test.ts`:

```ts
describe('splitDescriptionSectionsToMaxTwoItems', () => {
  const T = (content: string) => ({ type: 'TEXT' as const, content });
  const I = (url: string) => ({ type: 'IMAGE' as const, url });

  function run(sections: Array<{ items: Array<{ type: string }> }>) {
    const body = { description: { sections } } as Record<string, unknown>;
    splitDescriptionSectionsToMaxTwoItems(body, []);
    return (body as { description: { sections: Array<{ items: Array<{ type: string }> }> } })
      .description.sections;
  }

  it('splits [TEXT, TEXT] into two single-text rows', () => {
    const out = run([{ items: [T('a'), T('b')] }]);
    expect(out).toEqual([{ items: [T('a')] }, { items: [T('b')] }]);
  });

  it('keeps valid two-item layouts untouched', () => {
    const out = run([
      { items: [T('a'), I('u1')] },
      { items: [I('u2'), T('b')] },
      { items: [I('u3'), I('u4')] },
    ]);
    expect(out).toEqual([
      { items: [T('a'), I('u1')] },
      { items: [I('u2'), T('b')] },
      { items: [I('u3'), I('u4')] },
    ]);
  });

  it('chunks >2 items by two, then fixes any [TEXT,TEXT] pair', () => {
    // [T,I,T] -> chunk -> [T,I] + [T]
    const out = run([{ items: [T('a'), I('u1'), T('b')] }]);
    expect(out).toEqual([{ items: [T('a'), I('u1')] }, { items: [T('b')] }]);
  });

  it('chunks [T,T,T,T] -> 2 pairs -> 4 single-text rows', () => {
    const out = run([{ items: [T('a'), T('b'), T('c'), T('d')] }]);
    expect(out).toEqual([
      { items: [T('a')] },
      { items: [T('b')] },
      { items: [T('c')] },
      { items: [T('d')] },
    ]);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test -w server -- -t "splitDescriptionSectionsToMaxTwoItems"`
Expected: FAIL — текущая функция оставляет `[TEXT,TEXT]` парой.

- [ ] **Step 3: Доработать функцию**

В `server/src/core/clone.ts` заменить тело `splitDescriptionSectionsToMaxTwoItems`
(строки 1242-1267) на:

```ts
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
		steps.push({
			level: 'info',
			message:
				`Описание нормализовано: секц. с >2 элементами разрезано ${chunked}` +
				(textPairsSplit > 0
					? `; пар [текст+текст] разделено ${textPairsSplit} (Allegro запрещает два текста в строке)`
					: ''),
		});
	}
}
```

- [ ] **Step 4: Запустить тесты разбивки**

Run: `npm run test -w server -- -t "splitDescriptionSectionsToMaxTwoItems"`
Expected: PASS (все 4 кейса).

- [ ] **Step 5: Коммит**

```bash
git add server/src/core/clone.ts server/src/core/clone.test.ts
git commit -m "fix: section splitter never emits [TEXT,TEXT] rows"
```

---

## Task 3: Сервер — валидатор ловит `[TEXT,TEXT]`

**Files:**
- Modify: `server/src/core/body-validate.ts` (внутри цикла по `items`, после проверки `> ALLEGRO_MAX_ITEMS_PER_SECTION`, строки 150-156)
- Test: `server/src/core/body-validate.test.ts` (новый файл)

- [ ] **Step 1: Создать тест-файл**

Создать `server/src/core/body-validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateAllegroBody } from './body-validate.js';

const T = (content: string) => ({ type: 'TEXT' as const, content });
const I = (url: string) => ({ type: 'IMAGE' as const, url });

function offerBody(sections: Array<{ items: unknown[] }>) {
  return {
    images: ['https://img/1'],
    description: { sections },
  } as Record<string, unknown>;
}

describe('validateAllegroBody — description rows', () => {
  it('flags a [TEXT, TEXT] section as an error', () => {
    const issues = validateAllegroBody(offerBody([{ items: [T('a'), T('b')] }]), 'offer');
    const hit = issues.find(i => i.path === 'description.sections[0].items');
    expect(hit?.level).toBe('error');
    expect(hit?.message).toContain('TEXT');
  });

  it('accepts valid two-item layouts', () => {
    const issues = validateAllegroBody(
      offerBody([
        { items: [T('a'), I('https://img/1')] },
        { items: [I('https://img/1'), I('https://img/1')] },
      ]),
      'offer',
    );
    expect(issues.filter(i => i.level === 'error')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что первый кейс падает**

Run: `npm run test -w server -- body-validate`
Expected: FAIL — валидатор пока не проверяет пару двух TEXT.

- [ ] **Step 3: Добавить правило в валидатор**

В `server/src/core/body-validate.ts`, внутри `sections.forEach`, сразу ПОСЛЕ блока
проверки `items.length > ALLEGRO_MAX_ITEMS_PER_SECTION` (после строки 156, перед
`items.forEach`), вставить:

```ts
				if (
					items.length === 2 &&
					(items[0] as { type?: string }).type === 'TEXT' &&
					(items[1] as { type?: string }).type === 'TEXT'
				) {
					issues.push({
						level: 'error',
						message:
							'section имеет два TEXT-элемента в одной строке — Allegro запрещает (допустимо: текст+фото, фото+текст, два фото)',
						path: `description.sections[${si}].items`,
					});
				}
```

- [ ] **Step 4: Запустить тесты валидатора**

Run: `npm run test -w server -- body-validate`
Expected: PASS (оба кейса).

- [ ] **Step 5: Коммит**

```bash
git add server/src/core/body-validate.ts server/src/core/body-validate.test.ts
git commit -m "feat: body-validate rejects [TEXT,TEXT] description rows"
```

---

## Task 4: Клиент — модуль раскладок `descriptionLayout.ts`

**Files:**
- Create: `web/src/components/descriptionLayout.ts`
- Test: `web/src/components/descriptionLayout.test.ts`

- [ ] **Step 1: Написать тесты**

Создать `web/src/components/descriptionLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectLayout, relayoutSection } from './descriptionLayout';
import type { DescriptionItem } from '../api';

const T = (content: string): DescriptionItem => ({ type: 'TEXT', content });
const I = (url: string): DescriptionItem => ({ type: 'IMAGE', url });

describe('detectLayout', () => {
  it('detects single text/image', () => {
    expect(detectLayout([T('a')])).toBe('text');
    expect(detectLayout([I('u')])).toBe('image');
  });
  it('detects two-item layouts', () => {
    expect(detectLayout([T('a'), I('u')])).toBe('text-image');
    expect(detectLayout([I('u'), T('a')])).toBe('image-text');
    expect(detectLayout([I('u'), I('v')])).toBe('image-image');
  });
  it('falls back to text for empty or [TEXT,TEXT]', () => {
    expect(detectLayout([])).toBe('text');
    expect(detectLayout([T('a'), T('b')])).toBe('text');
  });
});

describe('relayoutSection', () => {
  it('text -> text-image keeps text, adds empty image', () => {
    expect(relayoutSection([T('hello')], 'text-image')).toEqual([
      T('hello'),
      I(''),
    ]);
  });
  it('image-image -> text keeps no image, single empty text', () => {
    expect(relayoutSection([I('a'), I('b')], 'text')).toEqual([T('')]);
  });
  it('text-image -> image-text preserves content by type', () => {
    expect(relayoutSection([T('hi'), I('pic')], 'image-text')).toEqual([
      I('pic'),
      T('hi'),
    ]);
  });
  it('empty section -> image-image yields two empty images', () => {
    expect(relayoutSection([], 'image-image')).toEqual([I(''), I('')]);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test -w web -- descriptionLayout`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Создать модуль**

Создать `web/src/components/descriptionLayout.ts`:

```ts
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
```

- [ ] **Step 4: Запустить тесты модуля**

Run: `npm run test -w web -- descriptionLayout`
Expected: PASS (все кейсы).

- [ ] **Step 5: Коммит**

```bash
git add web/src/components/descriptionLayout.ts web/src/components/descriptionLayout.test.ts
git commit -m "feat: descriptionLayout helper (detect + relayout rows)"
```

---

## Task 5: Клиент — `DescriptionEditor` на строках-раскладках

**Files:**
- Modify: `web/src/components/DescriptionEditor.tsx` (импорты + функция `DescriptionEditor`, строки 1-349; добавить компонент `ImageSlot`)

`RichTextarea` (строки 351-674) и `TemplateMenu` (676-795) **не меняются**.
Web-tsconfig имеет `noUnusedLocals`/`noUnusedParameters: true` — не оставлять
неиспользуемых символов.

- [ ] **Step 1: Обновить импорты**

В начале `web/src/components/DescriptionEditor.tsx` заменить блок импортов (строки 1-13) на:

```tsx
import { useEffect, useRef, useState } from 'react';
import type {
	DescriptionItem,
	DescriptionSections,
	DescriptionTemplate,
} from '../api';
import {
	chipHtml,
	chipsHtmlToTokens,
	parsePhotoRefUrl,
	tokensToChipsHtml,
} from './shortcodes';
import { PhotoPicker } from './PhotoPicker';
import { LAYOUTS, detectLayout, relayoutSection, type Layout } from './descriptionLayout';
```

- [ ] **Step 2: Заменить тело функции `DescriptionEditor`**

Заменить функцию `DescriptionEditor` целиком (от `export function DescriptionEditor(` на
строке 45 до её закрывающей `}` на строке 349) на:

```tsx
export function DescriptionEditor({
	value,
	onChange,
	dirty,
	onReset,
	varMap = EMPTY_VAR_MAP,
	photoUrls = EMPTY_PHOTO_URLS,
	templates,
	onSaveTemplate,
	onApplyTemplate,
	onRenameTemplate,
	onDeleteTemplate,
}: Props) {
	const sections = value.sections;

	const setSections = (next: Array<{ items: DescriptionItem[] }>) =>
		onChange({ sections: next });

	const updateItem = (
		sIdx: number,
		iIdx: number,
		patch: Partial<DescriptionItem>,
	) => {
		const next = sections.map((s, i) => {
			if (i !== sIdx) return s;
			return {
				items: s.items.map((it, j) =>
					j === iIdx ? ({ ...it, ...patch } as DescriptionItem) : it,
				),
			};
		});
		setSections(next);
	};

	const setLayout = (sIdx: number, layout: Layout) => {
		const next = sections.map((s, i) =>
			i === sIdx ? { items: relayoutSection(s.items, layout) } : s,
		);
		setSections(next);
	};

	const addSection = (layout: Layout) => {
		setSections([...sections, { items: relayoutSection([], layout) }]);
	};

	const removeSection = (sIdx: number) =>
		setSections(sections.filter((_, i) => i !== sIdx));

	const moveSection = (sIdx: number, dir: -1 | 1) => {
		const j = sIdx + dir;
		if (j < 0 || j >= sections.length) return;
		const next = sections.slice();
		[next[sIdx], next[j]] = [next[j], next[sIdx]];
		setSections(next);
	};

	return (
		<section className='panel'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
				<span className='label flex items-center gap-2'>
					Описание
					<span className='text-[11px] font-medium text-ink-muted normal-case tracking-normal'>
						· {sections.length} строк
					</span>
					{dirty && (
						<span className='text-[11px] font-medium text-flame normal-case tracking-normal'>
							· изменено
						</span>
					)}
				</span>
				<div className='flex items-center gap-2'>
					{onSaveTemplate &&
						onApplyTemplate &&
						onRenameTemplate &&
						onDeleteTemplate && (
							<TemplateMenu
								templates={templates ?? []}
								sectionsCount={sections.length}
								onSave={onSaveTemplate}
								onApply={onApplyTemplate}
								onRename={onRenameTemplate}
								onDelete={onDeleteTemplate}
							/>
						)}
					{dirty && (
						<button
							type='button'
							onClick={onReset}
							className='btn btn-ghost h-7 px-2 text-[12px]'
							title='Вернуть исходные'>
							сбросить
						</button>
					)}
				</div>
			</header>

			<div className='p-4 space-y-3'>
				{sections.length === 0 ? (
					<p className='text-[13px] text-ink-muted'>Описание пусто.</p>
				) : (
					sections.map((s, sIdx) => {
						const layout = detectLayout(s.items);
						const twoCol = s.items.length === 2;
						return (
							<div
								key={sIdx}
								className='border border-border-muted rounded-md p-3 space-y-2 bg-soft/30'>
								<div className='flex items-center justify-between gap-2'>
									<div className='flex items-center gap-2'>
										<span className='label'>Строка {sIdx + 1}</span>
										<select
											value={layout}
											onChange={e => setLayout(sIdx, e.target.value as Layout)}
											className='input h-7 text-[12px] py-0 w-auto'
											title='Раскладка строки'>
											{LAYOUTS.map(l => (
												<option key={l.value} value={l.value}>
													{l.label}
												</option>
											))}
										</select>
									</div>
									<div className='flex'>
										<button
											type='button'
											onClick={() => moveSection(sIdx, -1)}
											disabled={sIdx === 0}
											className='btn btn-ghost h-7 w-7 px-0 text-ink-faint disabled:opacity-30'
											title='вверх'>
											↑
										</button>
										<button
											type='button'
											onClick={() => moveSection(sIdx, 1)}
											disabled={sIdx === sections.length - 1}
											className='btn btn-ghost h-7 w-7 px-0 text-ink-faint disabled:opacity-30'
											title='вниз'>
											↓
										</button>
										<button
											type='button'
											onClick={() => removeSection(sIdx)}
											className='btn btn-ghost h-7 w-7 px-0 text-ink-faint hover:text-bad'
											title='удалить строку'>
											✕
										</button>
									</div>
								</div>

								<div
									className={
										twoCol
											? 'grid grid-cols-2 gap-2 items-start'
											: 'grid grid-cols-1 gap-2'
									}>
									{s.items.map((it, iIdx) =>
										it.type === 'TEXT' ? (
											<RichTextarea
												key={iIdx}
												value={it.content}
												onChange={v => updateItem(sIdx, iIdx, { content: v })}
												varMap={varMap}
												photoUrls={photoUrls}
											/>
										) : (
											<ImageSlot
												key={iIdx}
												url={it.url}
												onChange={url => updateItem(sIdx, iIdx, { url })}
												photoUrls={photoUrls}
											/>
										),
									)}
								</div>
							</div>
						);
					})
				)}

				<div className='flex flex-wrap items-center gap-1 pt-1'>
					<span className='text-[12px] text-ink-muted mr-1'>+ строка:</span>
					{LAYOUTS.map(l => (
						<button
							key={l.value}
							type='button'
							onClick={() => addSection(l.value)}
							className='btn btn-ghost h-7 px-2 text-[12px]'>
							{l.label}
						</button>
					))}
				</div>
			</div>
		</section>
	);
}

/**
 * Image slot for a description row: thumbnail preview (photo-ref aware) +
 * URL input + «+ Фото» picker that turns the slot into a `{{photo:N}}` ref.
 * Extracted so it can sit in either column of a two-item row.
 */
function ImageSlot({
	url,
	onChange,
	photoUrls,
}: {
	url: string;
	onChange: (url: string) => void;
	photoUrls: string[];
}) {
	const photoRef = parsePhotoRefUrl(url);
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
								(e.target as HTMLImageElement).style.opacity = '0.2';
							}}
						/>
					) : (
						<span className='text-ink-faint text-[10px]'>—</span>
					)}
				</div>
				<span className={missing ? 'var-chip var-chip--missing' : 'var-chip'}>
					{missing ? `Фото · ${photoRef.idx} · нет` : `Фото · ${photoRef.idx}`}
				</span>
			</div>
		);
	}
	return (
		<div className='grid grid-cols-[56px_1fr_auto] gap-2 items-center'>
			<div className='aspect-square w-14 h-14 border border-border rounded-md overflow-hidden bg-soft flex items-center justify-center'>
				{url ? (
					<img
						src={url}
						alt=''
						loading='lazy'
						className='w-full h-full object-contain'
						onError={e => {
							(e.target as HTMLImageElement).style.opacity = '0.2';
						}}
					/>
				) : (
					<span className='text-ink-faint text-[10px]'>—</span>
				)}
			</div>
			<input
				className='input font-mono text-[12px]'
				placeholder='https://…'
				value={url}
				onChange={e => onChange(e.target.value)}
			/>
			<PhotoPicker
				photoUrls={photoUrls}
				onPick={n => onChange(`{{photo:${n}}}`)}
				buttonClassName='btn btn-ghost h-10 w-10 px-0 text-ink-faint hover:text-ink text-[11px] disabled:opacity-40'
				label='+ Фото'
				title='Превратить в ссылку на фото оффера'
			/>
		</div>
	);
}
```

- [ ] **Step 3: Проверить типы и сборку web**

Run: `npm run build -w web`
Expected: PASS — TS-компиляция без ошибок (нет неиспользуемых импортов/символов;
`addItem`/`removeItem` удалены вместе со старым телом функции).

- [ ] **Step 4: Прогнать web-тесты (регрессий нет)**

Run: `npm run test -w web`
Expected: PASS (включая `descriptionLayout`, `shortcodes`, `descriptionSanitize`).

- [ ] **Step 5: Коммит**

```bash
git add web/src/components/DescriptionEditor.tsx
git commit -m "feat: row-layout description editor (text/image side-by-side)"
```

---

## Task 6: Клиент — авто-title из `product.name`

**Files:**
- Modify: `web/src/App.tsx:207-221` (`autoName` useMemo)

- [ ] **Step 1: Заменить расчёт `autoName`**

В `web/src/App.tsx` заменить блок (строки 207-221):

```tsx
	// Live-computed title with parameter overrides applied (mirrors server logic).
	const autoName = useMemo(() => {
		if (!preview?.name) return '';
		let out = preview.name;
		for (const o of overrides) {
			const meta = preview.parameters?.find(
				p => (p.name ?? '').toLowerCase() === o.name.trim().toLowerCase(),
			);
			// Allegro stores dict-param values in `valuesLabels` and free-form ones in `values`.
			const old = meta?.valuesLabels?.[0] || meta?.values?.[0];
			if (!old || !o.value.trim()) continue;
			out = substituteValueVariants(out, old, o.value.trim());
		}
		return out;
	}, [preview, overrides]);
```

на:

```tsx
	// Auto title defaults to the CATALOG product card name (preview.product.name),
	// falling back to the offer's listing title. No parameter-override substitution
	// (per product decision 2026-05-28) — operator can still edit it by hand.
	const autoName = useMemo(
		() => preview?.product?.name ?? preview?.name ?? '',
		[preview],
	);
```

- [ ] **Step 2: Удалить ставшие неиспользуемыми локальные функции**

После Step 1 `autoName` больше не вызывает `substituteValueVariants` — её и её
хелперы `expandVariants`/`escapeRegExp` (используются только ею) надо удалить, иначе
`noUnusedLocals` уронит сборку. В `web/src/App.tsx` удалить блок (строки 1007-1033):

```tsx
// Mirrors server-side substituteValueVariants to keep the live title preview in sync.
function substituteValueVariants(
	s: string,
	oldVal: string,
	newVal: string,
): string {
	const variants = expandVariants(oldVal);
	const targets = expandVariants(newVal);
	let out = s;
	for (let i = 0; i < variants.length; i++) {
		const re = new RegExp(escapeRegExp(variants[i]), 'gi');
		if (re.test(out)) out = out.replace(re, targets[i]);
	}
	return out;
}

function expandVariants(v: string): string[] {
	const trimmed = v.trim();
	const tight = trimmed.replace(/\s+/g, '');
	return Array.from(
		new Set([trimmed, tight, tight.toLowerCase(), tight.toUpperCase()]),
	);
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

Проверить, что нигде больше в `App.tsx` нет ссылок:
Run: `grep -n "substituteValueVariants\|expandVariants\|escapeRegExp" web/src/App.tsx`
Expected: пусто.

- [ ] **Step 3: Проверить сборку web**

Run: `npm run build -w web`
Expected: PASS — нет ошибок неиспользуемых символов (`noUnusedLocals`).

- [ ] **Step 4: Коммит**

```bash
git add web/src/App.tsx
git commit -m "feat: clone auto-title from catalog product name"
```

---

## Финальная проверка

- [ ] **Полный прогон тестов обоих воркспейсов**

Run: `npm test`
Expected: PASS (server + web).

- [ ] **Полная сборка**

Run: `npm run build`
Expected: PASS.

- [ ] **Ручная проверка в UI (dev)**

Run: `npm run dev`, открыть клон оферты:
1. Title по умолчанию = название карточки каталога.
2. Описание: добавить строку «Текст + фото» — два слота бок о бок; «Два фото» — две картинки рядом; «Только текст» — на всю ширину.
3. Сменить раскладку существующей строки — контент сохраняется.
4. Dry-run клона: в шагах нет ошибок `[TEXT,TEXT]`, описание валидно.
