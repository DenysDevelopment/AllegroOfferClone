export interface AuthStatus {
  env: 'sandbox' | 'production';
  connected: boolean;
  hasCredentials: boolean;
  redirectUri: string;
}

export interface CloneStep {
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  detail?: unknown;
}

export interface CloneResult {
  steps: CloneStep[];
  body: unknown;
  outcome?:
    | { kind: 'created'; offerId: string; offer: { id: string; name?: string } }
    | { kind: 'queued'; commandId: string; status: { publication: { status: string }; errors?: unknown } }
    | { kind: 'dry-run' };
  error?: { message: string; status?: number; body?: unknown };
}

export type DescriptionItem =
  | { type: 'TEXT'; content: string }
  | { type: 'IMAGE'; url: string };

export interface DescriptionSections {
  sections: Array<{ items: DescriptionItem[] }>;
}

export interface ClonePayload {
  sourceOfferId: string;
  paramOverrides: Record<string, string>;
  nameOverride?: string;
  priceOverride?: string;
  stockOverride?: number;
  publicationStatus?: 'ACTIVE' | 'INACTIVE';
  descriptionOverride?: DescriptionSections;
  imagesOverride?: string[];
  dryRun?: boolean;
}

export interface OfferParameter {
  id: string;
  name?: string;
  values?: string[] | null;
  valuesLabels?: string[] | null;
  valuesIds?: string[] | null;
  unit?: string | null;
}

export interface OfferPreview {
  id: string;
  name: string;
  publication?: { status?: string };
  sellingMode?: { price?: { amount: string; currency: string } };
  stock?: { available: number };
  product: {
    id: string;
    name: string;
    category?: { id: string };
    parameters?: OfferParameter[];
    images?: Array<{ url: string } | string>;
  } | null;
  parameters: OfferParameter[];
  categoryParameters: Array<{
    id: string;
    name: string;
    type: string;
    dictionary?: Array<{ id?: string; value: string }>;
    options?: Record<string, unknown>;
  }>;
  description: DescriptionSections | null;
  images: Array<{ url: string } | string>;
}

async function http<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const opts: RequestInit = {
    method: init?.method ?? (init?.json !== undefined ? 'POST' : 'GET'),
    credentials: 'include',
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  };
  const res = await fetch(path, opts);
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const message =
      (data as { message?: string })?.message ?? `HTTP ${res.status} ${res.statusText}`;
    throw Object.assign(new Error(message), { status: res.status, data });
  }
  return data as T;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export const api = {
  authStatus: () => http<AuthStatus>('/api/auth/status'),
  loginUrl: () => http<{ url: string }>('/api/auth/login'),
  disconnect: () => http<{ ok: true }>('/api/auth/disconnect', { json: {} }),

  me: () => http<unknown>('/api/me'),
  offerPreview: (id: string) =>
    http<OfferPreview>(`/api/offers/${encodeURIComponent(id)}/preview`),

  clone: (payload: ClonePayload) => http<CloneResult>('/api/clone', { json: payload }),
  clonePreview: (payload: ClonePayload) =>
    http<{ steps: CloneStep[]; body: unknown; matchedProduct?: { id: string; name: string } }>(
      '/api/clone/preview',
      { json: payload },
    ),
};
