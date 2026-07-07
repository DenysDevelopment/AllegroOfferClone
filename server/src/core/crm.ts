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
