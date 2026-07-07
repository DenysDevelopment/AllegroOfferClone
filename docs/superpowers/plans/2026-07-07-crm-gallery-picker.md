# CRM Gallery Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Из галереи CRM" button that lets the operator browse the CRM photo gallery (folders → channels → photos), multi-select, and have the chosen photos re-hosted to Allegro CDN and appended to the offer gallery.

**Architecture:** Our Express server proxies the CRM's key-protected read-only REST API (`/api/v1/gallery/*`); the CRM key lives only in `.env` (server-to-server, never in the browser). A new `CrmGalleryPicker` React modal renders folders/photos from our proxy; selected public CloudFront URLs are re-hosted to Allegro CDN through the **existing** `POST /api/images/upload-url` path and appended to the offer gallery.

**Tech Stack:** Node 20+, Express, axios, zod, vitest + nock (server); React 18, Vite, TailwindCSS, vitest + jsdom (`react-dom/client` + `act`) (web).

## Global Constraints

- Node ≥ 20; TypeScript throughout; ESM imports use the `.js` extension for local server modules (e.g. `import { CrmClient } from '../core/crm.js'`).
- Server HTTP tests use **nock** (already a devDep). Web component tests use `vi.mock('./api', …)` + `react-dom/client` `createRoot`/`act` (match `web/src/App.test.tsx`). Pure helpers get plain vitest unit tests.
- The CRM API key (`lgk_live_…`) MUST NOT reach the browser. The browser only calls our relative `/api/crm/*` routes.
- Re-host is the **existing** `onUploadByUrl` → `POST /api/images/upload-url` → `AllegroClient.uploadImageByUrl`. Do NOT write new re-host code and do NOT insert CloudFront URLs directly into the gallery.
- UI copy is Russian, matching existing buttons (`+ файлы`, `+ URL`, `сбросить`). Style with existing tokens (`panel`, `btn`, `btn-ghost`, `bg-card`, `border-border`, `flame-ring`, `text-ink`, `text-ink-muted`, `text-bad`, `bg-badTint`).
- The picker button and picker are shown only when `crmConfigured` is true (both `CRM_API_URL` and `CRM_API_KEY` set on the server).
- Canonical CRM photo `url` is already the active variant — pass it through unchanged.
- Commit after every task. Branch is `feat/crm-gallery-picker` (already created; the spec commit lives there).

---

## File Structure

**Server (create):**
- `server/src/core/crm.ts` — `CrmClient`, `CrmApiError`, CRM types. One responsibility: talk to the CRM gallery API.
- `server/src/core/crm.test.ts` — nock-based tests for `CrmClient`.
- `server/src/config.test.ts` — unit test for `deriveCrmConfig`.

**Server (modify):**
- `server/src/config.ts` — `CRM_API_URL`/`CRM_API_KEY` env + `deriveCrmConfig` + `MultiConfig.crm`.
- `server/src/routes/api.ts` — 3 CRM proxy routes; `apiRouter` gains a `crm` param.
- `server/src/routes/auth.ts` — `/accounts` emits `crmConfigured`.
- `server/src/index.ts` — pass `multi.crm` / `crmConfigured`; `CrmApiError` branch in error handler.
- `.env.example` — CRM section.

**Web (create):**
- `web/src/components/crmSelection.ts` — pure ordered-selection helper.
- `web/src/components/crmSelection.test.ts` — its unit test.
- `web/src/components/CrmGalleryPicker.tsx` — the modal.
- `web/src/components/CrmGalleryPicker.test.tsx` — component test.
- `web/src/hooks/useCrmPicker.tsx` — open/promise/render glue.

**Web (modify):**
- `web/src/api.ts` — CRM types + `api.crm` group + `AccountsResponse.crmConfigured`.
- `web/src/api.test.ts` — CREATE: URL-construction test for `api.crm`.
- `web/src/components/ImagesEditor.tsx` — `onImportFromCrm` prop + "Из галереи CRM" button + DRY `runRehostQueue`.
- `web/src/components/ImagesEditor.test.tsx` — CREATE: CRM-button behavior test.
- `web/src/App.tsx` — wire picker into the clone flow.
- `web/src/components/NewProductPanel.tsx` — wire picker into the new-product flow.

---

## Task 1: Server config — CRM env → `MultiConfig.crm`

**Files:**
- Modify: `server/src/config.ts`
- Modify: `.env.example`
- Test: `server/src/config.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `deriveCrmConfig(env: { CRM_API_URL?: string; CRM_API_KEY?: string }): { apiUrl: string; apiKey: string } | undefined`
  - `MultiConfig.crm?: { apiUrl: string; apiKey: string }`

- [ ] **Step 1: Write the failing test**

Create `server/src/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveCrmConfig } from './config.js';

describe('deriveCrmConfig', () => {
  it('returns config when both url and key are set', () => {
    expect(deriveCrmConfig({ CRM_API_URL: 'https://crm.test', CRM_API_KEY: 'lgk_live_x' })).toEqual(
      { apiUrl: 'https://crm.test', apiKey: 'lgk_live_x' },
    );
  });

  it('returns undefined when the key is missing', () => {
    expect(deriveCrmConfig({ CRM_API_URL: 'https://crm.test' })).toBeUndefined();
  });

  it('returns undefined when the url is missing', () => {
    expect(deriveCrmConfig({ CRM_API_KEY: 'lgk_live_x' })).toBeUndefined();
  });

  it('returns undefined when both are empty', () => {
    expect(deriveCrmConfig({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server -- config`
Expected: FAIL — `deriveCrmConfig` is not exported.

- [ ] **Step 3: Add env fields, the helper, and the `crm` field**

In `server/src/config.ts`, add two fields to `globalSchema` (after `ALLEGRO_PROD_CLIENT_SECRET`):

```ts
  CRM_API_URL: z.string().url().optional(),
  CRM_API_KEY: z.string().optional(),
```

Add the exported helper (place it just below `const parsedGlobals = globalSchema.parse(process.env);`):

```ts
export function deriveCrmConfig(env: {
  CRM_API_URL?: string;
  CRM_API_KEY?: string;
}): { apiUrl: string; apiKey: string } | undefined {
  if (env.CRM_API_URL && env.CRM_API_KEY) {
    return { apiUrl: env.CRM_API_URL, apiKey: env.CRM_API_KEY };
  }
  return undefined;
}
```

Add `crm` to the `MultiConfig` interface (after `accounts: AccountConfig[];`):

```ts
  crm?: { apiUrl: string; apiKey: string };
```

Populate it inside `loadMultiConfig()` — extend the `cached = { … }` object literal with:

```ts
    crm: deriveCrmConfig(parsedGlobals),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w server -- config`
Expected: PASS (4 tests).

- [ ] **Step 5: Update `.env.example`**

Append to `.env.example` (after the `# --- Server ---` block):

```
# --- CRM gallery (фото из CRM в галерею оффера) ---
# Базовый URL CRM API и per-company ключ (выдаётся в Настройках CRM, вид lgk_live_…).
# Если обе пустые — кнопка «Из галереи CRM» не показывается.
CRM_API_URL=
CRM_API_KEY=
```

- [ ] **Step 6: Commit**

```bash
git add server/src/config.ts server/src/config.test.ts .env.example
git commit -m "feat(server): CRM config (CRM_API_URL/CRM_API_KEY) + deriveCrmConfig

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `CrmClient` — CRM gallery API wrapper

**Files:**
- Create: `server/src/core/crm.ts`
- Test: `server/src/core/crm.test.ts` (create)

**Interfaces:**
- Consumes: nothing (constructs its own axios instance from `{ apiUrl, apiKey }`).
- Produces:
  - Types `CrmPhoto`, `CrmChannel`, `CrmFolderSummary`, `CrmFolderDetail`, `CrmFoldersResponse`.
  - `class CrmApiError extends Error { status: number; body: unknown }`.
  - `class CrmClient` with:
    - `listFolders(opts?: { search?: string; cursor?: string; limit?: number }): Promise<CrmFoldersResponse>`
    - `getFolder(id: string): Promise<CrmFolderDetail>`
    - `photosBySku(sku: string): Promise<CrmFolderDetail>`

- [ ] **Step 1: Write the failing test**

Create `server/src/core/crm.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { CrmApiError, CrmClient } from './crm.js';

const BASE = 'https://crm.test';
const client = () => new CrmClient({ apiUrl: BASE, apiKey: 'lgk_live_secret' });

afterEach(() => {
  nock.cleanAll();
});

describe('CrmClient', () => {
  it('listFolders sends the search query and Bearer header', async () => {
    const scope = nock(BASE, { reqheaders: { authorization: 'Bearer lgk_live_secret' } })
      .get('/api/v1/gallery/folders')
      .query({ search: 'dell' })
      .reply(200, { folders: [{ id: 'f1', name: 'Dell', photoCount: 2 }], nextCursor: null });

    const res = await client().listFolders({ search: 'dell' });

    expect(res.folders[0].id).toBe('f1');
    expect(res.nextCursor).toBeNull();
    scope.done();
  });

  it('getFolder hits /folders/{id}/photos', async () => {
    nock(BASE)
      .get('/api/v1/gallery/folders/f1/photos')
      .reply(200, { id: 'f1', name: 'Dell', photos: [{ id: 'p1', url: 'https://cdn/p1.jpg' }] });

    const res = await client().getFolder('f1');

    expect(res.photos[0].url).toBe('https://cdn/p1.jpg');
  });

  it('photosBySku hits /photos?sku=', async () => {
    nock(BASE)
      .get('/api/v1/gallery/photos')
      .query({ sku: 'DELL-7420' })
      .reply(200, { folder: { id: 'f1', sku: 'DELL-7420' }, photos: [] });

    const res = await client().photosBySku('DELL-7420');

    expect(res.photos).toEqual([]);
  });

  it('wraps a non-2xx response in CrmApiError with the status', async () => {
    nock(BASE).get('/api/v1/gallery/folders/nope/photos').reply(404, { error: 'folder_not_found' });

    await expect(client().getFolder('nope')).rejects.toMatchObject({
      name: 'CrmApiError',
      status: 404,
    });
    await expect(client().getFolder('nope')).rejects.toBeInstanceOf(CrmApiError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server -- crm`
Expected: FAIL — `./crm.js` does not exist.

- [ ] **Step 3: Implement `server/src/core/crm.ts`**

```ts
import axios, { type AxiosInstance } from 'axios';

export interface CrmPhoto {
  id: string;
  url: string;
  thumbnailUrl: string;
  folderId?: string;
  angleId: string | null;
  sortOrder: number;
  createdAt?: string;
  isCover?: boolean;
}

export interface CrmChannel {
  id: string;
  name: string;
  channelKey: string;
  photoCount: number;
}

export interface CrmFolderSummary {
  id: string;
  name: string;
  vendor?: string;
  sku?: string;
  photoCount: number;
  cover?: { id: string; url: string; thumbnailUrl: string } | null;
  channels?: CrmChannel[];
}

export interface CrmFoldersResponse {
  folders: CrmFolderSummary[];
  nextCursor: string | null;
}

export interface CrmFolderDetail {
  id: string;
  name: string;
  vendor?: string;
  sku?: string;
  photos: CrmPhoto[];
  channels?: CrmChannel[];
}

export class CrmApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'CrmApiError';
  }
}

export class CrmClient {
  private readonly http: AxiosInstance;

  constructor(cfg: { apiUrl: string; apiKey: string }) {
    this.http = axios.create({
      baseURL: cfg.apiUrl,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
      timeout: 20_000,
      maxContentLength: 50 * 1024 * 1024,
      validateStatus: () => true,
    });
  }

  private async get<T>(url: string, params?: Record<string, string | number>): Promise<T> {
    const res = await this.http.get<T>(url, { params });
    if (res.status >= 400) {
      const body = res.data as { error?: string; message?: string } | undefined;
      const msg = body?.message ?? body?.error ?? `CRM API ${res.status} ${url}`;
      throw new CrmApiError(res.status, res.data, msg);
    }
    return res.data;
  }

  listFolders(opts?: { search?: string; cursor?: string; limit?: number }): Promise<CrmFoldersResponse> {
    const params: Record<string, string | number> = {};
    if (opts?.search) params.search = opts.search;
    if (opts?.cursor) params.cursor = opts.cursor;
    if (opts?.limit) params.limit = opts.limit;
    return this.get<CrmFoldersResponse>('/api/v1/gallery/folders', params);
  }

  getFolder(id: string): Promise<CrmFolderDetail> {
    return this.get<CrmFolderDetail>(`/api/v1/gallery/folders/${encodeURIComponent(id)}/photos`);
  }

  photosBySku(sku: string): Promise<CrmFolderDetail> {
    return this.get<CrmFolderDetail>('/api/v1/gallery/photos', { sku });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w server -- crm`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/core/crm.ts server/src/core/crm.test.ts
git commit -m "feat(server): CrmClient for the CRM gallery API

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: CRM proxy routes + server wiring

**Files:**
- Modify: `server/src/routes/api.ts` (signature at `:279`; register routes before `r.use(pickAccount)` at `:373`)
- Modify: `server/src/index.ts` (pass `multi.crm`; add `CrmApiError` error branch)
- Test: manual (curl) — routes are thin passthroughs; the CRM logic is covered by Task 2. Follows the repo convention (existing routes have no automated tests).

**Interfaces:**
- Consumes: `CrmClient`, `CrmApiError` from Task 2; `MultiConfig.crm` from Task 1.
- Produces: HTTP routes `GET /api/crm/folders`, `GET /api/crm/folders/:id`, `GET /api/crm/photos?sku=` returning the CRM JSON as-is; `503 { error: 'CRM_NOT_CONFIGURED' }` when `crm` is unset.

- [ ] **Step 1: Extend `apiRouter` signature and add the routes**

In `server/src/routes/api.ts`:

Add the import near the other core imports:

```ts
import { CrmClient } from '../core/crm.js';
```

Change the signature at line 279:

```ts
export function apiRouter(
  registry: AccountRegistry,
  dataDir: string,
  crm?: { apiUrl: string; apiKey: string },
): Router {
```

Right after `const r = Router();` (line 280), build the client once:

```ts
  const crmClient = crm ? new CrmClient(crm) : null;
```

Register the CRM routes **before** `r.use(pickAccount);` (line 373) — they don't need an Allegro account. Insert:

```ts
  // --- CRM gallery proxy (read-only; key stays server-side) ---
  const requireCrm: RequestHandler = (_req, res, next) => {
    if (!crmClient) {
      return res.status(503).json({ error: 'CRM_NOT_CONFIGURED', message: 'CRM API is not configured' });
    }
    next();
  };

  r.get('/crm/folders', requireCrm, async (req, res, next) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      res.json(await crmClient!.listFolders({ search, cursor }));
    } catch (e) {
      next(e);
    }
  });

  r.get('/crm/photos', requireCrm, async (req, res, next) => {
    const sku = z.string().min(1).safeParse(req.query.sku);
    if (!sku.success) {
      return res.status(400).json({ error: 'VALIDATION', message: 'sku required' });
    }
    try {
      res.json(await crmClient!.photosBySku(sku.data));
    } catch (e) {
      next(e);
    }
  });

  r.get('/crm/folders/:id', requireCrm, async (req, res, next) => {
    try {
      res.json(await crmClient!.getFolder(req.params.id));
    } catch (e) {
      next(e);
    }
  });
```

> Note: register `/crm/photos` before `/crm/folders/:id` so `photos` is never swallowed as an `:id`. (Different first segment here, but keep the order defensive.)

- [ ] **Step 2: Wire config + error handler in `server/src/index.ts`**

Add to the imports:

```ts
import { CrmApiError } from './core/crm.js';
```

Change the `apiRouter` mount to pass the CRM config:

```ts
  app.use('/api', apiRouter(registry, multi.dataDir, multi.crm));
```

In the `errorHandler`, add a branch next to the `AllegroApiError` branch:

```ts
    if (err instanceof CrmApiError) {
      console.error('[crm]', err.status, err.message, err.body);
      return res.status(err.status).json({
        error: 'CRM',
        status: err.status,
        message: err.message,
        body: err.body,
      });
    }
```

- [ ] **Step 3: Typecheck the server**

Run: `npm run build -w server`
Expected: PASS (no TS errors).

- [ ] **Step 4: Manual smoke test**

With `CRM_API_URL`/`CRM_API_KEY` unset in `.env`, start the server (`npm run dev:server`) and:

Run: `curl -s -i localhost:3000/api/crm/folders`
Expected: `HTTP/1.1 503` with body `{"error":"CRM_NOT_CONFIGURED",…}`.

(Once the CRM issues a test key, set the env and re-run — expect the folder JSON. Not blocking for this task.)

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/api.ts server/src/index.ts
git commit -m "feat(server): /api/crm/* proxy routes + CrmApiError handling

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `crmConfigured` flag on `/accounts`

**Files:**
- Modify: `server/src/routes/auth.ts` (`authRouter` at `:11`, `/accounts` at `:15`)
- Modify: `server/src/index.ts` (pass the flag)
- Modify: `web/src/api.ts` (`AccountsResponse` type at `:19`)
- Test: manual (curl) — a one-field passthrough on an existing untested route.

**Interfaces:**
- Consumes: `MultiConfig.crm` from Task 1.
- Produces: `/api/auth/accounts` response gains `crmConfigured: boolean`; `AccountsResponse.crmConfigured?: boolean` on the client.

- [ ] **Step 1: Add the option to `authRouter`**

In `server/src/routes/auth.ts`, change the factory signature (line 11):

```ts
export function authRouter(registry: AccountRegistry, opts?: { crmConfigured?: boolean }): Router {
```

In the `/accounts` handler, extend the `res.json({ … })` payload:

```ts
      res.json({
        defaultAccountId: registry.defaultAccountId,
        accounts: items,
        crmConfigured: Boolean(opts?.crmConfigured),
      });
```

- [ ] **Step 2: Pass the flag from `index.ts`**

In `server/src/index.ts`, change the auth mount:

```ts
  app.use('/api/auth', authRouter(registry, { crmConfigured: Boolean(multi.crm) }));
```

- [ ] **Step 3: Add the field to the client type**

In `web/src/api.ts`, extend `AccountsResponse`:

```ts
export interface AccountsResponse {
  defaultAccountId: string;
  accounts: AccountSummary[];
  crmConfigured?: boolean;
}
```

- [ ] **Step 4: Typecheck both workspaces**

Run: `npm run build -w server && npm run build -w web`
Expected: PASS.

- [ ] **Step 5: Manual check**

Run: `curl -s localhost:3000/api/auth/accounts | grep -o '"crmConfigured":[a-z]*'`
Expected: `"crmConfigured":false` (env unset).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/auth.ts server/src/index.ts web/src/api.ts
git commit -m "feat: expose crmConfigured on /accounts for conditional UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Client CRM types + `api.crm` group

**Files:**
- Modify: `web/src/api.ts`
- Test: `web/src/api.test.ts` (create)

**Interfaces:**
- Consumes: existing `http<T>` helper (GET when no `json`), relative paths only.
- Produces:
  - Types `CrmPhoto`, `CrmChannel`, `CrmFolderSummary`, `CrmFoldersResponse`, `CrmFolderDetail` (mirror server).
  - `api.crm.folders(opts?)`, `api.crm.folder(id)`, `api.crm.photosBySku(sku)`.

- [ ] **Step 1: Write the failing test**

Create `web/src/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

function mockFetchOk(body: unknown) {
  const spy = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('api.crm', () => {
  it('folders() encodes search into the query string', async () => {
    const spy = mockFetchOk({ folders: [], nextCursor: null });
    await api.crm.folders({ search: 'dell 7420' });
    expect(spy.mock.calls[0][0]).toBe('/api/crm/folders?search=dell+7420');
  });

  it('folders() with no options hits the bare path', async () => {
    const spy = mockFetchOk({ folders: [], nextCursor: null });
    await api.crm.folders();
    expect(spy.mock.calls[0][0]).toBe('/api/crm/folders');
  });

  it('folder(id) encodes the id in the path', async () => {
    const spy = mockFetchOk({ id: 'f/1', name: 'x', photos: [] });
    await api.crm.folder('f/1');
    expect(spy.mock.calls[0][0]).toBe('/api/crm/folders/f%2F1');
  });

  it('photosBySku encodes the sku', async () => {
    const spy = mockFetchOk({ folder: {}, photos: [] });
    await api.crm.photosBySku('DELL 7420');
    expect(spy.mock.calls[0][0]).toBe('/api/crm/photos?sku=DELL+7420');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- api.test`
Expected: FAIL — `api.crm` is undefined.

- [ ] **Step 3: Add types and the `crm` group**

In `web/src/api.ts`, add the types near the other interfaces (e.g. before `export interface ImageUploadResponse`):

```ts
export interface CrmPhoto {
  id: string;
  url: string;
  thumbnailUrl: string;
  folderId?: string;
  angleId: string | null;
  sortOrder: number;
  createdAt?: string;
  isCover?: boolean;
}
export interface CrmChannel {
  id: string;
  name: string;
  channelKey: string;
  photoCount: number;
}
export interface CrmFolderSummary {
  id: string;
  name: string;
  vendor?: string;
  sku?: string;
  photoCount: number;
  cover?: { id: string; url: string; thumbnailUrl: string } | null;
  channels?: CrmChannel[];
}
export interface CrmFoldersResponse {
  folders: CrmFolderSummary[];
  nextCursor: string | null;
}
export interface CrmFolderDetail {
  id: string;
  name: string;
  vendor?: string;
  sku?: string;
  photos: CrmPhoto[];
  channels?: CrmChannel[];
}
```

Add the `crm` group to the exported `api` object (next to `helpers`):

```ts
  crm: {
    folders: (opts?: { search?: string; cursor?: string }) => {
      const qs = new URLSearchParams();
      if (opts?.search) qs.set('search', opts.search);
      if (opts?.cursor) qs.set('cursor', opts.cursor);
      const q = qs.toString();
      return http<CrmFoldersResponse>(`/api/crm/folders${q ? `?${q}` : ''}`);
    },
    folder: (id: string) => http<CrmFolderDetail>(`/api/crm/folders/${encodeURIComponent(id)}`),
    photosBySku: (sku: string) =>
      http<CrmFolderDetail>(`/api/crm/photos?sku=${encodeURIComponent(sku)}`),
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- api.test`
Expected: PASS (4 tests). (`URLSearchParams` encodes spaces as `+`, matching the assertions.)

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/api.test.ts
git commit -m "feat(web): api.crm client group + CRM types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `crmSelection` helper + `CrmGalleryPicker` modal

**Files:**
- Create: `web/src/components/crmSelection.ts`
- Create: `web/src/components/crmSelection.test.ts`
- Create: `web/src/components/CrmGalleryPicker.tsx`
- Create: `web/src/components/CrmGalleryPicker.test.tsx`

**Interfaces:**
- Consumes: `api.crm`, `CrmPhoto`, `CrmFolderSummary`, `CrmFolderDetail` from Task 5.
- Produces:
  - `togglePhoto(selected: CrmPhoto[], photo: CrmPhoto): CrmPhoto[]`
  - `CrmGalleryPicker` (default export) with props `{ open: boolean; initialSearch?: string; onConfirm: (urls: string[]) => void; onCancel: () => void }`.

- [ ] **Step 1: Write the failing test for `togglePhoto`**

Create `web/src/components/crmSelection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { togglePhoto } from './crmSelection';
import type { CrmPhoto } from '../api';

const p = (id: string): CrmPhoto => ({
  id,
  url: `https://cdn/${id}.jpg`,
  thumbnailUrl: `https://cdn/${id}_t.webp`,
  angleId: null,
  sortOrder: 0,
});

describe('togglePhoto', () => {
  it('adds a photo not yet selected, preserving order', () => {
    const out = togglePhoto([p('a')], p('b'));
    expect(out.map(x => x.id)).toEqual(['a', 'b']);
  });

  it('removes a photo already selected', () => {
    const out = togglePhoto([p('a'), p('b')], p('a'));
    expect(out.map(x => x.id)).toEqual(['b']);
  });

  it('is identity-by-id (same id toggles off even if other fields differ)', () => {
    const out = togglePhoto([p('a')], { ...p('a'), url: 'https://cdn/other.jpg' });
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- crmSelection`
Expected: FAIL — `./crmSelection` does not exist.

- [ ] **Step 3: Implement `web/src/components/crmSelection.ts`**

```ts
import type { CrmPhoto } from '../api';

/** Toggle a photo in an order-preserving selection list, keyed by photo id. */
export function togglePhoto(selected: CrmPhoto[], photo: CrmPhoto): CrmPhoto[] {
  return selected.some(p => p.id === photo.id)
    ? selected.filter(p => p.id !== photo.id)
    : [...selected, photo];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- crmSelection`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `web/src/components/CrmGalleryPicker.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type CrmFolderDetail, type CrmFolderSummary, type CrmPhoto } from '../api';
import { togglePhoto } from './crmSelection';

interface Props {
  open: boolean;
  initialSearch?: string;
  onConfirm: (urls: string[]) => void;
  onCancel: () => void;
}

export default function CrmGalleryPicker({ open, initialSearch, onConfirm, onCancel }: Props) {
  const [search, setSearch] = useState(initialSearch ?? '');
  const [folders, setFolders] = useState<CrmFolderSummary[]>([]);
  const [detail, setDetail] = useState<CrmFolderDetail | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [selected, setSelected] = useState<CrmPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the modal (re)opens.
  useEffect(() => {
    if (!open) return;
    setSearch(initialSearch ?? '');
    setDetail(null);
    setActiveFolderId(null);
    setSelected([]);
    setError(null);
  }, [open, initialSearch]);

  // Debounced folder search while open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.crm.folders({ search: search.trim() || undefined });
        if (!cancelled) setFolders(res.folders);
      } catch (e) {
        if (!cancelled) setError(errMsg(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, search]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const loadFolder = useCallback(async (id: string) => {
    setActiveFolderId(id);
    setLoading(true);
    setError(null);
    try {
      const res = await api.crm.folder(id);
      setDetail(res);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  if (!open) return null;

  const photos = detail?.photos ?? [];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onCancel();
      }}>
      <div className="panel flex h-[80vh] w-[min(1100px,95vw)] flex-col overflow-hidden shadow-lg">
        <header className="flex h-12 items-center justify-between gap-3 border-b border-border px-4">
          <span className="label">Галерея CRM</span>
          <input
            className="input h-8 max-w-xs flex-1 text-[13px]"
            placeholder="поиск модели…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button type="button" onClick={onCancel} className="btn btn-ghost h-8 w-8 px-0" title="Закрыть">
            ✕
          </button>
        </header>

        {error && (
          <div className="px-4 pt-2">
            <div className="rounded-md border border-bad/30 bg-badTint px-2 py-1.5 text-[12px] text-bad">
              {error}
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <aside className="w-64 shrink-0 overflow-auto border-r border-border p-2">
            {folders.length === 0 && !loading ? (
              <p className="p-2 text-[13px] text-ink-muted">Ничего не найдено.</p>
            ) : (
              folders.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => loadFolder(f.id)}
                  className={`mb-1 flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[13px] ${
                    activeFolderId === f.id
                      ? 'border-flame-ring bg-soft'
                      : 'border-transparent hover:border-border'
                  }`}>
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="text-[11px] text-ink-muted">{f.photoCount}</span>
                </button>
              ))
            )}
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            {detail?.channels && detail.channels.length > 0 && (
              <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
                {detail.channels.map(ch => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => loadFolder(ch.id)}
                    className={`btn btn-ghost h-7 px-2 text-[12px] ${
                      activeFolderId === ch.id ? 'border border-flame-ring' : ''
                    }`}>
                    {ch.name} · {ch.photoCount}
                  </button>
                ))}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {!detail ? (
                <p className="text-[13px] text-ink-muted">Выберите папку слева.</p>
              ) : photos.length === 0 ? (
                <p className="text-[13px] text-ink-muted">В этой папке нет фото.</p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                  {photos.map(ph => {
                    const isSel = selected.some(s => s.id === ph.id);
                    return (
                      <button
                        key={ph.id}
                        type="button"
                        onClick={() => setSelected(s => togglePhoto(s, ph))}
                        className={`relative aspect-square overflow-hidden rounded border bg-soft outline-none ${
                          isSel ? 'border-flame-ring ring-2 ring-flame-ring' : 'border-border hover:border-flame-ring'
                        }`}>
                        <img
                          src={ph.thumbnailUrl || ph.url}
                          alt=""
                          loading="lazy"
                          className="absolute inset-0 h-full w-full object-cover"
                          onError={e => {
                            (e.target as HTMLImageElement).style.opacity = '0.2';
                          }}
                        />
                        {isSel && (
                          <span className="absolute right-1 top-1 rounded bg-flame px-1 text-[10px] font-semibold text-white">
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="flex h-12 items-center justify-between border-t border-border px-4">
          <span className="text-[13px] text-ink-muted">Выбрано: {selected.length}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="btn btn-ghost h-8 px-3 text-[13px]">
              Отмена
            </button>
            <button
              type="button"
              onClick={() => onConfirm(selected.map(s => s.url))}
              disabled={selected.length === 0}
              className="btn btn-primary h-8 px-3 text-[13px] disabled:opacity-40">
              Добавить выбранные ({selected.length})
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function errMsg(e: unknown): string {
  const status = (e as { status?: number })?.status;
  if (status === 503) return 'CRM не настроена на сервере.';
  if (status === 401 || status === 403) return 'CRM отклонила ключ доступа.';
  if (status === 429) return 'Слишком много запросов к CRM, попробуйте позже.';
  return (e as Error)?.message ?? 'Ошибка запроса к CRM.';
}
```

> If `btn-primary` is not an existing class, use the same class the app's main action button uses (grep `btn-primary` in `web/src`; fall back to `btn` if absent). Verify during Step 7.

- [ ] **Step 6: Write the component test**

Create `web/src/components/CrmGalleryPicker.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CrmGalleryPicker from './CrmGalleryPicker';

vi.mock('../api', () => ({
  api: {
    crm: {
      folders: vi.fn().mockResolvedValue({
        folders: [{ id: 'f1', name: 'Dell 7420', photoCount: 2 }],
        nextCursor: null,
      }),
      folder: vi.fn().mockResolvedValue({
        id: 'f1',
        name: 'Dell 7420',
        photos: [
          { id: 'p1', url: 'https://cdn/p1.jpg', thumbnailUrl: 'https://cdn/p1_t.webp', angleId: null, sortOrder: 0 },
          { id: 'p2', url: 'https://cdn/p2.jpg', thumbnailUrl: 'https://cdn/p2_t.webp', angleId: null, sortOrder: 1 },
        ],
      }),
    },
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 350)); // let the 300ms search debounce fire
  });
};

describe('CrmGalleryPicker', () => {
  it('confirms selected photo urls in click order', async () => {
    const onConfirm = vi.fn();
    await act(async () => {
      root.render(
        <CrmGalleryPicker open initialSearch="dell" onConfirm={onConfirm} onCancel={() => {}} />,
      );
    });
    await flush();

    // Open the folder.
    const folderBtn = [...document.body.querySelectorAll('button')].find(b =>
      b.textContent?.includes('Dell 7420'),
    )!;
    await act(async () => folderBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => Promise.resolve());

    // Select both photos (thumbnails are buttons wrapping an <img>).
    const thumbs = [...document.body.querySelectorAll('button')].filter(b => b.querySelector('img'));
    await act(async () => thumbs[1].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => thumbs[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const confirm = [...document.body.querySelectorAll('button')].find(b =>
      b.textContent?.startsWith('Добавить выбранные'),
    )!;
    await act(async () => confirm.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onConfirm).toHaveBeenCalledWith(['https://cdn/p2.jpg', 'https://cdn/p1.jpg']);
  });

  it('renders nothing when closed', async () => {
    await act(async () => {
      root.render(<CrmGalleryPicker open={false} onConfirm={() => {}} onCancel={() => {}} />);
    });
    expect(document.body.textContent).not.toContain('Галерея CRM');
  });
});
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test -w web -- CrmGalleryPicker` then `npm run build -w web`
Expected: PASS (2 tests) and no TS errors. If `btn-primary` caused a visual/class issue, swap for the app's real primary-action class (see the note in Step 5) and re-run.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/crmSelection.ts web/src/components/crmSelection.test.ts web/src/components/CrmGalleryPicker.tsx web/src/components/CrmGalleryPicker.test.tsx
git commit -m "feat(web): CrmGalleryPicker modal + ordered selection helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `ImagesEditor` — CRM button + DRY re-host queue

**Files:**
- Modify: `web/src/components/ImagesEditor.tsx`
- Test: `web/src/components/ImagesEditor.test.tsx` (create)

**Interfaces:**
- Consumes: existing `onUploadByUrl?: (url: string) => Promise<string>` (used to re-host each CRM url).
- Produces: new prop `onImportFromCrm?: () => Promise<string[]>`; renders the "Из галереи CRM" button when it (and `onUploadByUrl`) are provided.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ImagesEditor.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ImagesEditor } from './ImagesEditor';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const clickByText = async (text: string) => {
  const btn = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))!;
  await act(async () => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

describe('ImagesEditor CRM import', () => {
  it('hides the CRM button when onImportFromCrm is absent', async () => {
    await act(async () => {
      root.render(<ImagesEditor urls={[]} onChange={() => {}} />);
    });
    expect(container.textContent).not.toContain('Из галереи CRM');
  });

  it('re-hosts each imported url via onUploadByUrl and appends them', async () => {
    const onChange = vi.fn();
    const onUploadByUrl = vi
      .fn()
      .mockImplementation(async (u: string) => u.replace('cdn', 'allegro'));
    const onImportFromCrm = vi
      .fn()
      .mockResolvedValue(['https://cdn/a.jpg', 'https://cdn/b.jpg']);

    await act(async () => {
      root.render(
        <ImagesEditor
          urls={['https://existing/0.jpg']}
          onChange={onChange}
          onUploadByUrl={onUploadByUrl}
          onImportFromCrm={onImportFromCrm}
        />,
      );
    });

    await clickByText('Из галереи CRM');
    await act(async () => Promise.resolve());

    expect(onUploadByUrl).toHaveBeenCalledTimes(2);
    // Last onChange call carries both re-hosted urls appended to the original.
    const last = onChange.mock.calls.at(-1)![0];
    expect(last).toEqual([
      'https://existing/0.jpg',
      'https://allegro/a.jpg',
      'https://allegro/b.jpg',
    ]);
  });

  it('one failed re-host does not stop the others', async () => {
    const onChange = vi.fn();
    const onUploadByUrl = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('https://allegro/b.jpg');
    const onImportFromCrm = vi.fn().mockResolvedValue(['https://cdn/a.jpg', 'https://cdn/b.jpg']);

    await act(async () => {
      root.render(
        <ImagesEditor
          urls={[]}
          onChange={onChange}
          onUploadByUrl={onUploadByUrl}
          onImportFromCrm={onImportFromCrm}
        />,
      );
    });

    await clickByText('Из галереи CRM');
    await act(async () => Promise.resolve());

    const last = onChange.mock.calls.at(-1)![0];
    expect(last).toEqual(['https://allegro/b.jpg']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- ImagesEditor`
Expected: FAIL — no "Из галереи CRM" button / prop unknown.

- [ ] **Step 3: Refactor to a shared queue and add the CRM path**

In `web/src/components/ImagesEditor.tsx`:

Extend `Props`:

```ts
  /** Opens the CRM gallery picker; resolves with selected photo URLs (in order). */
  onImportFromCrm?: () => Promise<string[]>;
```

and the destructure:

```ts
export function ImagesEditor({ urls, onChange, dirty, onReset, onUploadFile, onUploadByUrl, onImportFromCrm }: Props) {
```

Replace the `UploadingState` type with one that also covers CRM progress:

```ts
type UploadingState =
  | { kind: 'idle' }
  | { kind: 'file'; done: number; total: number }
  | { kind: 'crm'; done: number; total: number }
  | { kind: 'url' };
```

Add a shared sequential queue (place above `handleFile`):

```ts
	// Sequentially re-host a list of sources, appending each success to the
	// gallery as it lands. Allegro's /sale/images endpoint dislikes parallel
	// bursts, so this is intentionally serial. Failures are collected, not thrown.
	const runRehostQueue = async <T,>(
		items: T[],
		rehost: (item: T) => Promise<string>,
		kind: 'file' | 'crm',
		label: (item: T) => string,
	) => {
		setError(null);
		const failures: string[] = [];
		let acc = urls.slice();
		for (let i = 0; i < items.length; i++) {
			setUploading({ kind, done: i, total: items.length });
			try {
				const cdnUrl = await rehost(items[i]);
				if (cdnUrl) {
					acc = [...acc, cdnUrl];
					onChange(acc);
				}
			} catch (err) {
				failures.push(`${label(items[i])}: ${(err as Error).message}`);
			}
		}
		setUploading({ kind: 'idle' });
		if (failures.length) {
			setError(
				`Не удалось загрузить ${failures.length} из ${items.length}:\n` + failures.join('\n'),
			);
		}
	};
```

Rewrite `handleFile` to use the queue (keep the file-reset behavior):

```ts
	const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files ?? []);
		if (files.length === 0 || !onUploadFile) return;
		await runRehostQueue(files, onUploadFile, 'file', f => f.name);
		if (fileRef.current) fileRef.current.value = '';
	};
```

Add the CRM handler (place near `rehostByUrl`):

```ts
	const importFromCrm = async () => {
		if (!onImportFromCrm || !onUploadByUrl) return;
		const picked = await onImportFromCrm();
		if (!picked.length) return;
		await runRehostQueue(picked, onUploadByUrl, 'crm', u => u);
	};
```

Add the button in the header toolbar — place it right before the `onUploadByUrl && (…)` "+ URL" block:

```tsx
						{onImportFromCrm && onUploadByUrl && (
							<button
								type='button'
								onClick={importFromCrm}
								disabled={uploading.kind !== 'idle'}
								className='btn btn-ghost h-7 px-2 text-[12px]'
								title='Выбрать фото из галереи CRM'>
								{uploading.kind === 'crm'
									? `${uploading.done}/${uploading.total} · · ·`
									: 'Из галереи CRM'}
							</button>
						)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w web -- ImagesEditor`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify the pre-existing behavior still holds**

Run: `npm test -w web`
Expected: PASS (all web tests, including `App.test.tsx`).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ImagesEditor.tsx web/src/components/ImagesEditor.test.tsx
git commit -m "feat(web): 'Из галереи CRM' button in ImagesEditor + DRY rehost queue

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `useCrmPicker` hook + wire into clone & new-product flows

**Files:**
- Create: `web/src/hooks/useCrmPicker.tsx`
- Modify: `web/src/App.tsx` (ImagesEditor at `~:578`; needs `accounts`/`crmConfigured` + `preview`)
- Modify: `web/src/components/NewProductPanel.tsx` (ImagesEditor at `~:551`)
- Test: manual (browser) — this is wiring; the picker, editor, and api are unit-tested in Tasks 5–7.

**Interfaces:**
- Consumes: `CrmGalleryPicker` (Task 6), `api.uploadImageByUrl`, `AccountsResponse.crmConfigured` (Task 4), `ImagesEditor.onImportFromCrm`/`onUploadByUrl` (Task 7).
- Produces: `useCrmPicker(): { openPicker: (initialSearch?: string) => Promise<string[]>; element: React.ReactNode }`.

- [ ] **Step 1: Implement the hook**

Create `web/src/hooks/useCrmPicker.tsx`:

```tsx
import { useCallback, useRef, useState } from 'react';
import CrmGalleryPicker from '../components/CrmGalleryPicker';

/**
 * Owns the CRM picker modal. `openPicker(initialSearch)` opens it and resolves
 * with the selected photo URLs (empty array on cancel). Render `element` once.
 */
export function useCrmPicker() {
  const [open, setOpen] = useState(false);
  const [initialSearch, setInitialSearch] = useState('');
  const resolver = useRef<((urls: string[]) => void) | null>(null);

  const openPicker = useCallback(
    (search?: string) =>
      new Promise<string[]>(resolve => {
        resolver.current = resolve;
        setInitialSearch(search ?? '');
        setOpen(true);
      }),
    [],
  );

  const finish = useCallback((urls: string[]) => {
    setOpen(false);
    resolver.current?.(urls);
    resolver.current = null;
  }, []);

  const element = (
    <CrmGalleryPicker
      open={open}
      initialSearch={initialSearch}
      onConfirm={finish}
      onCancel={() => finish([])}
    />
  );

  return { openPicker, element };
}
```

- [ ] **Step 2: Wire into `web/src/App.tsx` (clone flow)**

Add the import near the other component imports:

```ts
import { useCrmPicker } from './hooks/useCrmPicker';
```

Inside the `App` component body (near the other hooks/state, e.g. after `refreshAccounts`), add:

```ts
	const { openPicker: openCrmPicker, element: crmPickerEl } = useCrmPicker();
```

Determine whether CRM is on. `accounts` is loaded via `api.accounts()`, but `crmConfigured` sits on the raw `AccountsResponse`, not on `AccountSummary`. Capture it: in `refreshAccounts` (around `:117`), after `const data = await api.accounts();`, also store the flag:

```ts
			setCrmConfigured(Boolean(data.crmConfigured));
```

and add the state near the `accounts` state (`:47`):

```ts
	const [crmConfigured, setCrmConfigured] = useState(false);
```

Update the `ImagesEditor` usage (`~:578`) to pass the re-host + CRM props (only when configured):

```tsx
						{preview && !targetProduct && (
							<ImagesEditor
								urls={imageUrls}
								onChange={v => {
									setImageUrls(v);
									setImagesUserEdited(true);
								}}
								dirty={imagesUserEdited}
								onReset={resetImages}
								onUploadByUrl={crmConfigured ? url => api.uploadImageByUrl(url).then(r => r.location) : undefined}
								onImportFromCrm={crmConfigured ? () => openCrmPicker(preview?.name ?? '') : undefined}
							/>
						)}
```

Render the modal element once, near the end of the returned JSX (e.g. just before the closing wrapper / next to other portals):

```tsx
			{crmPickerEl}
```

- [ ] **Step 3: Wire into `web/src/components/NewProductPanel.tsx`**

Add the import:

```ts
import { useCrmPicker } from '../hooks/useCrmPicker';
```

`NewProductPanel` already has `onUploadByUrl` (`:386`). Add the hook in the component body:

```ts
	const { openPicker: openCrmPicker, element: crmPickerEl } = useCrmPicker();
```

NewProductPanel doesn't fetch accounts itself. Add an optional prop so the parent tells it whether CRM is on — extend its `Props` with:

```ts
	crmConfigured?: boolean;
```

and destructure it. Then update its `ImagesEditor` (`~:551`) — add:

```tsx
				onImportFromCrm={
					crmConfigured ? () => openCrmPicker(name?.trim() || '') : undefined
				}
```

(`name` is the product-name state in this panel; if the local variable differs, pass the closest product-title value, or `''`.)

Render the modal once inside the panel's returned JSX:

```tsx
			{crmPickerEl}
```

Finally, pass `crmConfigured` from wherever `NewProductPanel` is rendered (grep `<NewProductPanel`), forwarding the same `crmConfigured` state added in App:

```tsx
					<NewProductPanel … crmConfigured={crmConfigured} />
```

- [ ] **Step 4: Typecheck + full web test run**

Run: `npm run build -w web && npm test -w web`
Expected: PASS. If `App.test.tsx`'s `api` mock now needs `uploadImageByUrl`/`crm`, add them to that mock (it already mocks `./api`); set `accounts` mock to resolve `{ …, crmConfigured: false }` so the CRM UI stays hidden in that test.

- [ ] **Step 5: Manual browser verification**

Start `npm run dev`. With CRM env unset:
- The "Из галереи CRM" button is **absent** in both the clone editor and the new-product editor (crmConfigured=false).

Then set `CRM_API_URL`/`CRM_API_KEY` to a working test key (once CRM provides one) and restart:
- Button appears; clicking opens the modal; folders load; opening a folder shows photos; selecting + "Добавить выбранные" re-hosts to Allegro CDN and the new URLs appear in the gallery list; Esc/Отмена closes with no change.

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/useCrmPicker.tsx web/src/App.tsx web/src/components/NewProductPanel.tsx web/src/App.test.tsx
git commit -m "feat(web): wire CRM gallery picker into clone & new-product flows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes (coverage against the spec)

- **Config / `.env`** → Task 1. **`crmConfigured` bootstrap** → Task 4.
- **Server `CrmClient`** → Task 2. **Proxy routes + `503`/error mapping** → Task 3.
- **Client `api.crm`** → Task 5. **`CrmGalleryPicker` (folders/channels/grid/multi-select/search prefill)** → Task 6.
- **`ImagesEditor` button + re-use of existing re-host** → Task 7. **Wiring in both flows + `useCrmPicker`** → Task 8.
- **Re-host reuse (no new re-host code)** — Tasks 7/8 route every CRM url through `onUploadByUrl` = `api.uploadImageByUrl` = existing `POST /api/images/upload-url`. ✅
- **Key never in browser** — key only in `CrmClient` (server); browser calls relative `/api/crm/*`. ✅
- **YAGNI** — no dedup, no infinite scroll (folder pagination `nextCursor` is available in the API but the picker's "load more" is deferred; folders list shows the first page — acceptable for v1; a "+ ещё" button can be added later without schema change).

**Deferred/known-limits (log, not silently dropped):**
- The picker shows only the **first page** of folders (no "+ ещё" yet). If a company has >~50 folders, later ones need search to surface. Add pagination in a follow-up if it bites.
- `initialSearch` uses the raw offer/product name (no model extraction). The operator edits the search box as needed.
