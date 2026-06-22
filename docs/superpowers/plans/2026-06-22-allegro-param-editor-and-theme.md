# Type-aware Allegro parameter editor + 3-state theme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every Allegro category parameter with a control matching its real type (radio/select for single-choice dictionaries, checkboxes for multi-choice, number/range for numeric, text for string), support multi-value overrides (e.g. ports HDMI + USB), and make the theme a 3-state Система/Светлая/Тёмная control that follows the OS in "system" mode.

**Architecture:** The clone override contract changes from `Record<string,string>` to `Record<string,string[]>` (a value-list per parameter). A new `ParametersEditor` renders all `preview.categoryParameters` with type-appropriate controls, seeded from the source offer; only parameters whose working value differs from the source are emitted as overrides (preserving catalog-binding semantics). Theme logic moves to a `ThemePref = 'system' | 'light' | 'dark'` preference resolved against `prefers-color-scheme`, with a live `matchMedia` listener in system mode.

**Tech Stack:** TypeScript, React 18, Vite, Tailwind, Express, Zod, Vitest (jsdom for web).

## Global Constraints

- Schema verified against `developer.allegro.pl/swagger.yaml` (`CategoryParameter` family): four types `dictionary | integer | float | string`; `restrictions.multipleChoices` (dictionary multi-select), `restrictions.range`/`min`/`max`/`precision` (numeric), `restrictions.minLength`/`maxLength`/`allowedNumberOfValues` (string); `options.customValuesEnabled` (only with `ambiguousValueId`); `dictionary[].id` is the value id, `dictionary[].value` is the label.
- Override key is the parameter **name** (case-insensitive match), matching the existing clone pipeline.
- Only changed parameters are emitted as overrides — never the full set (it would force catalog search and break source-card reuse).
- Range parameters: rendered (from/to inputs) but **display-only in v1** — not emitted as overrides.
- UI copy is Russian (matches the app).
- Tests run with Vitest: server `npm run test -w server`, web `npm run test -w web`. Builds: `npm run build -w server`, `npm run build -w web`.
- All work happens on branch `feat/param-editor-and-theme` (already created).

---

### Task 1: Three-state theme

**Files:**
- Modify: `web/src/theme.ts` (full rewrite)
- Create: `web/src/theme.test.ts`
- Modify: `web/src/components/ThemeToggle.tsx` (full rewrite)
- Modify: `web/index.html:8-23` (inline no-flash script)

**Interfaces:**
- Produces: `type ThemePref = 'system' | 'light' | 'dark'`; `type ResolvedTheme = 'light' | 'dark'`; `getStoredPref(): ThemePref`; `getSystemTheme(): ResolvedTheme`; `resolveTheme(pref: ThemePref): ResolvedTheme`; `applyTheme(theme: ResolvedTheme): void`; `setStoredPref(pref: ThemePref): void`.

- [ ] **Step 1: Write the failing test**

Create `web/src/theme.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStoredPref, resolveTheme } from './theme';

describe('resolveTheme', () => {
	it('returns the explicit preference unchanged', () => {
		expect(resolveTheme('light')).toBe('light');
		expect(resolveTheme('dark')).toBe('dark');
	});

	it('resolves "system" via prefers-color-scheme', () => {
		vi.stubGlobal('matchMedia', (q: string) => ({
			matches: q.includes('dark'),
			media: q,
			addEventListener() {},
			removeEventListener() {},
		}));
		expect(resolveTheme('system')).toBe('dark');
	});
});

describe('getStoredPref', () => {
	afterEach(() => localStorage.clear());

	it('defaults to "system" when nothing is stored', () => {
		expect(getStoredPref()).toBe('system');
	});

	it('reads a stored explicit preference', () => {
		localStorage.setItem('allegro.theme', 'dark');
		expect(getStoredPref()).toBe('dark');
	});

	it('falls back to "system" for an unknown stored value', () => {
		localStorage.setItem('allegro.theme', 'banana');
		expect(getStoredPref()).toBe('system');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- theme`
Expected: FAIL — `resolveTheme`/`getStoredPref` not exported (current `theme.ts` has `getInitialTheme`, no `resolveTheme`).

- [ ] **Step 3: Rewrite `web/src/theme.ts`**

```ts
export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'allegro.theme';

export function getStoredPref(): ThemePref {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
	} catch {
		return 'system';
	}
}

export function getSystemTheme(): ResolvedTheme {
	return typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-color-scheme: dark)').matches
		? 'dark'
		: 'light';
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
	return pref === 'system' ? getSystemTheme() : pref;
}

export function applyTheme(theme: ResolvedTheme) {
	const root = document.documentElement;
	root.classList.toggle('dark', theme === 'dark');
	root.style.colorScheme = theme;
}

export function setStoredPref(pref: ThemePref) {
	try {
		localStorage.setItem(STORAGE_KEY, pref);
	} catch {
		/* ignore */
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- theme`
Expected: PASS (5 assertions).

- [ ] **Step 5: Rewrite `web/src/components/ThemeToggle.tsx` as a segmented control**

```tsx
import { useEffect, useState } from 'react';
import {
	applyTheme,
	getStoredPref,
	getSystemTheme,
	resolveTheme,
	setStoredPref,
	type ThemePref,
} from '../theme';

const OPTIONS: Array<{ pref: ThemePref; label: string; title: string }> = [
	{ pref: 'system', label: 'Авто', title: 'Как в системе' },
	{ pref: 'light', label: 'Светлая', title: 'Светлая тема' },
	{ pref: 'dark', label: 'Тёмная', title: 'Тёмная тема' },
];

export function ThemeToggle() {
	const [pref, setPref] = useState<ThemePref>(() => getStoredPref());

	useEffect(() => {
		applyTheme(resolveTheme(pref));
		setStoredPref(pref);
	}, [pref]);

	// In "system" mode, track OS theme changes live.
	useEffect(() => {
		if (pref !== 'system') return;
		const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
		if (!mq) return;
		const onChange = () => applyTheme(getSystemTheme());
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}, [pref]);

	return (
		<div
			role='group'
			aria-label='Тема'
			className='inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5'>
			{OPTIONS.map(o => {
				const active = pref === o.pref;
				return (
					<button
						key={o.pref}
						type='button'
						onClick={() => setPref(o.pref)}
						title={o.title}
						aria-pressed={active}
						className={
							'h-7 px-2 text-[12px] rounded transition ' +
							(active
								? 'bg-flame-tint text-flame font-medium'
								: 'text-ink-muted hover:text-ink')
						}>
						{o.label}
					</button>
				);
			})}
		</div>
	);
}
```

- [ ] **Step 6: Update the inline no-flash script in `web/index.html`**

Replace the `<script>` block at lines 8-23 with:

```html
    <script>
      (function () {
        try {
          var pref = localStorage.getItem('allegro.theme');
          if (pref !== 'light' && pref !== 'dark' && pref !== 'system')
            pref = 'system';
          var sysDark =
            window.matchMedia &&
            window.matchMedia('(prefers-color-scheme: dark)').matches;
          var theme = pref === 'system' ? (sysDark ? 'dark' : 'light') : pref;
          var root = document.documentElement;
          if (theme === 'dark') root.classList.add('dark');
          root.style.colorScheme = theme;
        } catch (e) {}
      })();
    </script>
```

- [ ] **Step 7: Verify the web build compiles**

Run: `npm run build -w web`
Expected: build succeeds (no references to the removed `getInitialTheme`/`Theme`/`getStoredTheme`).

- [ ] **Step 8: Commit**

```bash
git add web/src/theme.ts web/src/theme.test.ts web/src/components/ThemeToggle.tsx web/index.html
git commit -m "feat: 3-state theme (system/light/dark) with live OS following"
```

---

### Task 2: Server multi-value override contract

**Files:**
- Modify: `server/src/core/clone.ts` (CloneOptions type + override-apply loop)
- Modify: `server/src/routes/api.ts:78` (zod `paramOverrides`)
- Modify: `server/src/core/clone.test.ts` (existing overrides → arrays; new multi-value test)

**Interfaces:**
- Produces: `CloneOptions.paramOverrides: Record<string, string[]>`. Each array is the ordered list of values for that parameter (one element for single-value params, several for `multipleChoices`).

- [ ] **Step 1: Update the existing override tests to the array shape, and add a multi-value test (failing)**

In `server/src/core/clone.test.ts`, change every `paramOverrides` value from a string to a one-element array. The occurrences (verbatim → replacement):

- Line ~207: `paramOverrides: { 'Pojemność dysku SSD': '512 GB' },` → `paramOverrides: { 'Pojemność dysku SSD': ['512 GB'] },`
- Line ~250: `paramOverrides: { 'Pojemność dysku SSD': '512 GB' },` → `paramOverrides: { 'Pojemność dysku SSD': ['512 GB'] },`
- Line ~266: `paramOverrides: { 'Pojemność dysku SSD': '512 GB' },` → `paramOverrides: { 'Pojemność dysku SSD': ['512 GB'] },`
- Line ~464: `paramOverrides: { 'Pojemność dysku SSD': '512 GB' },` → `paramOverrides: { 'Pojemność dysku SSD': ['512 GB'] },`

(All other `paramOverrides: {}` are already valid for the new type.)

Then add this test inside the `describe('buildCloneBody', ...)` block (after the "falls back to parameter list" test):

```ts
  it('applies a multi-value override (multipleChoices dictionary) into the product parameters', async () => {
    const steps: Parameters<typeof buildCloneBody>[3] = [];
    const offer: AllegroOffer = {
      ...baseOffer,
      productSet: [
        {
          product: {
            id: 'PROD-256',
            name: 'Lenovo IdeaPad 5',
            category: { id: '491' },
            parameters: [{ id: 'P_PORTS', name: 'Złącza', values: ['USB'] }],
          },
          quantity: { value: 1 },
        },
      ],
    };
    const { body } = await buildCloneBody(
      fakeClient({ searchHits: [] }),
      offer,
      { sourceOfferId: 'src-1', paramOverrides: { 'Złącza': ['USB', 'HDMI'] } },
      steps,
    );
    const ps = (
      body as {
        productSet: Array<{
          product: { parameters?: Array<{ name?: string; values?: string[] }> };
        }>;
      }
    ).productSet;
    const ports = ps[0].product.parameters?.find((p) => p.name === 'Złącza');
    expect(ports?.values).toEqual(['USB', 'HDMI']);
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test -w server`
Expected: TypeScript/assertion failures — `paramOverrides` is typed `Record<string,string>` so the array literals and the multi-value test don't compile/pass yet.

- [ ] **Step 3: Change the `CloneOptions.paramOverrides` type**

In `server/src/core/clone.ts`, update the field (around line 25):

```ts
	/** Map of parameter name (e.g. "Pojemność dysku SSD") → list of new values
	 *  (e.g. ["512 GB"], or ["USB","HDMI"] for a multipleChoices dictionary). */
	paramOverrides: Record<string, string[]>;
```

- [ ] **Step 4: Update the override-application loop in `buildCloneBody`**

In `server/src/core/clone.ts`, replace the loop that starts `for (const [paramName, newValue] of overrideEntries) {` (around line 196) with:

```ts
	for (const [paramName, rawValues] of overrideEntries) {
		const newValues = rawValues.map(v => v.trim()).filter(Boolean);
		if (newValues.length === 0) continue;
		const idx = desiredParams.findIndex(
			p => (p.name ?? '').toLowerCase() === paramName.toLowerCase(),
		);
		if (idx === -1) {
			steps.push({
				level: 'warn',
				message: `Параметр «${paramName}» не найден на источнике - добавлю как новый`,
			});
			desiredParams.push({ id: '', name: paramName, values: newValues });
			oldValues.push({ name: paramName, new: newValues[0] });
		} else {
			// Dictionary params keep the human label in `valuesLabels` and `values` is null —
			// fall back to it so title-substitution can find what to replace ("16 GB" etc.).
			const old =
				desiredParams[idx].valuesLabels?.[0] ?? desiredParams[idx].values?.[0];
			desiredParams[idx] = {
				...desiredParams[idx],
				values: newValues,
				// Drop dictionary id — Allegro will resolve from the value
				valuesIds: undefined,
			};
			oldValues.push({ name: paramName, old, new: newValues[0] });
		}
	}
```

(`overrideEntries` is `Object.entries(options.paramOverrides)`, now typed `[string, string[]][]` — no other change needed there. `buildSearchPhrase`/title use only `oldValues[].new` which is `newValues[0]`.)

- [ ] **Step 5: Update the zod schema in `server/src/routes/api.ts`**

Change line 78:

```ts
  paramOverrides: z.record(z.string(), z.array(z.string())).default({}),
```

- [ ] **Step 6: Run tests + server build to verify pass**

Run: `npm run test -w server`
Expected: PASS, including the new multi-value test.
Run: `npm run build -w server`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add server/src/core/clone.ts server/src/routes/api.ts server/src/core/clone.test.ts
git commit -m "feat: multi-value param override contract (Record<string,string[]>)"
```

---

### Task 3: Web parameter-control helpers

**Files:**
- Create: `web/src/components/paramControls.ts`
- Create: `web/src/components/paramControls.test.ts`
- Modify: `web/src/api.ts:182-188` (`OfferPreview.categoryParameters` → `CategoryParameter[]`)

**Interfaces:**
- Consumes: `CategoryParameter` and `OfferParameter` from `../api`.
- Produces:
  - `type ControlKind = 'dict-single' | 'dict-multi' | 'number' | 'range' | 'text'`
  - `controlKind(p: CategoryParameter): ControlKind`
  - `useSelectForDictionary(p: CategoryParameter): boolean`
  - `allowsCustomValue(p: CategoryParameter): boolean`
  - `findOfferParam(cat: CategoryParameter, offerParams: OfferParameter[]): OfferParameter | undefined`
  - `offerParamCurrentValues(op: OfferParameter | undefined): string[]`
  - `seedParamValues(categoryParameters: CategoryParameter[], offerParameters: OfferParameter[]): Record<string, string[]>`
  - `diffOverrides(working: Record<string,string[]>, seed: Record<string,string[]>): Record<string,string[]>`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/paramControls.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CategoryParameter } from '../api';
import {
	allowsCustomValue,
	controlKind,
	diffOverrides,
	seedParamValues,
} from './paramControls';

const dict = (over: Partial<CategoryParameter> = {}): CategoryParameter => ({
	id: 'P',
	name: 'Złącza',
	type: 'dictionary',
	dictionary: [{ id: '1', value: 'USB' }, { id: '2', value: 'HDMI' }],
	...over,
});

describe('controlKind', () => {
	it('single-choice dictionary → dict-single', () => {
		expect(controlKind(dict({ restrictions: { multipleChoices: false } }))).toBe('dict-single');
	});
	it('multi-choice dictionary → dict-multi', () => {
		expect(controlKind(dict({ restrictions: { multipleChoices: true } }))).toBe('dict-multi');
	});
	it('integer without range → number', () => {
		expect(controlKind({ id: 'I', name: 'RAM', type: 'integer' })).toBe('number');
	});
	it('float with range → range', () => {
		expect(controlKind({ id: 'F', name: 'Waga', type: 'float', restrictions: { range: true } })).toBe('range');
	});
	it('string → text', () => {
		expect(controlKind({ id: 'S', name: 'Kod', type: 'string' })).toBe('text');
	});
});

describe('allowsCustomValue', () => {
	it('true only when customValuesEnabled AND an ambiguousValueId exists', () => {
		expect(allowsCustomValue(dict({ options: { customValuesEnabled: true, ambiguousValueId: '9' } }))).toBe(true);
		expect(allowsCustomValue(dict({ options: { customValuesEnabled: true } }))).toBe(false);
		expect(allowsCustomValue(dict({ options: { customValuesEnabled: false, ambiguousValueId: '9' } }))).toBe(false);
	});
});

describe('seedParamValues', () => {
	it('seeds dictionary labels and numeric values by parameter name', () => {
		const cats: CategoryParameter[] = [
			dict(),
			{ id: 'P_RAM', name: 'Pamięć RAM', type: 'integer', unit: 'GB' },
		];
		const seed = seedParamValues(cats, [
			{ id: 'P', valuesLabels: ['USB'], values: null },
			{ id: 'P_RAM', values: ['16'] },
		]);
		expect(seed['Złącza']).toEqual(['USB']);
		expect(seed['Pamięć RAM']).toEqual(['16']);
	});
});

describe('diffOverrides', () => {
	const seed = { 'Złącza': ['USB'], 'Pamięć RAM': ['16'] };
	it('emits only changed params', () => {
		expect(diffOverrides({ 'Złącza': ['USB'], 'Pamięć RAM': ['32'] }, seed)).toEqual({ 'Pamięć RAM': ['32'] });
	});
	it('treats reordered multi-values as unchanged', () => {
		expect(diffOverrides({ 'Złącza': ['USB', 'HDMI'] }, { 'Złącza': ['HDMI', 'USB'] })).toEqual({});
	});
	it('ignores an emptied value (not an override)', () => {
		expect(diffOverrides({ 'Pamięć RAM': ['  '] }, seed)).toEqual({});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- paramControls`
Expected: FAIL — `./paramControls` does not exist.

- [ ] **Step 3: Create `web/src/components/paramControls.ts`**

```ts
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
```

- [ ] **Step 4: Widen `OfferPreview.categoryParameters` to the rich type**

In `web/src/api.ts`, replace the inline `categoryParameters` array type (lines 182-188) with a reference to the existing rich `CategoryParameter` interface (declared at line 243):

```ts
	categoryParameters: CategoryParameter[];
```

(The runtime data already carries `required`/`unit`/`restrictions` — the server passes the whole parameter object through `/api/offers/:id/preview`. `CategoryParameter` is declared later in the file; a TypeScript `interface` is hoisted, so the forward reference compiles.)

- [ ] **Step 5: Run test + web build to verify pass**

Run: `npm run test -w web -- paramControls`
Expected: PASS.
Run: `npm run build -w web`
Expected: build succeeds (note: `OverridesEditor` still consumes `categoryParameters` via `cp.id`/`cp.name`/`cp.dictionary`, all present on `CategoryParameter`).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/paramControls.ts web/src/components/paramControls.test.ts web/src/api.ts
git commit -m "feat: parameter-control helpers (kind/seed/diff) + richer preview type"
```

---

### Task 4: ParametersEditor component

**Files:**
- Create: `web/src/components/ParametersEditor.tsx`

**Interfaces:**
- Consumes: helpers from `./paramControls`; `OfferPreview`, `CategoryParameter` from `../api`.
- Produces: `export function ParametersEditor(props: { preview: OfferPreview | null; values: Record<string,string[]>; seed: Record<string,string[]>; onChange: (next: Record<string,string[]>) => void }): JSX.Element`

- [ ] **Step 1: Create `web/src/components/ParametersEditor.tsx`**

```tsx
import { useMemo, useState } from 'react';
import type { CategoryParameter, OfferPreview } from '../api';
import {
	allowsCustomValue,
	controlKind,
	useSelectForDictionary,
} from './paramControls';

interface Props {
	preview: OfferPreview | null;
	/** Working values keyed by parameter name. */
	values: Record<string, string[]>;
	/** Current source values keyed by parameter name (for "сейчас" + changed badge). */
	seed: Record<string, string[]>;
	onChange: (next: Record<string, string[]>) => void;
}

function changed(a: string[] = [], b: string[] = []): boolean {
	const ca = a.map(v => v.trim()).filter(Boolean);
	const cb = b.map(v => v.trim()).filter(Boolean);
	if (ca.length !== cb.length) return true;
	const sb = new Set(cb);
	return !ca.every(v => sb.has(v));
}

export function ParametersEditor({ preview, values, seed, onChange }: Props) {
	const params = preview?.categoryParameters ?? [];
	const [filter, setFilter] = useState('');
	const [onlyChanged, setOnlyChanged] = useState(false);

	const setValue = (name: string, next: string[]) =>
		onChange({ ...values, [name]: next });

	const setPreset = (name: string, value: string) => {
		if (!params.some(p => p.name === name)) return;
		onChange({ ...values, [name]: [value] });
	};

	const names = params.map(p => p.name);
	const hasSSD = names.includes('Pojemność dysku SSD');
	const hasRAM = names.includes('Pamięć RAM');

	const visible = useMemo(() => {
		const q = filter.trim().toLowerCase();
		return params.filter(p => {
			if (q && !(p.name ?? '').toLowerCase().includes(q)) return false;
			if (onlyChanged && !changed(values[p.name], seed[p.name])) return false;
			return true;
		});
	}, [params, filter, onlyChanged, values, seed]);

	return (
		<section className='panel'>
			<header className='px-4 h-11 flex items-center justify-between border-b border-border'>
				<span className='label'>Параметры{params.length ? ` (${params.length})` : ''}</span>
				<label className='flex items-center gap-1.5 text-[12px] text-ink-muted'>
					<input
						type='checkbox'
						checked={onlyChanged}
						onChange={e => setOnlyChanged(e.target.checked)}
					/>
					только изменённые
				</label>
			</header>

			{!preview ? (
				<p className='p-4 text-[13px] text-ink-muted'>
					Сначала загрузи оферту — появятся параметры категории.
				</p>
			) : params.length === 0 ? (
				<p className='p-4 text-[13px] text-ink-muted'>
					У категории нет параметров (или категория не определена).
				</p>
			) : (
				<>
					<div className='px-4 pt-3 flex flex-wrap items-center gap-2 border-b border-border-muted pb-3'>
						<input
							className='input h-7 flex-1 min-w-[140px] text-[12px]'
							placeholder='Фильтр по названию'
							value={filter}
							onChange={e => setFilter(e.target.value)}
						/>
						{hasSSD && (
							<Preset onClick={() => setPreset('Pojemność dysku SSD', '512 GB')} label='SSD → 512 ГБ' />
						)}
						{hasSSD && (
							<Preset onClick={() => setPreset('Pojemność dysku SSD', '1 TB')} label='SSD → 1 ТБ' />
						)}
						{hasRAM && (
							<Preset onClick={() => setPreset('Pamięć RAM', '16 GB')} label='RAM → 16 ГБ' />
						)}
						{hasRAM && (
							<Preset onClick={() => setPreset('Pamięć RAM', '32 GB')} label='RAM → 32 ГБ' />
						)}
					</div>

					<div className='p-4 space-y-3'>
						{visible.map(p => (
							<ParamRow
								key={p.id || p.name}
								param={p}
								value={values[p.name] ?? []}
								current={seed[p.name] ?? []}
								onChange={next => setValue(p.name, next)}
							/>
						))}
						{visible.length === 0 && (
							<p className='text-[13px] text-ink-faint'>Ничего не найдено.</p>
						)}
					</div>
				</>
			)}
		</section>
	);
}

function ParamRow({
	param,
	value,
	current,
	onChange,
}: {
	param: CategoryParameter;
	value: string[];
	current: string[];
	onChange: (next: string[]) => void;
}) {
	const kind = controlKind(param);
	const isChanged = changed(value, current);
	const unit = param.unit ? ` ${param.unit}` : '';

	return (
		<div className='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 items-start'>
			<div className='pt-1.5'>
				<div className='text-[13px] text-ink'>
					{param.name}
					{param.required && <span className='text-flame'> *</span>}
				</div>
				<div className='text-[11px] text-ink-faint'>
					сейчас: <span className='text-ink-muted'>{current.join(', ') || '—'}</span>
					{isChanged && (
						<span className='ml-1.5 text-flame'>· изменено</span>
					)}
				</div>
			</div>
			<div className='flex flex-col gap-1.5'>
				{kind === 'dict-multi' && (
					<DictMulti param={param} value={value} onChange={onChange} />
				)}
				{kind === 'dict-single' && (
					<DictSingle param={param} value={value} onChange={onChange} />
				)}
				{kind === 'number' && (
					<NumberInput param={param} value={value} unit={unit} onChange={onChange} />
				)}
				{kind === 'range' && <RangeDisplay current={current} unit={unit} />}
				{kind === 'text' && (
					<input
						className='input'
						maxLength={(param.restrictions as { maxLength?: number })?.maxLength}
						placeholder='Значение'
						value={value[0] ?? ''}
						onChange={e => onChange(e.target.value ? [e.target.value] : [])}
					/>
				)}
			</div>
		</div>
	);
}

function DictMulti({
	param,
	value,
	onChange,
}: {
	param: CategoryParameter;
	value: string[];
	onChange: (next: string[]) => void;
}) {
	const toggle = (label: string) =>
		onChange(value.includes(label) ? value.filter(v => v !== label) : [...value, label]);
	return (
		<div className='flex flex-wrap gap-x-4 gap-y-1.5'>
			{(param.dictionary ?? []).map(d => (
				<label key={d.id ?? d.value} className='flex items-center gap-1.5 text-[13px] text-ink'>
					<input
						type='checkbox'
						checked={value.includes(d.value)}
						onChange={() => toggle(d.value)}
					/>
					{d.value}
				</label>
			))}
		</div>
	);
}

function DictSingle({
	param,
	value,
	onChange,
}: {
	param: CategoryParameter;
	value: string[];
	onChange: (next: string[]) => void;
}) {
	const selected = value[0] ?? '';
	const custom = allowsCustomValue(param);
	const known = (param.dictionary ?? []).some(d => d.value === selected);

	if (useSelectForDictionary(param)) {
		return (
			<select
				className='input cursor-pointer'
				value={known || !selected ? selected : '__custom__'}
				onChange={e =>
					onChange(e.target.value && e.target.value !== '__custom__' ? [e.target.value] : [])
				}>
				<option value=''>— не задано —</option>
				{(param.dictionary ?? []).map(d => (
					<option key={d.id ?? d.value} value={d.value}>
						{d.value}
					</option>
				))}
			</select>
		);
	}

	return (
		<div className='flex flex-col gap-1.5'>
			<div className='flex flex-wrap gap-x-4 gap-y-1.5'>
				{(param.dictionary ?? []).map(d => (
					<label key={d.id ?? d.value} className='flex items-center gap-1.5 text-[13px] text-ink'>
						<input
							type='radio'
							name={`p-${param.id}`}
							checked={selected === d.value}
							onChange={() => onChange([d.value])}
						/>
						{d.value}
					</label>
				))}
			</div>
			{custom && (
				<input
					className='input'
					placeholder='Своё значение'
					value={known ? '' : selected}
					onChange={e => onChange(e.target.value ? [e.target.value] : [])}
				/>
			)}
		</div>
	);
}

function NumberInput({
	param,
	value,
	unit,
	onChange,
}: {
	param: CategoryParameter;
	value: string[];
	unit: string;
	onChange: (next: string[]) => void;
}) {
	const r = (param.restrictions ?? {}) as {
		min?: number;
		max?: number;
		precision?: number;
	};
	const step = param.type === 'float' && r.precision ? 1 / 10 ** r.precision : 1;
	return (
		<div className='flex items-center gap-2'>
			<input
				className='input w-40'
				type='number'
				min={r.min}
				max={r.max}
				step={step}
				placeholder='Значение'
				value={value[0] ?? ''}
				onChange={e => onChange(e.target.value ? [e.target.value] : [])}
			/>
			{unit && <span className='text-[12px] text-ink-muted'>{unit.trim()}</span>}
			{(r.min !== undefined || r.max !== undefined) && (
				<span className='text-[11px] text-ink-faint'>
					{r.min ?? '…'}–{r.max ?? '…'}
				</span>
			)}
		</div>
	);
}

function RangeDisplay({ current, unit }: { current: string[]; unit: string }) {
	return (
		<div className='text-[12px] text-ink-muted'>
			{current.length ? `${current.join(' – ')}${unit}` : '—'}
			<span className='ml-2 text-ink-faint'>(диапазон — только просмотр)</span>
		</div>
	);
}

function Preset({ onClick, label }: { onClick: () => void; label: string }) {
	return (
		<button
			type='button'
			onClick={onClick}
			className='text-[12px] font-medium px-2.5 h-7 border border-border rounded-full bg-card text-ink-muted hover:border-flame hover:text-flame hover:bg-flame-tint transition'>
			{label}
		</button>
	);
}
```

- [ ] **Step 2: Verify the web build compiles**

Run: `npm run build -w web`
Expected: build succeeds. (Component is not yet rendered anywhere; it compiles standalone.)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ParametersEditor.tsx
git commit -m "feat: ParametersEditor — type-aware controls for all category params"
```

---

### Task 5: Wire ParametersEditor into App; flip the web contract; remove OverridesEditor

**Files:**
- Modify: `web/src/api.ts:129-157` (`ClonePayload.paramOverrides`)
- Modify: `web/src/components/shortcodes.ts:42-69` (`VarMapInput.overrides` + `buildVarMap`)
- Modify: `web/src/components/shortcodes.test.ts:48-55` (override test → array)
- Modify: `web/src/App.tsx` (imports, state, seed, cleanedOverrides, render)
- Delete: `web/src/components/OverridesEditor.tsx`

**Interfaces:**
- Consumes: `ParametersEditor` (Task 4); `seedParamValues`, `diffOverrides` (Task 3); the server array contract (Task 2).
- Produces: nothing new — this is the integration task.

- [ ] **Step 1: Update the `buildVarMap` override test (failing)**

In `web/src/components/shortcodes.test.ts`, change the "lets an override win" test (lines ~48-55):

```ts
	it('lets an override win over the parameter value', () => {
		const map = buildVarMap({
			parameters: [{ id: 'P', name: 'SSD', values: ['256 GB'] }],
			overrides: { SSD: ['512 GB'] },
		});
		expect(map.get('SSD')).toBe('512 GB');
	});
```

(The other `overrides: {}` cases remain valid.)

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -w web -- shortcodes`
Expected: FAIL — `overrides` is typed `Record<string,string>`, so `{ SSD: ['512 GB'] }` does not type-check.

- [ ] **Step 3: Update `VarMapInput.overrides` and `buildVarMap`**

In `web/src/components/shortcodes.ts`, change the interface field (line ~46):

```ts
  /** Parameter-name -> override values. A non-empty override wins over the
   *  source value; empty/blank values are ignored ("not overridden"). */
  overrides: Record<string, string[]>;
```

and the override loop inside `buildVarMap` (lines ~62-65):

```ts
  for (const [name, values] of Object.entries(input.overrides)) {
    const k = name.trim();
    const joined = values.map((v) => v.trim()).filter(Boolean).join(', ');
    if (k && joined) map.set(k, joined);
  }
```

- [ ] **Step 4: Update `web/src/api.ts` `ClonePayload.paramOverrides`**

Change line ~131:

```ts
	paramOverrides: Record<string, string[]>;
```

- [ ] **Step 5: Rewire `web/src/App.tsx`**

5a. Imports — replace the `OverridesEditor` import block (lines 30-33) with:

```tsx
import { ParametersEditor } from './components/ParametersEditor';
import { diffOverrides, seedParamValues } from './components/paramControls';
```

5b. State — replace the overrides state (line 84):

```tsx
	const [paramValues, setParamValues] = useState<Record<string, string[]>>({});
```

5c. Seed + diff — replace the `cleanedOverrides` memo (lines 184-192) with:

```tsx
	const paramSeed = useMemo(
		() =>
			seedParamValues(
				preview?.categoryParameters ?? [],
				preview?.parameters ?? [],
			),
		[preview],
	);

	const cleanedOverrides = useMemo(
		() => diffOverrides(paramValues, paramSeed),
		[paramValues, paramSeed],
	);
```

5d. Reset working values on offer load — add to the reset effect keyed on `preview?.id` (the one at lines 216-222 that resets the "user edited" flags), as its first statement:

```tsx
		setParamValues(
			seedParamValues(
				preview?.categoryParameters ?? [],
				preview?.parameters ?? [],
			),
		);
```

5e. Render — replace the `OverridesEditor` block (lines 569-575):

```tsx
							{!targetProduct && (
								<ParametersEditor
									preview={preview}
									values={paramValues}
									seed={paramSeed}
									onChange={setParamValues}
								/>
							)}
```

- [ ] **Step 6: Delete the old editor**

```bash
git rm web/src/components/OverridesEditor.tsx
```

- [ ] **Step 7: Run web tests + build to verify pass**

Run: `npm run test -w web`
Expected: PASS (theme, paramControls, shortcodes, and existing suites).
Run: `npm run build -w web`
Expected: build succeeds with no remaining references to `OverridesEditor` / `ParamOverride` / `cleanedOverrides` as a string-map.

- [ ] **Step 8: Full build + server tests (integration sanity)**

Run: `npm run build`
Run: `npm run test -w server`
Expected: both succeed.

- [ ] **Step 9: Commit**

```bash
git add web/src/api.ts web/src/components/shortcodes.ts web/src/components/shortcodes.test.ts web/src/App.tsx
git commit -m "feat: render all category params via ParametersEditor; drop OverridesEditor"
```

---

## Manual verification (after Task 5)

Run `npm run dev`, connect an account, then:

1. **Theme:** the header shows a 3-button Авто/Светлая/Тёмная control. With Авто selected, toggling the OS dark mode flips the app live. Светлая/Тёмная pin the theme; the choice persists across reload.
2. **Parameters:** load an offer in a laptop category. Confirm:
   - a multi-choice dictionary (e.g. "Złącza"/ports) renders **checkboxes** and you can tick HDMI **and** USB;
   - a single-choice dictionary with few options renders **radio**, with many options renders a **select**;
   - integer/float params render a **number** input with unit + min/max;
   - a `string` param renders a text input;
   - "сейчас: …" shows the source value, "· изменено" appears when edited, and the "только изменённые" toggle filters the list.
3. **Clone preview:** change a multi-choice param (HDMI + USB) and a numeric param, run the dry-run/preview, and confirm the produced body's `productSet[0].product.parameters` carries the multi-value list and the numeric change. Unchanged params are NOT in the override set.

## Self-review notes

- **Spec coverage:** theme 3-state (Task 1); multi-value contract server (Task 2) + web (Tasks 3/5); type-aware controls dict-single/dict-multi/number/range/text (Tasks 3/4); custom-value gated by `ambiguousValueId` (Task 3 `allowsCustomValue` + Task 4 `DictSingle`); emit-only-changed (Task 3 `diffOverrides` + Task 5); range display-only (Task 4 `RangeDisplay`, not emitted because seed==working when untouched and there is no range editor). `dependsOnParameterId` cascade and variant params intentionally out of scope.
- **Deviation from spec:** multi-value **string** entry (`allowedNumberOfValues > 1`) is rendered as a single text field in v1 (the array contract still supports it; the multi-input UI is deferred). This is narrower than the spec's table note and is the only deviation.
- **Type consistency:** `Record<string,string[]>` is used end to end — `CloneOptions.paramOverrides` (server), zod `z.array(z.string())`, `ClonePayload.paramOverrides` (web), `VarMapInput.overrides`, `paramValues`/`paramSeed`/`cleanedOverrides` (App), and the `ParametersEditor` `values`/`seed`/`onChange` props. Helper names match across Tasks 3-5 (`seedParamValues`, `diffOverrides`, `controlKind`, `allowsCustomValue`, `useSelectForDictionary`).
