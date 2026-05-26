import { describe, expect, it } from 'vitest';
import type { CategoryParameter, OfferParameter } from '../api';
import {
  buildCategoryVarMap,
  buildVarMap,
  chipHtml,
  chipsHtmlToTokens,
  escapeHtml,
  expandPhotoChips,
  flattenVars,
  parsePhotoRefUrl,
  tokensToChipsHtml,
} from './shortcodes';

const catParam = (
  id: string,
  name: string,
  p: Partial<CategoryParameter> = {},
): CategoryParameter => ({ id, name, type: 'string', ...p });

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

  it('trims whitespace inside the token braces', () => {
    const html = tokensToChipsHtml('{{ SSD }}', new Map([['SSD', '512 GB']]));
    expect(html).toContain('data-var-key="SSD"');
    expect(html).toContain('SSD · 512 GB');
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

  it('round-trips multiple chips', () => {
    const chips = tokensToChipsHtml(
      '{{SSD}} and {{RAM}}',
      new Map([['SSD', '512 GB'], ['RAM', '16 GB']]),
    );
    expect(chipsHtmlToTokens(chips)).toBe('{{SSD}} and {{RAM}}');
  });

  it('round-trips a key containing an ampersand', () => {
    const chips = tokensToChipsHtml('{{A&B}}', new Map([['A&B', 'x']]));
    expect(chipsHtmlToTokens(chips)).toBe('{{A&B}}');
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
    expect(result.sections.sections[0].items[0]).toEqual({
      type: 'TEXT',
      content: '{{Gone}}',
    });
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

  it('HTML-escapes resolved values', () => {
    const result = flattenVars(
      { sections: [{ items: [{ type: 'TEXT', content: '{{X}}' }] }] },
      new Map([['X', '<b>']]),
    );
    expect(result.sections.sections[0].items[0]).toEqual({
      type: 'TEXT',
      content: '&lt;b&gt;',
    });
  });
});

describe('buildCategoryVarMap', () => {
  it('resolves a free-text parameter value', () => {
    const map = buildCategoryVarMap(
      [catParam('p1', 'Model')],
      { p1: { id: 'p1', values: ['Swift 3'] } },
    );
    expect(map.get('Model')).toBe('Swift 3');
  });

  it('resolves a dictionary value id to its text', () => {
    const map = buildCategoryVarMap(
      [
        catParam('p2', 'Marka', {
          type: 'dictionary',
          dictionary: [
            { id: 'd1', value: 'Acer' },
            { id: 'd2', value: 'Asus' },
          ],
        }),
      ],
      { p2: { id: 'p2', valuesIds: ['d2'] } },
    );
    expect(map.get('Marka')).toBe('Asus');
  });

  it('appends the parameter unit', () => {
    const map = buildCategoryVarMap(
      [catParam('p3', 'Pojemność dysku', { unit: 'GB' })],
      { p3: { id: 'p3', values: ['512'] } },
    );
    expect(map.get('Pojemność dysku')).toBe('512 GB');
  });

  it('skips parameters with no entered value', () => {
    const map = buildCategoryVarMap([catParam('p4', 'Stan')], {});
    expect(map.has('Stan')).toBe(false);
  });

  it('skips a value that resolves to empty', () => {
    const map = buildCategoryVarMap(
      [catParam('p5', 'Model')],
      { p5: { id: 'p5', values: [''] } },
    );
    expect(map.has('Model')).toBe(false);
  });

  it('joins multiple values with a comma', () => {
    const map = buildCategoryVarMap(
      [catParam('p6', 'Porty')],
      { p6: { id: 'p6', values: ['USB-C', 'HDMI'] } },
    );
    expect(map.get('Porty')).toBe('USB-C, HDMI');
  });

  it('resolves and joins multiple dictionary value ids', () => {
    const map = buildCategoryVarMap(
      [
        catParam('p7', 'Złącza', {
          type: 'dictionary',
          dictionary: [
            { id: 'd1', value: 'USB-C' },
            { id: 'd2', value: 'HDMI' },
          ],
        }),
      ],
      { p7: { id: 'p7', valuesIds: ['d1', 'd2'] } },
    );
    expect(map.get('Złącza')).toBe('USB-C, HDMI');
  });
});

describe('chipHtml — photo variant', () => {
  it('renders a photo chip with `Фото · N`', () => {
    const html = chipHtml('photo:1', new Map(), ['http://x/a.jpg']);
    expect(html).toContain('data-photo-idx="1"');
    expect(html).toContain('Фото · 1');
    expect(html).toContain('contenteditable="false"');
    expect(html).not.toContain('var-chip--missing');
  });

  it('marks a photo chip as missing when N is out of range', () => {
    const html = chipHtml('photo:5', new Map(), ['http://x/a.jpg']);
    expect(html).toContain('var-chip--missing');
    expect(html).toContain('Фото · 5 · нет');
  });

  it('does not put a data-var-key on a photo chip', () => {
    const html = chipHtml('photo:2', new Map(), ['a', 'b']);
    expect(html).not.toContain('data-var-key');
  });
});

describe('tokensToChipsHtml — photo tokens', () => {
  it('renders {{photo:N}} as a photo chip', () => {
    const html = tokensToChipsHtml('A {{photo:1}} B', new Map(), [
      'http://x/a.jpg',
    ]);
    expect(html).toContain('data-photo-idx="1"');
    expect(html).toContain('Фото · 1');
  });

  it('keeps variable tokens working alongside photo tokens', () => {
    const html = tokensToChipsHtml(
      '{{SSD}} and {{photo:1}}',
      new Map([['SSD', '512 GB']]),
      ['http://x/a.jpg'],
    );
    expect(html).toContain('data-var-key="SSD"');
    expect(html).toContain('SSD · 512 GB');
    expect(html).toContain('data-photo-idx="1"');
  });
});

describe('chipsHtmlToTokens — photo chips', () => {
  it('round-trips a photo chip', () => {
    const chips = tokensToChipsHtml('{{photo:3}}', new Map(), [
      'a',
      'b',
      'c',
    ]);
    expect(chipsHtmlToTokens(chips)).toBe('{{photo:3}}');
  });

  it('round-trips a mix of variable and photo chips', () => {
    const chips = tokensToChipsHtml(
      'X {{SSD}} Y {{photo:2}} Z',
      new Map([['SSD', '512 GB']]),
      ['a', 'b'],
    );
    expect(chipsHtmlToTokens(chips)).toBe('X {{SSD}} Y {{photo:2}} Z');
  });
});

describe('expandPhotoChips', () => {
  it('splits a TEXT item around a resolved photo token', () => {
    const r = expandPhotoChips(
      { sections: [{ items: [{ type: 'TEXT', content: 'A {{photo:1}} B' }] }] },
      ['http://x/a.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'TEXT', content: 'A ' },
      { type: 'IMAGE', url: 'http://x/a.jpg' },
      { type: 'TEXT', content: ' B' },
    ]);
    expect(r.unresolved).toEqual([]);
  });

  it('handles multiple photo tokens in one TEXT item', () => {
    const r = expandPhotoChips(
      {
        sections: [
          { items: [{ type: 'TEXT', content: '{{photo:1}}{{photo:2}} tail' }] },
        ],
      },
      ['http://x/a.jpg', 'http://x/b.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'IMAGE', url: 'http://x/a.jpg' },
      { type: 'IMAGE', url: 'http://x/b.jpg' },
      { type: 'TEXT', content: ' tail' },
    ]);
  });

  it('drops empty TEXT pieces when chips are at the edges', () => {
    const r = expandPhotoChips(
      { sections: [{ items: [{ type: 'TEXT', content: '{{photo:1}}' }] }] },
      ['http://x/a.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'IMAGE', url: 'http://x/a.jpg' },
    ]);
  });

  it('leaves an out-of-range token in the TEXT and reports it', () => {
    const r = expandPhotoChips(
      { sections: [{ items: [{ type: 'TEXT', content: 'A {{photo:7}} B' }] }] },
      ['http://x/a.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'TEXT', content: 'A {{photo:7}} B' },
    ]);
    expect(r.unresolved).toEqual(['photo:7']);
  });

  it('preserves an IMAGE item untouched', () => {
    const r = expandPhotoChips(
      { sections: [{ items: [{ type: 'IMAGE', url: 'http://x/y.jpg' }] }] },
      [],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'IMAGE', url: 'http://x/y.jpg' },
    ]);
  });

  it('returns the original TEXT item when it has no photo tokens', () => {
    const original = {
      sections: [{ items: [{ type: 'TEXT' as const, content: 'plain text' }] }],
    };
    const r = expandPhotoChips(original, ['a']);
    expect(r.sections.sections[0].items[0]).toEqual({
      type: 'TEXT',
      content: 'plain text',
    });
  });

  it('handles a whitespace-padded token {{ photo:1 }}', () => {
    const r = expandPhotoChips(
      { sections: [{ items: [{ type: 'TEXT', content: 'A {{ photo:1 }} B' }] }] },
      ['http://x/a.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'TEXT', content: 'A ' },
      { type: 'IMAGE', url: 'http://x/a.jpg' },
      { type: 'TEXT', content: ' B' },
    ]);
  });

  it('mixes resolved and unresolved tokens in a single TEXT item', () => {
    const r = expandPhotoChips(
      {
        sections: [
          {
            items: [
              { type: 'TEXT', content: 'A {{photo:1}} and {{photo:7}} B' },
            ],
          },
        ],
      },
      ['http://x/a.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'TEXT', content: 'A ' },
      { type: 'IMAGE', url: 'http://x/a.jpg' },
      { type: 'TEXT', content: ' and {{photo:7}} B' },
    ]);
    expect(r.unresolved).toEqual(['photo:7']);
  });
});

describe('parsePhotoRefUrl', () => {
  it('parses {{photo:N}} into a 1-based index', () => {
    expect(parsePhotoRefUrl('{{photo:1}}')).toEqual({ idx: 1 });
    expect(parsePhotoRefUrl('{{photo:42}}')).toEqual({ idx: 42 });
  });

  it('returns null for an ordinary URL', () => {
    expect(parsePhotoRefUrl('https://cdn.allegro.pl/x.jpg')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parsePhotoRefUrl('')).toBeNull();
  });

  it('does not match when there is text around the token', () => {
    expect(parsePhotoRefUrl(' {{photo:1}}')).toBeNull();
    expect(parsePhotoRefUrl('{{photo:1}}/')).toBeNull();
    expect(parsePhotoRefUrl('A {{photo:1}} B')).toBeNull();
  });

  it('does not match when there is whitespace inside the braces', () => {
    expect(parsePhotoRefUrl('{{ photo:1 }}')).toBeNull();
  });
});

describe('expandPhotoChips — IMAGE items', () => {
  it('resolves a photo-ref IMAGE item to a real-URL IMAGE item', () => {
    const r = expandPhotoChips(
      { sections: [{ items: [{ type: 'IMAGE', url: '{{photo:1}}' }] }] },
      ['http://x/a.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'IMAGE', url: 'http://x/a.jpg' },
    ]);
    expect(r.unresolved).toEqual([]);
  });

  it('drops an out-of-range photo-ref IMAGE item and reports the key', () => {
    const r = expandPhotoChips(
      { sections: [{ items: [{ type: 'IMAGE', url: '{{photo:7}}' }] }] },
      ['http://x/a.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([]);
    expect(r.unresolved).toEqual(['photo:7']);
  });

  it('passes a real-URL IMAGE item through unchanged', () => {
    const r = expandPhotoChips(
      {
        sections: [
          { items: [{ type: 'IMAGE', url: 'http://x/keep.jpg' }] },
        ],
      },
      ['http://x/other.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'IMAGE', url: 'http://x/keep.jpg' },
    ]);
  });

  it('handles TEXT with inline chip + IMAGE photo-ref in one section', () => {
    const r = expandPhotoChips(
      {
        sections: [
          {
            items: [
              { type: 'TEXT', content: 'before {{photo:1}} after' },
              { type: 'IMAGE', url: '{{photo:2}}' },
            ],
          },
        ],
      },
      ['http://x/a.jpg', 'http://x/b.jpg'],
    );
    expect(r.sections.sections[0].items).toEqual([
      { type: 'TEXT', content: 'before ' },
      { type: 'IMAGE', url: 'http://x/a.jpg' },
      { type: 'TEXT', content: ' after' },
      { type: 'IMAGE', url: 'http://x/b.jpg' },
    ]);
    expect(r.unresolved).toEqual([]);
  });
});
