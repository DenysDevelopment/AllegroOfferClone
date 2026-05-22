# Description Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save a whole offer description as a reusable named template, and embed offer-parameter variables that render as live "chips" (key + value visible) in the editor and flatten to plain text on publish.

**Architecture:** Server stores templates in a global JSON file (`data/description-templates.json`) via a `TemplateStore` class, exposed through CRUD routes. Web keeps description state in token form (`{{key}}`); the rich-text editor renders tokens as non-editable chip spans showing the resolved value of the current offer's parameters; on clone, tokens flatten to escaped plain text.

**Tech Stack:** TypeScript, Express + Zod (server), React 18 + Vite + Tailwind (web), vitest (tests).

Spec: `docs/superpowers/specs/2026-05-22-description-templates-design.md`

---

## File Structure

**Created:**
- `server/src/core/templates.ts` — `TemplateStore` (file-backed CRUD), `DescriptionTemplate` type.
- `server/src/core/templates.test.ts` — `TemplateStore` tests.
- `web/src/components/shortcodes.ts` — pure variable utilities (var map, token↔chip, flatten).
- `web/src/components/shortcodes.test.ts` — variable utility tests.
- `web/vitest.config.ts` — vitest config (jsdom environment).

**Modified:**
- `server/src/routes/api.ts` — add `dataDir` param, mount `/description-templates` CRUD routes.
- `server/src/index.ts:32` — pass `multi.dataDir` to `apiRouter`.
- `web/src/api.ts` — `DescriptionTemplate` type + `descriptionTemplates` client methods.
- `web/src/index.css` — `.var-chip` styles.
- `web/src/components/DescriptionEditor.tsx` — "Шаблоны" header block; chips + variable picker in `RichTextarea`.
- `web/src/App.tsx` — load templates, build var map, wire template actions, flatten on payload.
- `web/package.json` — vitest devDeps + `test` script.
- `package.json` — root `test` script runs all workspaces.

---

## Task 1: Server — TemplateStore

**Files:**
- Create: `server/src/core/templates.ts`
- Test: `server/src/core/templates.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/core/templates.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TemplateStore } from './templates.js';

let dir: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tpl-'));
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

const sampleSections = [
  { items: [{ type: 'TEXT' as const, content: 'SSD {{SSD}}' }] },
];

describe('TemplateStore', () => {
  it('returns an empty list when the file does not exist', async () => {
    const store = new TemplateStore(path.join(dir, 'templates.json'));
    expect(await store.list()).toEqual([]);
  });

  it('creates a template with an id and timestamps', async () => {
    const store = new TemplateStore(path.join(dir, 'templates.json'));
    const t = await store.create('Laptop base', sampleSections);
    expect(t.id).toMatch(/.+/);
    expect(t.name).toBe('Laptop base');
    expect(t.sections).toEqual(sampleSections);
    expect(t.createdAt).toBeGreaterThan(0);
    expect(t.updatedAt).toBe(t.createdAt);
  });

  it('persists created templates across store instances', async () => {
    const file = path.join(dir, 'templates.json');
    await new TemplateStore(file).create('Laptop base', sampleSections);
    const list = await new TemplateStore(file).list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Laptop base');
  });

  it('updates name and sections, bumps updatedAt', async () => {
    const file = path.join(dir, 'templates.json');
    const store = new TemplateStore(file);
    const t = await store.create('Old', sampleSections);
    const updated = await store.update(t.id, { name: 'New' });
    expect(updated?.name).toBe('New');
    expect(updated?.createdAt).toBe(t.createdAt);
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(t.createdAt);
  });

  it('returns null when updating a missing id', async () => {
    const store = new TemplateStore(path.join(dir, 'templates.json'));
    expect(await store.update('nope', { name: 'x' })).toBeNull();
  });

  it('removes a template and reports whether it existed', async () => {
    const file = path.join(dir, 'templates.json');
    const store = new TemplateStore(file);
    const t = await store.create('Doomed', sampleSections);
    expect(await store.remove(t.id)).toBe(true);
    expect(await store.remove(t.id)).toBe(false);
    expect(await store.list()).toEqual([]);
  });

  it('writes atomically (no leftover .tmp file)', async () => {
    const file = path.join(dir, 'templates.json');
    await new TemplateStore(file).create('A', sampleSections);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- templates`
Expected: FAIL — cannot find module `./templates.js`.

- [ ] **Step 3: Write the implementation**

Create `server/src/core/templates.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface DescriptionTemplateItem {
  type: 'TEXT' | 'IMAGE';
  content?: string;
  url?: string;
}

export interface DescriptionTemplateSection {
  items: DescriptionTemplateItem[];
}

export interface DescriptionTemplate {
  id: string;
  name: string;
  sections: DescriptionTemplateSection[];
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
}

/**
 * File-backed store for description templates. Global (not per-account):
 * a single JSON array persisted with an atomic tmp+rename write, mirroring
 * TokenStore's persistence approach.
 */
export class TemplateStore {
  constructor(private readonly file: string) {}

  async list(): Promise<DescriptionTemplate[]> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as DescriptionTemplate[]) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async create(
    name: string,
    sections: DescriptionTemplateSection[],
  ): Promise<DescriptionTemplate> {
    const now = Date.now();
    const template: DescriptionTemplate = {
      id: randomUUID(),
      name,
      sections,
      createdAt: now,
      updatedAt: now,
    };
    const all = await this.list();
    all.push(template);
    await this.writeAll(all);
    return template;
  }

  async update(
    id: string,
    patch: { name?: string; sections?: DescriptionTemplateSection[] },
  ): Promise<DescriptionTemplate | null> {
    const all = await this.list();
    const idx = all.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    const next: DescriptionTemplate = {
      ...all[idx],
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.sections !== undefined ? { sections: patch.sections } : {}),
      updatedAt: Date.now(),
    };
    all[idx] = next;
    await this.writeAll(all);
    return next;
  }

  async remove(id: string): Promise<boolean> {
    const all = await this.list();
    const next = all.filter((t) => t.id !== id);
    if (next.length === all.length) return false;
    await this.writeAll(next);
    return true;
  }

  private async writeAll(all: DescriptionTemplate[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server -- templates`
Expected: PASS — 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/core/templates.ts server/src/core/templates.test.ts
git commit -m "feat: TemplateStore — file-backed description-template CRUD"
```

---

## Task 2: Server — Description-template API routes

**Files:**
- Modify: `server/src/routes/api.ts`
- Modify: `server/src/index.ts:32`

- [ ] **Step 1: Add the `dataDir` parameter to `apiRouter`**

In `server/src/routes/api.ts`, change the function signature at line 63:

```ts
export function apiRouter(registry: AccountRegistry, dataDir: string): Router {
```

- [ ] **Step 2: Add the import and TemplateStore instance**

At the top of `server/src/routes/api.ts`, add to the imports:

```ts
import path from 'node:path';
import { TemplateStore } from '../core/templates.js';
```

Immediately after `const r = Router();` (line 64), add:

```ts
  const templateStore = new TemplateStore(
    path.join(dataDir, 'description-templates.json'),
  );
```

- [ ] **Step 3: Add the template schema**

In `server/src/routes/api.ts`, after the existing `descriptionSchema` declaration (around line 14), add:

```ts
const templateCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  sections: descriptionSchema.shape.sections,
});

const templateUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    sections: descriptionSchema.shape.sections.optional(),
  })
  .refine((p) => p.name !== undefined || p.sections !== undefined, {
    message: 'at least one of name, sections is required',
  });
```

- [ ] **Step 4: Add the CRUD routes**

In `server/src/routes/api.ts`, immediately before the final `return r;` (line 324), add:

```ts
  // --- description templates (global, account-independent) ---

  r.get('/description-templates', async (_req, res, next) => {
    try {
      res.json({ templates: await templateStore.list() });
    } catch (e) {
      next(e);
    }
  });

  r.post('/description-templates', async (req, res, next) => {
    const parsed = templateCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'VALIDATION', details: parsed.error.format() });
    }
    try {
      const created = await templateStore.create(
        parsed.data.name,
        parsed.data.sections,
      );
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  });

  r.put('/description-templates/:id', async (req, res, next) => {
    const parsed = templateUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'VALIDATION', details: parsed.error.format() });
    }
    try {
      const updated = await templateStore.update(req.params.id, parsed.data);
      if (!updated) {
        return res.status(404).json({ error: 'NOT_FOUND' });
      }
      res.json(updated);
    } catch (e) {
      next(e);
    }
  });

  r.delete('/description-templates/:id', async (req, res, next) => {
    try {
      const existed = await templateStore.remove(req.params.id);
      if (!existed) {
        return res.status(404).json({ error: 'NOT_FOUND' });
      }
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });
```

Note: these routes sit below `r.use(pickAccount)` (line 89) but the `pickAccount` middleware only resolves an account when present — these routes never touch `req.allegro`, so account context is irrelevant.

- [ ] **Step 5: Pass `dataDir` from index.ts**

In `server/src/index.ts`, change line 32 from:

```ts
  app.use('/api', apiRouter(registry));
```

to:

```ts
  app.use('/api', apiRouter(registry, multi.dataDir));
```

- [ ] **Step 6: Verify the server compiles and routes work**

The dev server (`npm run dev`) auto-reloads via `tsx watch`. Verify with curl:

```bash
curl -s -X POST http://localhost:3000/api/description-templates \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","sections":[{"items":[{"type":"TEXT","content":"hi {{SSD}}"}]}]}'
curl -s http://localhost:3000/api/description-templates
```

Expected: first call returns the created template JSON with an `id`; second returns `{"templates":[...]}` containing it. Then delete it:

```bash
# replace <id> with the id from above
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:3000/api/description-templates/<id>
```

Expected: `204`. Confirm `data/description-templates.json` exists and is now `[]`.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/api.ts server/src/index.ts
git commit -m "feat: /api/description-templates CRUD routes"
```

---

## Task 3: Web — vitest setup

**Files:**
- Create: `web/vitest.config.ts`
- Modify: `web/package.json`
- Modify: `package.json` (root)

- [ ] **Step 1: Install vitest and jsdom in the web workspace**

Run:

```bash
npm install -D -w web vitest@^2.1.5 jsdom@^25.0.0
```

Expected: `web/package.json` gains `vitest` and `jsdom` in `devDependencies`.

- [ ] **Step 2: Create the vitest config**

Create `web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

- [ ] **Step 3: Add the `test` script to web/package.json**

In `web/package.json`, add to `"scripts"`:

```json
    "test": "vitest run"
```

- [ ] **Step 4: Make the root `test` script run all workspaces**

In the root `package.json`, change:

```json
    "test": "npm run test -w server"
```

to:

```json
    "test": "npm run test --workspaces --if-present"
```

- [ ] **Step 5: Verify the setup with a smoke test**

Create a temporary file `web/src/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('vitest setup', () => {
  it('runs in a jsdom environment', () => {
    expect(typeof document).toBe('object');
    expect(document.createElement('div')).toBeTruthy();
  });
});
```

Run: `npm run test -w web`
Expected: PASS — 1 test. Then delete the smoke file:

```bash
rm web/src/smoke.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/vitest.config.ts package.json package-lock.json
git commit -m "chore: vitest + jsdom test runner for the web workspace"
```

---

## Task 4: Web — shortcode utilities

**Files:**
- Create: `web/src/components/shortcodes.ts`
- Test: `web/src/components/shortcodes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/shortcodes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { OfferParameter } from '../api';
import {
  buildVarMap,
  chipsHtmlToTokens,
  escapeHtml,
  flattenVars,
  tokensToChipsHtml,
} from './shortcodes';

const param = (name: string, p: Partial<OfferParameter> = {}): OfferParameter => ({
  id: name,
  name,
  values: null,
  valuesLabels: null,
  valuesIds: null,
  unit: null,
  ...p,
});

describe('buildVarMap', () => {
  it('maps parameter names to display values', () => {
    const map = buildVarMap({
      parameters: [param('SSD', { values: ['512'], unit: 'GB' })],
      overrides: {},
    });
    expect(map.get('SSD')).toBe('512 GB');
  });

  it('prefers valuesLabels over raw values', () => {
    const map = buildVarMap({
      parameters: [param('RAM', { values: ['16'], valuesLabels: ['16 GB'] })],
      overrides: {},
    });
    expect(map.get('RAM')).toBe('16 GB');
  });

  it('lets an override win over the parameter value', () => {
    const map = buildVarMap({
      parameters: [param('SSD', { values: ['256'], unit: 'GB' })],
      overrides: { SSD: '512 GB' },
    });
    expect(map.get('SSD')).toBe('512 GB');
  });

  it('adds @title and @price built-ins', () => {
    const map = buildVarMap({
      parameters: [],
      overrides: {},
      title: 'Laptop X',
      price: '1999.00',
    });
    expect(map.get('@title')).toBe('Laptop X');
    expect(map.get('@price')).toBe('1999.00');
  });
});

describe('escapeHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml('a < b & "c"')).toBe('a &lt; b &amp; &quot;c&quot;');
  });
});

describe('tokensToChipsHtml', () => {
  it('renders a known token as a chip with key and value', () => {
    const html = tokensToChipsHtml('SSD: {{SSD}}', new Map([['SSD', '512 GB']]));
    expect(html).toContain('data-var-key="SSD"');
    expect(html).toContain('contenteditable="false"');
    expect(html).toContain('SSD · 512 GB');
    expect(html).not.toContain('var-chip--missing');
  });

  it('marks an unknown token as missing', () => {
    const html = tokensToChipsHtml('{{Nope}}', new Map());
    expect(html).toContain('var-chip--missing');
    expect(html).toContain('data-var-key="Nope"');
  });

  it('escapes the resolved value', () => {
    const html = tokensToChipsHtml('{{X}}', new Map([['X', '<b>']]));
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });
});

describe('chipsHtmlToTokens', () => {
  it('converts chip spans back to tokens', () => {
    const chips = tokensToChipsHtml('A {{SSD}} B', new Map([['SSD', '512 GB']]));
    expect(chipsHtmlToTokens(chips)).toBe('A {{SSD}} B');
  });

  it('leaves plain text untouched', () => {
    expect(chipsHtmlToTokens('<p>plain</p>')).toBe('<p>plain</p>');
  });
});

describe('flattenVars', () => {
  it('replaces tokens in TEXT items with escaped values', () => {
    const result = flattenVars(
      { sections: [{ items: [{ type: 'TEXT', content: 'SSD {{SSD}}' }] }] },
      new Map([['SSD', '512 GB']]),
    );
    expect(result.sections.sections[0].items[0]).toEqual({
      type: 'TEXT',
      content: 'SSD 512 GB',
    });
    expect(result.unresolved).toEqual([]);
  });

  it('leaves unresolved tokens and reports their keys', () => {
    const result = flattenVars(
      { sections: [{ items: [{ type: 'TEXT', content: '{{Gone}}' }] }] },
      new Map(),
    );
    expect(result.sections.sections[0].items[0].content).toBe('{{Gone}}');
    expect(result.unresolved).toEqual(['Gone']);
  });

  it('does not touch IMAGE items', () => {
    const result = flattenVars(
      { sections: [{ items: [{ type: 'IMAGE', url: 'http://x/y.jpg' }] }] },
      new Map(),
    );
    expect(result.sections.sections[0].items[0]).toEqual({
      type: 'IMAGE',
      url: 'http://x/y.jpg',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- shortcodes`
Expected: FAIL — cannot find module `./shortcodes`.

- [ ] **Step 3: Write the implementation**

Create `web/src/components/shortcodes.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- shortcodes`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/shortcodes.ts web/src/components/shortcodes.test.ts
git commit -m "feat: shortcode utilities — var map, token<->chip, flatten"
```

---

## Task 5: Web — API client for templates

**Files:**
- Modify: `web/src/api.ts`

- [ ] **Step 1: Add the `DescriptionTemplate` type**

In `web/src/api.ts`, immediately after the `DescriptionSections` interface (line 45), add:

```ts
export interface DescriptionTemplate {
  id: string;
  name: string;
  sections: DescriptionSections['sections'];
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 2: Add the client methods**

In `web/src/api.ts`, inside the `api` object, immediately before the closing `};` of the object (after the `uploadImageBinary` method, around line 278), add:

```ts
  descriptionTemplates: {
    list: () =>
      http<{ templates: DescriptionTemplate[] }>('/api/description-templates'),
    create: (name: string, sections: DescriptionSections['sections']) =>
      http<DescriptionTemplate>('/api/description-templates', {
        json: { name, sections },
      }),
    update: (
      id: string,
      patch: { name?: string; sections?: DescriptionSections['sections'] },
    ) =>
      http<DescriptionTemplate>(
        `/api/description-templates/${encodeURIComponent(id)}`,
        { method: 'PUT', json: patch },
      ),
    remove: (id: string) =>
      http<null>(`/api/description-templates/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
  },
```

Note: `uploadImageBinary` is an `async` arrow ending in `},` — insert the block after it, before the final `};`.

- [ ] **Step 3: Verify it type-checks**

Run: `npm run build -w web`
Expected: build succeeds (no TypeScript errors).

- [ ] **Step 4: Commit**

```bash
git add web/src/api.ts
git commit -m "feat: descriptionTemplates client in web api"
```

---

## Task 6: Web — chip styles

**Files:**
- Modify: `web/src/index.css`

- [ ] **Step 1: Add `.var-chip` styles**

In `web/src/index.css`, inside the `@layer components` block, immediately after the existing `.chip { ... }` rule (around line 164, before the closing `}` of the layer), add:

```css
  .var-chip {
    @apply inline-flex items-center align-baseline h-5 px-1.5 mx-0.5
           text-[11px] font-medium leading-none
           border border-flame-ring bg-flame-tint text-flame
           rounded select-none whitespace-nowrap cursor-default;
  }
  .var-chip--missing {
    @apply border-border-strong bg-soft text-ink-faint;
  }
```

- [ ] **Step 2: Verify the build**

Run: `npm run build -w web`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/index.css
git commit -m "style: var-chip styles for description variables"
```

---

## Task 7: Web — chips and variable picker in RichTextarea

**Files:**
- Modify: `web/src/components/DescriptionEditor.tsx`

The `RichTextarea` component currently treats `value` as raw HTML. After this task it treats `value` as token-form HTML (`{{key}}`), renders tokens as chips for display, and serialises chips back to tokens on every emit. It also gains a "+ Переменная" toolbar control.

- [ ] **Step 1: Add imports and extend Props**

At the top of `web/src/components/DescriptionEditor.tsx`, change the imports:

```ts
import { useEffect, useRef, useState } from 'react';
import type { DescriptionItem, DescriptionSections } from '../api';
import { chipHtml, chipsHtmlToTokens, tokensToChipsHtml } from './shortcodes';
```

In the `Props` interface for `DescriptionEditor`, add:

```ts
	/** key -> resolved value for offer-parameter variables. */
	varMap: Map<string, string>;
```

In the `DescriptionEditor` function signature destructuring, add `varMap`:

```ts
export function DescriptionEditor({
	value,
	onChange,
	dirty,
	onReset,
	varMap,
}: Props) {
```

- [ ] **Step 2: Pass `varMap` to each `RichTextarea`**

In `DescriptionEditor`, find the `<RichTextarea ... />` usage and add the `varMap` prop:

```tsx
									<RichTextarea
										value={it.content}
										onChange={v => updateItem(sIdx, iIdx, { content: v })}
										varMap={varMap}
									/>
```

- [ ] **Step 3: Rewrite the `RichTextarea` component**

Replace the entire `RichTextarea` function (from its `function RichTextarea({` declaration to its closing `}`) with:

```tsx
/**
 * WYSIWYG-редактор: contentEditable + тулбар на execCommand.
 * `value` хранится в токен-форме (`{{ключ}}`); внутри DOM токены рисуются
 * как неделимые чип-спаны со значением переменной. При emit чипы
 * сериализуются обратно в токены, наружу компонент всегда отдаёт токен-форму.
 */
function RichTextarea({
	value,
	onChange,
	varMap,
}: {
	value: string;
	onChange: (next: string) => void;
	varMap: Map<string, string>;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const lastEmittedRef = useRef<string>(value);
	const [varMenuOpen, setVarMenuOpen] = useState(false);

	// Initial mount: write incoming HTML once. Configure execCommand to emit tags.
	useEffect(() => {
		try {
			document.execCommand('styleWithCSS', false, 'false');
			document.execCommand('defaultParagraphSeparator', false, 'p');
		} catch {
			/* legacy API; ignored if unsupported */
		}
	}, []);

	// External value change (reset / template apply): render tokens as chips.
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (value !== lastEmittedRef.current) {
			el.innerHTML = tokensToChipsHtml(value, varMap);
			lastEmittedRef.current = value;
		}
	}, [value, varMap]);

	// varMap changed (e.g. an override edited): refresh chip labels in place
	// without rewriting innerHTML, so the caret is not disturbed.
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		for (const chip of Array.from(el.querySelectorAll('[data-var-key]'))) {
			const key = chip.getAttribute('data-var-key') ?? '';
			const tmp = document.createElement('div');
			tmp.innerHTML = chipHtml(key, varMap);
			const fresh = tmp.firstElementChild;
			if (fresh) {
				chip.className = fresh.className;
				chip.textContent = fresh.textContent;
			}
		}
	}, [varMap]);

	const emit = () => {
		const el = ref.current;
		if (!el) return;
		const tokenHtml = chipsHtmlToTokens(el.innerHTML);
		lastEmittedRef.current = tokenHtml;
		onChange(tokenHtml);
	};

	// On blur, additionally convert any manually typed {{...}} into chips.
	const emitAndRenderChips = () => {
		const el = ref.current;
		if (!el) return;
		const tokenHtml = chipsHtmlToTokens(el.innerHTML);
		lastEmittedRef.current = tokenHtml;
		el.innerHTML = tokensToChipsHtml(tokenHtml, varMap);
		onChange(tokenHtml);
	};

	const exec = (cmd: string, arg?: string) => {
		ref.current?.focus();
		try {
			document.execCommand(cmd, false, arg);
		} catch {
			/* unsupported in some browsers; ignored */
		}
		emit();
	};

	const insertVariable = (key: string) => {
		const el = ref.current;
		if (!el) return;
		el.focus();
		try {
			document.execCommand('insertHTML', false, chipHtml(key, varMap) + '&nbsp;');
		} catch {
			/* ignored */
		}
		setVarMenuOpen(false);
		emit();
	};

	const Btn = ({
		label,
		title,
		onClick,
	}: {
		label: React.ReactNode;
		title: string;
		onClick: () => void;
	}) => (
		<button
			type='button'
			onMouseDown={e => e.preventDefault()}
			onClick={onClick}
			title={title}
			className='h-7 px-2 text-[11px] font-medium border-r border-border last:border-r-0 bg-card text-ink-muted hover:text-ink hover:bg-soft transition'>
			{label}
		</button>
	);

	const varKeys = Array.from(varMap.keys());

	return (
		<div className='space-y-1.5'>
			<div className='flex items-start gap-1.5'>
				<div className='flex border border-border rounded-md overflow-hidden w-fit'>
					<Btn
						label={<span className='font-bold'>B</span>}
						title='Полужирный (Ctrl+B)'
						onClick={() => exec('bold')}
					/>
					<Btn
						label='H1'
						title='Заголовок 1'
						onClick={() => exec('formatBlock', 'h1')}
					/>
					<Btn
						label='H2'
						title='Заголовок 2'
						onClick={() => exec('formatBlock', 'h2')}
					/>
					<Btn
						label='¶'
						title='Параграф'
						onClick={() => exec('formatBlock', 'p')}
					/>
					<Btn
						label='UL'
						title='Маркированный список'
						onClick={() => exec('insertUnorderedList')}
					/>
					<Btn
						label='OL'
						title='Нумерованный список'
						onClick={() => exec('insertOrderedList')}
					/>
					<Btn
						label='⨯'
						title='Снять форматирование'
						onClick={() => exec('removeFormat')}
					/>
				</div>

				<div className='relative'>
					<button
						type='button'
						onMouseDown={e => e.preventDefault()}
						onClick={() => setVarMenuOpen(o => !o)}
						disabled={varKeys.length === 0}
						title='Вставить переменную'
						className='btn btn-ghost h-7 px-2 text-[11px] border border-border disabled:opacity-40'>
						+ Переменная
					</button>
					{varMenuOpen && varKeys.length > 0 && (
						<div className='absolute z-20 mt-1 max-h-64 w-64 overflow-auto rounded-md border border-border bg-card shadow-lg'>
							{varKeys.map(key => (
								<button
									key={key}
									type='button'
									onMouseDown={e => e.preventDefault()}
									onClick={() => insertVariable(key)}
									className='flex w-full items-center justify-between gap-2 px-2 h-8 text-left text-[12px] hover:bg-soft'>
									<span className='font-medium text-ink truncate'>{key}</span>
									<span className='text-ink-faint truncate'>
										{varMap.get(key) || '—'}
									</span>
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			<div
				ref={ref}
				contentEditable
				suppressContentEditableWarning
				onInput={emit}
				onBlur={emitAndRenderChips}
				onPaste={e => {
					// Paste as plain text to avoid copying disallowed inline styles / scripts.
					e.preventDefault();
					const text = e.clipboardData.getData('text/plain');
					document.execCommand('insertText', false, text);
				}}
				className={`border border-border rounded-md p-3 bg-card min-h-[160px] focus:outline-none focus:ring-1 focus:ring-flame/40 ${RENDERED_HTML_CLASS}`}
				data-placeholder='Текст описания. Выдели часть и кликни кнопку для форматирования.'
			/>
		</div>
	);
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build -w web`
Expected: build succeeds. (App.tsx will still error because `DescriptionEditor` now requires `varMap` — that is fixed in Task 9. If running this task standalone, expect that one error; it resolves after Task 9.)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/DescriptionEditor.tsx
git commit -m "feat: variable chips + picker in description RichTextarea"
```

---

## Task 8: Web — "Шаблоны" block in DescriptionEditor header

**Files:**
- Modify: `web/src/components/DescriptionEditor.tsx`

- [ ] **Step 1: Extend Props with template fields**

In `web/src/components/DescriptionEditor.tsx`, add the `DescriptionTemplate` import:

```ts
import type {
	DescriptionItem,
	DescriptionSections,
	DescriptionTemplate,
} from '../api';
```

Add to the `Props` interface:

```ts
	templates: DescriptionTemplate[];
	onSaveTemplate: (name: string) => void;
	onApplyTemplate: (id: string, mode: 'replace' | 'append') => void;
	onRenameTemplate: (id: string, name: string) => void;
	onDeleteTemplate: (id: string) => void;
```

Add them to the function destructuring:

```ts
export function DescriptionEditor({
	value,
	onChange,
	dirty,
	onReset,
	varMap,
	templates,
	onSaveTemplate,
	onApplyTemplate,
	onRenameTemplate,
	onDeleteTemplate,
}: Props) {
```

- [ ] **Step 2: Add the templates UI block**

In `DescriptionEditor`, inside the `<header>`, the existing right-side `<div className='flex items-center gap-1'>` holds the reset/+text/+image buttons. Immediately before that `<div>`, add the `TemplateMenu` component:

```tsx
				<TemplateMenu
					templates={templates}
					sectionsCount={sections.length}
					onSave={onSaveTemplate}
					onApply={onApplyTemplate}
					onRename={onRenameTemplate}
					onDelete={onDeleteTemplate}
				/>
```

- [ ] **Step 3: Add the `TemplateMenu` component**

At the end of `web/src/components/DescriptionEditor.tsx`, after the `RichTextarea` function, add:

```tsx
/**
 * «Шаблоны» — выпадающее меню в шапке описания: сохранить текущее описание
 * как именованный шаблон, применить шаблон (заменить или добавить секции),
 * переименовать и удалить.
 */
function TemplateMenu({
	templates,
	sectionsCount,
	onSave,
	onApply,
	onRename,
	onDelete,
}: {
	templates: DescriptionTemplate[];
	sectionsCount: number;
	onSave: (name: string) => void;
	onApply: (id: string, mode: 'replace' | 'append') => void;
	onRename: (id: string, name: string) => void;
	onDelete: (id: string) => void;
}) {
	const [open, setOpen] = useState(false);

	const handleSave = () => {
		const name = window.prompt('Название шаблона')?.trim();
		if (name) onSave(name);
		setOpen(false);
	};

	const handleApply = (id: string) => {
		const replace =
			sectionsCount === 0 ||
			window.confirm(
				'OK — заменить текущее описание шаблоном.\n' +
					'Отмена — добавить секции шаблона в конец.',
			);
		onApply(id, replace ? 'replace' : 'append');
		setOpen(false);
	};

	const handleRename = (t: DescriptionTemplate) => {
		const name = window.prompt('Новое название', t.name)?.trim();
		if (name && name !== t.name) onRename(t.id, name);
	};

	const handleDelete = (t: DescriptionTemplate) => {
		if (window.confirm(`Удалить шаблон «${t.name}»?`)) onDelete(t.id);
	};

	return (
		<div className='relative'>
			<button
				type='button'
				onClick={() => setOpen(o => !o)}
				className='btn btn-ghost h-7 px-2 text-[12px]'>
				Шаблоны
			</button>
			{open && (
				<div className='absolute right-0 z-20 mt-1 w-72 rounded-md border border-border bg-card shadow-lg'>
					<button
						type='button'
						onClick={handleSave}
						className='block w-full px-3 h-9 text-left text-[12px] font-medium hover:bg-soft border-b border-border-muted'>
						+ Сохранить как шаблон
					</button>
					{templates.length === 0 ? (
						<p className='px-3 py-3 text-[12px] text-ink-faint'>
							Сохранённых шаблонов нет.
						</p>
					) : (
						<div className='max-h-64 overflow-auto py-1'>
							{templates.map(t => (
								<div
									key={t.id}
									className='flex items-center gap-1 px-2 h-9 hover:bg-soft'>
									<button
										type='button'
										onClick={() => handleApply(t.id)}
										title='Применить шаблон'
										className='flex-1 text-left text-[12px] text-ink truncate'>
										{t.name}
									</button>
									<button
										type='button'
										onClick={() => handleRename(t)}
										title='Переименовать'
										className='btn btn-ghost h-7 w-7 px-0 text-ink-faint'>
										✎
									</button>
									<button
										type='button'
										onClick={() => handleDelete(t)}
										title='Удалить'
										className='btn btn-ghost h-7 w-7 px-0 text-ink-faint hover:text-bad'>
										✕
									</button>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build -w web`
Expected: build succeeds for `DescriptionEditor.tsx` itself. (App.tsx still errors until Task 9 supplies the new props — expected if run standalone.)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/DescriptionEditor.tsx
git commit -m "feat: Шаблоны menu in description editor header"
```

---

## Task 9: Web — App.tsx wiring

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add imports**

In `web/src/App.tsx`, add to the api import the `DescriptionTemplate` type. Find the existing import of `api` / types from `./api` and ensure `DescriptionTemplate` is included, e.g.:

```ts
import { api, type DescriptionSections, type DescriptionTemplate } from './api';
```

(If the file imports `api` and types separately, add `DescriptionTemplate` to the `import type { ... } from './api'` list instead — match the existing style.)

Add the shortcode import:

```ts
import { buildVarMap, flattenVars } from './components/shortcodes';
```

- [ ] **Step 2: Add the templates state**

In `web/src/App.tsx`, next to the other `useState` hooks (near line 86 where `description` state lives), add:

```ts
	const [templates, setTemplates] = useState<DescriptionTemplate[]>([]);
```

- [ ] **Step 3: Load templates once on mount**

Add this effect near the other effects (after the description auto-fill effect, around line 218):

```ts
	// Description templates are global; load the list once on mount.
	useEffect(() => {
		api.descriptionTemplates
			.list()
			.then(r => setTemplates(r.templates))
			.catch(() => {
				/* non-fatal: templates panel just stays empty */
			});
	}, []);
```

- [ ] **Step 4: Build the variable map**

In `web/src/App.tsx`, after the `cleanedOverrides` `useMemo` (around line 171), add:

```ts
	// key -> resolved value for description variables. Overrides win over
	// source values; @title / @price mirror the offer-level overrides.
	const varMap = useMemo(
		() =>
			buildVarMap({
				parameters: preview?.parameters ?? [],
				overrides: cleanedOverrides,
				title: nameOverride,
				price: priceOverride,
			}),
		[preview, cleanedOverrides, nameOverride, priceOverride],
	);
```

- [ ] **Step 5: Flatten variables in `cleanedDescription`**

In `web/src/App.tsx`, replace the `cleanedDescription` `useMemo` (around lines 273-283) with:

```ts
	// Strip empty TEXT items, drop emptied sections, then flatten {{variables}}
	// to plain text so Allegro receives no tokens.
	const cleanedDescription = useMemo<DescriptionSections | undefined>(() => {
		const cleaned = description.sections
			.map(s => ({
				items: s.items.filter(it =>
					it.type === 'TEXT' ? it.content.trim() : it.url.trim(),
				),
			}))
			.filter(s => s.items.length > 0);
		if (cleaned.length === 0) return undefined;
		return flattenVars({ sections: cleaned }, varMap).sections;
	}, [description, varMap]);
```

- [ ] **Step 6: Add the template action handlers**

In `web/src/App.tsx`, after `resetDescription` (around line 297), add:

```ts
	const refreshTemplates = () =>
		api.descriptionTemplates
			.list()
			.then(r => setTemplates(r.templates))
			.catch(() => {
				/* non-fatal */
			});

	const handleSaveTemplate = async (name: string) => {
		if (description.sections.length === 0) {
			alert('Описание пусто — нечего сохранять.');
			return;
		}
		try {
			await api.descriptionTemplates.create(name, description.sections);
			await refreshTemplates();
		} catch (e) {
			alert(`Не удалось сохранить шаблон: ${(e as Error).message}`);
		}
	};

	const handleApplyTemplate = (id: string, mode: 'replace' | 'append') => {
		const tpl = templates.find(t => t.id === id);
		if (!tpl) return;
		const nextSections =
			mode === 'replace'
				? tpl.sections
				: [...description.sections, ...tpl.sections];
		setDescription({ sections: nextSections });
		setDescriptionUserEdited(true);
		const { unresolved } = flattenVars({ sections: tpl.sections }, varMap);
		if (unresolved.length) {
			alert(
				'Шаблон применён. Не подставлены переменные (нет таких параметров ' +
					'у оффера):\n' +
					unresolved.map(k => `• ${k}`).join('\n'),
			);
		}
	};

	const handleRenameTemplate = async (id: string, name: string) => {
		try {
			await api.descriptionTemplates.update(id, { name });
			await refreshTemplates();
		} catch (e) {
			alert(`Не удалось переименовать: ${(e as Error).message}`);
		}
	};

	const handleDeleteTemplate = async (id: string) => {
		try {
			await api.descriptionTemplates.remove(id);
			await refreshTemplates();
		} catch (e) {
			alert(`Не удалось удалить: ${(e as Error).message}`);
		}
	};
```

- [ ] **Step 7: Pass the new props to `DescriptionEditor`**

In `web/src/App.tsx`, update the `<DescriptionEditor ... />` usage (around line 463) to:

```tsx
							<DescriptionEditor
								value={description}
								onChange={v => {
									setDescription(v);
									setDescriptionUserEdited(true);
								}}
								dirty={descriptionUserEdited}
								onReset={resetDescription}
								varMap={varMap}
								templates={templates}
								onSaveTemplate={handleSaveTemplate}
								onApplyTemplate={handleApplyTemplate}
								onRenameTemplate={handleRenameTemplate}
								onDeleteTemplate={handleDeleteTemplate}
							/>
```

Note: `DescriptionEditor`'s `value`/`onChange` operate on `DescriptionSections`; the per-item TEXT `content` carries token-form HTML — `varMap` and `flattenVars` handle resolution. No change needed to the `DescriptionSections` shape.

- [ ] **Step 8: Verify the build**

Run: `npm run build -w web`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat: wire description templates + variable map into App"
```

---

## Task 10: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: server and web suites both pass.

- [ ] **Step 2: Build everything**

Run: `npm run build`
Expected: server and web builds both succeed.

- [ ] **Step 3: Manual smoke test in the browser**

With `npm run dev` running, open http://localhost:5173 and:

1. Load a source offer (so `preview` is populated and parameters exist).
2. In the «Описание» panel, click into a text item, click **+ Переменная**, pick a parameter — confirm a chip appears showing `ключ · значение`.
3. Press Backspace on the chip — confirm the whole chip is removed at once.
4. Open **Шаблоны → + Сохранить как шаблон**, give it a name — confirm it appears in the list.
5. Edit a parameter in the overrides editor — confirm the chip's value updates live.
6. Load a different offer, **Шаблоны → <template>**, choose replace — confirm the description fills and chips resolve against the new offer (or show a missing-variable alert).
7. Run a **dry-run clone** and inspect the payload's `descriptionOverride` — confirm it contains plain values, no `{{...}}` tokens and no chip spans.
8. In **Шаблоны**, rename and delete a template — confirm both work.

- [ ] **Step 4: Final commit (if any verification fix was needed)**

```bash
git add -A
git commit -m "fix: description-templates verification fixes"
```

---

## Self-Review Notes

- **Spec coverage:** TemplateStore + global JSON file (Task 1); CRUD routes (Task 2); chip model with three representations (Tasks 4, 7); `@title`/`@price` built-ins + override precedence (Task 4); picker + manual `{{...}}` entry (Task 7); «Шаблоны» block with save/apply/manage (Task 8); flatten-on-publish + unresolved-key warning (Tasks 4, 9); tests for `TemplateStore` and shortcode utilities (Tasks 1, 4). All spec sections map to a task.
- **Type consistency:** `DescriptionTemplate` shape is identical in `templates.ts` (server) and `api.ts` (web). `buildVarMap` / `flattenVars` / `tokensToChipsHtml` / `chipsHtmlToTokens` / `chipHtml` signatures defined in Task 4 are used unchanged in Tasks 7 and 9. `varMap` is `Map<string,string>` everywhere. The `mode: 'replace' | 'append'` literal matches between `DescriptionEditor` Props and `App` handler.
- **YAGNI:** no nested templates, no per-section templates, no folders, no per-account storage — matches the spec's out-of-scope list.
