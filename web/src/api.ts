export interface AuthStatus {
  accountId: string;
  label: string;
  env: 'sandbox' | 'production';
  connected: boolean;
  hasCredentials: boolean;
  redirectUri: string;
}

export interface AccountSummary {
  id: string;
  label: string;
  env: 'sandbox' | 'production';
  hasCredentials: boolean;
  connected: boolean;
}

export interface AccountsResponse {
  defaultAccountId: string;
  accounts: AccountSummary[];
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

export interface DescriptionTemplate {
  id: string;
  name: string;
  sections: DescriptionSections['sections'];
  createdAt: number;
  updatedAt: number;
}

export interface GpsrAddress {
  countryCode: string;
  street: string;
  postalCode: string;
  city: string;
}

export interface GpsrContact {
  email?: string;
  phoneNumber?: string;
  formUrl?: string;
}

export interface ResponsiblePerson {
  id: string;
  name: string;
  personalData: { name: string; address: GpsrAddress; contact: GpsrContact };
}

export interface ResponsibleProducer {
  id: string;
  name: string;
  producerData: { tradeName: string; address: GpsrAddress; contact: GpsrContact };
}

export type ResponsibleProducerRef =
  | { type: 'ID'; id: string }
  | { type: 'NAME'; name: string };

export type ResponsiblePersonRef = { id: string } | { name: string };

export interface SafetyInformationText {
  type: 'TEXT';
  description: string;
}

/**
 * GPSR data read off the source offer's productSet[0] (preview). The server
 * resolves id refs to the full record; if that lookup fails it falls back to
 * the bare ref — hence the `| ...Ref` union members.
 */
export interface OfferGpsr {
  responsibleProducer?: ResponsibleProducer | ResponsibleProducerRef;
  responsiblePerson?: ResponsiblePerson | ResponsiblePersonRef;
  safetyInformation?: SafetyInformationText;
  marketedBeforeGPSRObligation?: boolean | null;
}

/** Account-scoped offer dictionary reference (shipping rate, return policy, …). */
export interface NamedRef {
  id: string;
  name?: string;
}

/** Account-scoped offer refs read off the source offer (preview). */
export interface OfferRefs {
  shippingRates?: NamedRef;
  returnPolicy?: NamedRef;
  impliedWarranty?: NamedRef;
  warranty?: NamedRef;
}

export interface CreateResponsiblePersonPayload {
  name: string;
  personalData: { name: string; address: GpsrAddress; contact: GpsrContact };
  accountId?: string;
}

export interface CreateResponsibleProducerPayload {
  name: string;
  producerData: { tradeName: string; address: GpsrAddress; contact: GpsrContact };
  accountId?: string;
}

export interface ClonePayload {
  sourceOfferId: string;
  paramOverrides: Record<string, string[]>;
  nameOverride?: string;
  priceOverride?: string;
  stockOverride?: number;
  publicationStatus?: 'ACTIVE' | 'INACTIVE';
  descriptionOverride?: DescriptionSections;
  imagesOverride?: string[];
  targetProductId?: string;
  /** GPSR data confirmed by the operator in GpsrPanel. */
  gpsr?: {
    responsibleProducer?: ResponsibleProducerRef | null;
    responsiblePerson?: ResponsiblePersonRef | null;
    safetyInformation?: SafetyInformationText | null;
  };
  /** Account-scoped offer refs confirmed by the operator in OfferRefsPanel. */
  offerRefs?: {
    shippingRates?: { id: string } | { name: string } | null;
    returnPolicy?: { id: string } | { name: string } | null;
    impliedWarranty?: { id: string } | { name: string } | null;
    warranty?: { id: string } | { name: string } | null;
  };
  dryRun?: boolean;
  /** Optional per-request override of the publishing (target) account. */
  accountId?: string;
  /** Optional per-request override of the source (read) account. */
  sourceAccountId?: string;
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
  categoryParameters: CategoryParameter[];
  description: DescriptionSections | null;
  images: Array<{ url: string } | string>;
  gpsr?: OfferGpsr | null;
  offerRefs?: OfferRefs | null;
}

// --- Active-account context ---
// All API requests are tagged with X-Account-Id taken from this getter.
// The active id is owned by App.tsx and stored in localStorage; we keep
// the getter mutable here so api.ts can stay stateless from the caller's POV.
let activeAccountIdGetter: () => string | null = () => null;

export function setActiveAccountIdGetter(fn: () => string | null): void {
  activeAccountIdGetter = fn;
}

function accountHeader(override?: string): Record<string, string> {
  const id = override ?? activeAccountIdGetter();
  return id ? { 'X-Account-Id': id } : {};
}

async function http<T>(
  path: string,
  init?: RequestInit & { json?: unknown; accountId?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...accountHeader(init?.accountId),
  };
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

export interface CategoryParameter {
  id: string;
  name: string;
  type: string;
  required?: boolean;
  unit?: string;
  dictionary?: Array<{ id?: string; value: string }>;
  options?: Record<string, unknown>;
  restrictions?: Record<string, unknown>;
}

export interface MatchingCategory {
  id: string;
  name: string;
  leaf?: boolean;
  parent?: { id: string };
}

export interface ProductParameterValue {
  id: string;
  values?: string[];
  valuesIds?: string[];
}

export interface ProposeProductPayload {
  name: string;
  category: { id: string };
  language?: string;
  images: string[];
  parameters: ProductParameterValue[];
  description?: DescriptionSections;
  /** Optional per-request override of the publishing account. */
  accountId?: string;
}

export interface ProposedProduct {
  id: string;
  name: string;
  category?: { id: string };
  images?: Array<{ url: string }>;
  parameters?: Array<{ id: string; values?: string[]; valuesIds?: string[] }>;
  publication?: { status: 'PROPOSED' | 'LISTED' };
}

export interface ImageUploadResponse {
  location: string;
  expiresAt?: string;
}

export interface ProductSearchHit {
  id: string;
  name: string;
  category?: { id: string };
  parameters?: OfferParameter[];
  images?: Array<{ url: string } | string>;
}

export const api = {
  accounts: () => http<AccountsResponse>('/api/auth/accounts'),
  authStatus: () => http<AuthStatus>('/api/auth/status'),
  loginUrl: (accountId?: string) => {
    const qs = accountId ? `?account=${encodeURIComponent(accountId)}` : '';
    return http<{ url: string }>(`/api/auth/login${qs}`);
  },
  disconnect: (accountId?: string) => {
    const qs = accountId ? `?account=${encodeURIComponent(accountId)}` : '';
    return http<{ ok: true }>(`/api/auth/disconnect${qs}`, { json: {}, accountId });
  },

  me: () => http<unknown>('/api/me'),
  offerPreview: (id: string, sourceAccountId?: string) =>
    http<OfferPreview>(`/api/offers/${encodeURIComponent(id)}/preview`, {
      accountId: sourceAccountId,
    }),

  // For clone/clonePreview: X-Account-Id is set to the SOURCE account (the
  // offer owner). The publish target rides in body.accountId. The server
  // reads the source offer with the header and writes the clone to the body.
  clone: (payload: ClonePayload) =>
    http<CloneResult>('/api/clone', { json: payload, accountId: payload.sourceAccountId }),
  clonePreview: (payload: ClonePayload) =>
    http<{ steps: CloneStep[]; body: unknown; matchedProduct?: { id: string; name: string } }>(
      '/api/clone/preview',
      { json: payload, accountId: payload.sourceAccountId },
    ),

  matchCategories: (name: string) =>
    http<{ matchingCategories: MatchingCategory[] }>(
      `/api/categories/match?name=${encodeURIComponent(name)}`,
    ),
  categoryParameters: (id: string) =>
    http<{ parameters: CategoryParameter[] }>(
      `/api/categories/${encodeURIComponent(id)}/parameters`,
    ),

  proposeProduct: (payload: ProposeProductPayload) =>
    http<ProposedProduct>('/api/products', { json: payload, accountId: payload.accountId }),
  proposeProductPreview: (payload: ProposeProductPayload) =>
    http<{ body: unknown }>('/api/products/preview', { json: payload, accountId: payload.accountId }),

  searchProducts: (opts: { phrase: string; categoryId?: string; pageId?: string }) => {
    const qs = new URLSearchParams();
    qs.set('phrase', opts.phrase);
    if (opts.categoryId) qs.set('categoryId', opts.categoryId);
    if (opts.pageId) qs.set('pageId', opts.pageId);
    return http<{ products: ProductSearchHit[]; nextPageId?: string }>(
      `/api/products/search?${qs.toString()}`,
    );
  },
  getProduct: (id: string) =>
    http<ProductSearchHit & { description?: DescriptionSections }>(
      `/api/products/${encodeURIComponent(id)}`,
    ),

  gpsr: {
    listPersons: (accountId?: string) =>
      http<{ responsiblePersons: ResponsiblePerson[] }>(
        '/api/gpsr/responsible-persons',
        { accountId },
      ),
    listProducers: (accountId?: string) =>
      http<{ responsibleProducers: ResponsibleProducer[] }>(
        '/api/gpsr/responsible-producers',
        { accountId },
      ),
    createPerson: (payload: CreateResponsiblePersonPayload) =>
      http<ResponsiblePerson>('/api/gpsr/responsible-persons', {
        json: payload,
        accountId: payload.accountId,
      }),
    createProducer: (payload: CreateResponsibleProducerPayload) =>
      http<ResponsibleProducer>('/api/gpsr/responsible-producers', {
        json: payload,
        accountId: payload.accountId,
      }),
  },

  helpers: {
    shippingRates: (accountId?: string) =>
      http<Array<{ id: string; name: string }>>('/api/helpers/shipping-rates', { accountId }),
    returnPolicies: (accountId?: string) =>
      http<Array<{ id: string; name: string }>>('/api/helpers/return-policies', { accountId }),
    impliedWarranties: (accountId?: string) =>
      http<Array<{ id: string; name: string }>>('/api/helpers/implied-warranties', { accountId }),
    warranties: (accountId?: string) =>
      http<Array<{ id: string; name: string }>>('/api/helpers/warranties', { accountId }),
  },

  uploadImageByUrl: (url: string) =>
    http<ImageUploadResponse>('/api/images/upload-url', { json: { url } }),
  uploadImageBinary: async (file: File): Promise<ImageUploadResponse> => {
    const res = await fetch('/api/images/upload', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': file.type, ...accountHeader() },
      body: file,
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const message =
        (data as { message?: string })?.message ??
        `HTTP ${res.status} ${res.statusText}`;
      throw Object.assign(new Error(message), { status: res.status, data });
    }
    return data as ImageUploadResponse;
  },

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
};
