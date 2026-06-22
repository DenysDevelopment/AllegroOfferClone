import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStoredPref, resolveTheme } from './theme';

describe('resolveTheme', () => {
	it('returns the explicit preference unchanged', () => {
		expect(resolveTheme('light')).toBe('light');
		expect(resolveTheme('dark')).toBe('dark');
	});

	it('resolves "system" via prefers-color-scheme', () => {
		vi.stubGlobal('matchMedia', (q: string) => ({
			matches: q.includes('dark'),
			media: q,
			addEventListener() {},
			removeEventListener() {},
		}));
		expect(resolveTheme('system')).toBe('dark');
	});
});

describe('getStoredPref', () => {
	afterEach(() => localStorage.clear());

	it('defaults to "system" when nothing is stored', () => {
		expect(getStoredPref()).toBe('system');
	});

	it('reads a stored explicit preference', () => {
		localStorage.setItem('allegro.theme', 'dark');
		expect(getStoredPref()).toBe('dark');
	});

	it('falls back to "system" for an unknown stored value', () => {
		localStorage.setItem('allegro.theme', 'banana');
		expect(getStoredPref()).toBe('system');
	});
});
