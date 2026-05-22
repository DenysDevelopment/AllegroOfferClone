import { describe, expect, it } from 'vitest';
import type { OfferParameter } from '../api';
import {
  buildVarMap,
  chipsHtmlToTokens,
  escapeHtml,
  flattenVars,
  tokensToChipsHtml,
} from './shortcodes';

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
    expect(result.sections.sections[0].items[0].content).toBe('{{Gone}}');
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
    expect(result.sections.sections[0].items[0].content).toBe('&lt;b&gt;');
  });
});
