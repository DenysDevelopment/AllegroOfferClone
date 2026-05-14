import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';
import pRetry, { AbortError } from 'p-retry';
import type { AppConfig } from '../config.js';
import type { OAuthClient } from './oauth.js';
import type {
  AllegroOffer,
  CategoryParametersResponse,
  ProductSearchHit,
  ProductSearchResponse,
  PublicationCommandStatus,
  ResponsiblePerson,
  ResponsibleProducer,
} from './types.js';

const ACCEPT = 'application/vnd.allegro.public.v1+json';

export class AllegroApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'AllegroApiError';
  }
}

export class AllegroClient {
  private readonly http: AxiosInstance;

  constructor(
    private readonly cfg: AppConfig,
    private readonly oauth: OAuthClient,
  ) {
    this.http = axios.create({
      baseURL: cfg.apiUrl,
      headers: {
        Accept: ACCEPT,
        'Content-Type': ACCEPT,
      },
      // Allegro responses can be sizeable (full offer JSON)
      maxBodyLength: 50 * 1024 * 1024,
      maxContentLength: 50 * 1024 * 1024,
      validateStatus: () => true,
    });
  }

  // ---- low-level request with retry/refresh ----

  private async request<T>(config: AxiosRequestConfig, attempt = 0): Promise<AxiosResponse<T>> {
    const token = await this.oauth.getAccessToken();
    const res = await this.http.request<T>({
      ...config,
      headers: {
        ...(config.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401 && attempt === 0) {
      // Token went stale unexpectedly — force refresh by clearing safety window
      // (we just re-call getAccessToken which will refresh if needed).
      return this.request<T>(config, attempt + 1);
    }

    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      // throw — outer pRetry will catch
      throw new AllegroApiError(res.status, res.data, this.formatError(res));
    }

    if (res.status >= 400) {
      // 4xx other than 429 — do not retry
      throw new AbortError(new AllegroApiError(res.status, res.data, this.formatError(res)));
    }

    return res;
  }

  private async withRetry<T>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return pRetry(() => this.request<T>(config), {
      retries: 3,
      factor: 2,
      minTimeout: 500,
      maxTimeout: 5_000,
      onFailedAttempt: (e) => {
        // p-retry surfaces AxiosError or AllegroApiError here
        // (AbortError unwraps to its inner error)
        const status = (e as { status?: number }).status;
        if (status === 429) {
          // honour Retry-After if present
          // (p-retry doesn't expose response — best-effort with default backoff)
        }
      },
    });
  }

  private formatError(res: AxiosResponse): string {
    const errors = (res.data as { errors?: Array<{ message?: string; code?: string }> })?.errors;
    if (errors?.length) {
      return `Allegro ${res.status}: ${errors
        .map((e) => `[${e.code ?? '?'}] ${e.message ?? ''}`)
        .join('; ')}`;
    }
    return `Allegro ${res.status}: ${res.statusText}`;
  }

  // ---- typed endpoints ----

  async me(): Promise<unknown> {
    const res = await this.withRetry<unknown>({ method: 'GET', url: '/me' });
    return res.data;
  }

  async getOffer(offerId: string): Promise<AllegroOffer> {
    const res = await this.withRetry<AllegroOffer>({
      method: 'GET',
      url: `/sale/product-offers/${encodeURIComponent(offerId)}`,
    });
    return res.data;
  }

  async getProduct(productId: string): Promise<{
    id: string;
    name: string;
    category?: { id: string };
    parameters?: { id: string; name?: string; values?: string[] }[];
    images?: { url: string }[];
    [k: string]: unknown;
  }> {
    const res = await this.withRetry<{
      id: string;
      name: string;
      category?: { id: string };
      parameters?: { id: string; name?: string; values?: string[] }[];
      images?: { url: string }[];
    }>({
      method: 'GET',
      url: `/sale/products/${encodeURIComponent(productId)}`,
    });
    return res.data;
  }

  async searchProducts(opts: {
    phrase: string;
    categoryId?: string;
    pageId?: string;
  }): Promise<{ products: ProductSearchHit[]; nextPageId?: string }> {
    // Allegro's /sale/products has no `limit`/`offset` — page size is server-fixed
    // and pagination is cursor-only via the `page.id` query param. Pass back the
    // value from the previous response's `nextPage.id` to fetch the next page.
    const params: Record<string, string> = { phrase: opts.phrase };
    if (opts.categoryId) params['category.id'] = opts.categoryId;
    if (opts.pageId) params['page.id'] = opts.pageId;

    const res = await this.withRetry<ProductSearchResponse>({
      method: 'GET',
      url: '/sale/products',
      params,
    });
    return {
      products: res.data.products ?? [],
      nextPageId: res.data.nextPage?.id,
    };
  }

  async getCategoryParameters(categoryId: string): Promise<CategoryParametersResponse> {
    const res = await this.withRetry<CategoryParametersResponse>({
      method: 'GET',
      url: `/sale/categories/${encodeURIComponent(categoryId)}/parameters`,
    });
    return res.data;
  }

  async createOffer(body: unknown): Promise<{
    status: number;
    offer?: AllegroOffer;
    commandId?: string;
  }> {
    // Use raw request so we can branch on 201 vs 202 without retry on 4xx
    const res = await this.withRetry<AllegroOffer>({
      method: 'POST',
      url: '/sale/product-offers',
      data: body,
    });
    if (res.status === 202) {
      const cmdId = (res.data as { id?: string; commandId?: string })?.id ??
        (res.data as { commandId?: string })?.commandId;
      return { status: 202, commandId: cmdId, offer: res.data };
    }
    return { status: res.status, offer: res.data };
  }

  async patchOffer(offerId: string, body: unknown): Promise<AllegroOffer> {
    const res = await this.withRetry<AllegroOffer>({
      method: 'PATCH',
      url: `/sale/product-offers/${encodeURIComponent(offerId)}`,
      data: body,
    });
    return res.data;
  }

  async getCommandStatus(commandId: string): Promise<PublicationCommandStatus> {
    const res = await this.withRetry<PublicationCommandStatus>({
      method: 'GET',
      url: `/sale/offer-publication-commands/${encodeURIComponent(commandId)}`,
    });
    return res.data;
  }

  // ---- GPSR: responsible persons & producers ----

  async listResponsiblePersons(): Promise<ResponsiblePerson[]> {
    // limit=1000 is Allegro's documented max for this endpoint — a seller's
    // GPSR dictionary is small, so a single page covers it (no pagination).
    const res = await this.withRetry<{ responsiblePersons?: ResponsiblePerson[] }>({
      method: 'GET',
      url: '/sale/responsible-persons',
      params: { limit: 1000 },
    });
    return res.data.responsiblePersons ?? [];
  }

  async getResponsiblePerson(id: string): Promise<ResponsiblePerson> {
    const res = await this.withRetry<ResponsiblePerson>({
      method: 'GET',
      url: `/sale/responsible-persons/${encodeURIComponent(id)}`,
    });
    return res.data;
  }

  async createResponsiblePerson(body: unknown): Promise<ResponsiblePerson> {
    const res = await this.withRetry<ResponsiblePerson>({
      method: 'POST',
      url: '/sale/responsible-persons',
      data: body,
    });
    return res.data;
  }

  async listResponsibleProducers(): Promise<ResponsibleProducer[]> {
    // limit=1000 is Allegro's documented max for this endpoint — a seller's
    // GPSR dictionary is small, so a single page covers it (no pagination).
    const res = await this.withRetry<{ responsibleProducers?: ResponsibleProducer[] }>({
      method: 'GET',
      url: '/sale/responsible-producers',
      params: { limit: 1000 },
    });
    return res.data.responsibleProducers ?? [];
  }

  async getResponsibleProducer(id: string): Promise<ResponsibleProducer> {
    const res = await this.withRetry<ResponsibleProducer>({
      method: 'GET',
      url: `/sale/responsible-producers/${encodeURIComponent(id)}`,
    });
    return res.data;
  }

  async createResponsibleProducer(body: unknown): Promise<ResponsibleProducer> {
    const res = await this.withRetry<ResponsibleProducer>({
      method: 'POST',
      url: '/sale/responsible-producers',
      data: body,
    });
    return res.data;
  }

  // ---- helpers required for new offer body ----

  async listShippingRates(): Promise<Array<{ id: string; name: string }>> {
    const res = await this.withRetry<{
      shippingRates: Array<{ id: string; name: string }>;
    }>({
      method: 'GET',
      url: '/sale/shipping-rates',
      params: { 'seller.id': 'me' },
    });
    return res.data.shippingRates ?? [];
  }

  async listReturnPolicies(): Promise<Array<{ id: string; name: string }>> {
    const res = await this.withRetry<{
      returnPolicies: Array<{ id: string; name: string }>;
    }>({
      method: 'GET',
      url: '/after-sales-service-conditions/return-policies',
    });
    return res.data.returnPolicies ?? [];
  }

  async listImpliedWarranties(): Promise<Array<{ id: string; name: string }>> {
    const res = await this.withRetry<{
      impliedWarranties: Array<{ id: string; name: string }>;
    }>({
      method: 'GET',
      url: '/after-sales-service-conditions/implied-warranties',
    });
    return res.data.impliedWarranties ?? [];
  }

  // ---- catalog search + product proposals ----

  async matchCategories(name: string): Promise<Array<{
    id: string;
    name: string;
    leaf?: boolean;
    parent?: { id: string };
  }>> {
    const res = await this.withRetry<{
      matchingCategories: Array<{ id: string; name: string; leaf?: boolean; parent?: { id: string } }>;
    }>({
      method: 'GET',
      url: '/sale/matching-categories',
      params: { name },
    });
    return res.data.matchingCategories ?? [];
  }

  /**
   * Propose a new product to the Allegro catalog.
   *
   * Returns:
   *   - { status: 201, product }            — created
   *   - { status: 409, existingLocation }   — already exists (URL from Location header)
   */
  async proposeProduct(body: unknown): Promise<{
    status: number;
    product?: {
      id: string;
      name: string;
      category?: { id: string };
      images?: Array<{ url: string }>;
      parameters?: Array<{ id: string; values?: string[]; valuesIds?: string[] }>;
      publication?: { status: 'PROPOSED' | 'LISTED' };
      [k: string]: unknown;
    };
    existingLocation?: string;
  }> {
    // We bypass withRetry's 4xx → AbortError because 409 here is a meaningful
    // outcome (product already exists), not a fatal error. Use the raw http
    // pipeline + manual token handling.
    const token = await this.oauth.getAccessToken();
    const res = await this.http.request({
      method: 'POST',
      url: '/sale/product-proposals',
      data: body,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 201) {
      return { status: 201, product: res.data };
    }
    if (res.status === 409) {
      const location = (res.headers as Record<string, string | undefined>)['location'];
      return { status: 409, existingLocation: location };
    }
    throw new AllegroApiError(res.status, res.data, this.formatError(res));
  }

  // ---- image upload (different host: upload.allegro.pl) ----

  private async uploadHttp(
    config: AxiosRequestConfig,
  ): Promise<AxiosResponse<{ location?: string; expiresAt?: string }>> {
    const token = await this.oauth.getAccessToken();
    const res = await axios.request<{ location?: string; expiresAt?: string }>({
      baseURL: this.cfg.uploadUrl,
      validateStatus: () => true,
      maxBodyLength: 50 * 1024 * 1024,
      maxContentLength: 50 * 1024 * 1024,
      ...config,
      headers: {
        ...(config.headers ?? {}),
        Authorization: `Bearer ${token}`,
        Accept: ACCEPT,
      },
    });
    if (res.status >= 400) {
      throw new AllegroApiError(res.status, res.data, this.formatError(res));
    }
    return res;
  }

  async uploadImageByUrl(url: string): Promise<{ location: string; expiresAt?: string }> {
    // We do NOT use Allegro's "upload by link" mode (`POST /sale/images { url }`),
    // because when the URL is already on Allegro's CDN (a.allegroimg.com/…) the
    // service dedupes and returns the SAME URL — which then fails as
    // ConstraintViolationException.DescriptionImageNotAttached on product proposals.
    //
    // Instead, fetch bytes ourselves and re-upload as binary. That guarantees a
    // fresh upload entry that's "attachable" to the new proposal.
    const dl = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxContentLength: 12 * 1024 * 1024,
      validateStatus: () => true,
    });
    if (dl.status >= 400) {
      throw new AllegroApiError(
        dl.status,
        null,
        `Не удалось скачать картинку (${dl.status}) ${url}`,
      );
    }
    const rawCt = String(dl.headers['content-type'] ?? '')
      .toLowerCase()
      .split(';')[0]
      .trim();
    const ct: 'image/jpeg' | 'image/png' | 'image/webp' =
      rawCt === 'image/png' || rawCt === 'image/webp' ? rawCt : 'image/jpeg';
    return this.uploadImageBinary(Buffer.from(dl.data), ct);
  }

  async uploadImageBinary(
    buffer: Buffer,
    contentType: 'image/jpeg' | 'image/png' | 'image/webp',
  ): Promise<{ location: string; expiresAt?: string }> {
    const res = await this.uploadHttp({
      method: 'POST',
      url: '/sale/images',
      data: buffer,
      headers: { 'Content-Type': contentType },
    });
    return { location: res.data.location ?? '', expiresAt: res.data.expiresAt };
  }
}

export function isAllegroAxiosError(err: unknown): err is AxiosError {
  return axios.isAxiosError(err);
}
