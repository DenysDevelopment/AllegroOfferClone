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
    nock(BASE)
      .get('/api/v1/gallery/folders/nope/photos')
      .times(2)
      .reply(404, { error: 'folder_not_found' });

    await expect(client().getFolder('nope')).rejects.toMatchObject({
      name: 'CrmApiError',
      status: 404,
    });
    await expect(client().getFolder('nope')).rejects.toBeInstanceOf(CrmApiError);
  });
});
