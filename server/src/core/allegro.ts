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
    limit?: number;
  }): Promise<ProductSearchHit[]> {
    const params: Record<string, string> = { phrase: opts.phrase };
    if (opts.categoryId) params['category.id'] = opts.categoryId;
    if (opts.limit) params['limit'] = String(opts.limit);

    const res = await this.withRetry<ProductSearchResponse>({
      method: 'GET',
      url: '/sale/products',
      params,
    });
    return res.data.products ?? [];
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
}

export function isAllegroAxiosError(err: unknown): err is AxiosError {
  return axios.isAxiosError(err);
}
