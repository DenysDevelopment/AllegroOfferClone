import { describe, expect, it } from 'vitest';
import { validateAllegroBody } from './body-validate.js';

const T = (content: string) => ({ type: 'TEXT' as const, content });
const I = (url: string) => ({ type: 'IMAGE' as const, url });

function offerBody(sections: Array<{ items: unknown[] }>) {
  return {
    images: ['https://img/1'],
    description: { sections },
  } as Record<string, unknown>;
}

describe('validateAllegroBody — description rows', () => {
  it('flags a [TEXT, TEXT] section as an error', () => {
    const issues = validateAllegroBody(offerBody([{ items: [T('a'), T('b')] }]), 'offer');
    const hit = issues.find(i => i.path === 'description.sections[0].items');
    expect(hit?.level).toBe('error');
    expect(hit?.message).toContain('TEXT');
  });

  it('accepts valid two-item layouts', () => {
    const issues = validateAllegroBody(
      offerBody([
        { items: [T('a'), I('https://img/1')] },
        { items: [I('https://img/1'), I('https://img/1')] },
      ]),
      'offer',
    );
    expect(issues.filter(i => i.level === 'error')).toHaveLength(0);
  });
});
