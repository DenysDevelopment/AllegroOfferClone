import { describe, expect, it } from 'vitest';
import { detectLayout, relayoutSection } from './descriptionLayout';
import type { DescriptionItem } from '../api';

const T = (content: string): DescriptionItem => ({ type: 'TEXT', content });
const I = (url: string): DescriptionItem => ({ type: 'IMAGE', url });

describe('detectLayout', () => {
  it('detects single text/image', () => {
    expect(detectLayout([T('a')])).toBe('text');
    expect(detectLayout([I('u')])).toBe('image');
  });
  it('detects two-item layouts', () => {
    expect(detectLayout([T('a'), I('u')])).toBe('text-image');
    expect(detectLayout([I('u'), T('a')])).toBe('image-text');
    expect(detectLayout([I('u'), I('v')])).toBe('image-image');
  });
  it('falls back to text for empty or [TEXT,TEXT]', () => {
    expect(detectLayout([])).toBe('text');
    expect(detectLayout([T('a'), T('b')])).toBe('text');
  });
});

describe('relayoutSection', () => {
  it('text -> text-image keeps text, adds empty image', () => {
    expect(relayoutSection([T('hello')], 'text-image')).toEqual([
      T('hello'),
      I(''),
    ]);
  });
  it('image-image -> text keeps no image, single empty text', () => {
    expect(relayoutSection([I('a'), I('b')], 'text')).toEqual([T('')]);
  });
  it('text-image -> image-text preserves content by type', () => {
    expect(relayoutSection([T('hi'), I('pic')], 'image-text')).toEqual([
      I('pic'),
      T('hi'),
    ]);
  });
  it('empty section -> image-image yields two empty images', () => {
    expect(relayoutSection([], 'image-image')).toEqual([I(''), I('')]);
  });
});
