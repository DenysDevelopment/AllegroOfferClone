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
