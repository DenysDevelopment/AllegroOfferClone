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
