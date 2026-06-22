export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'allegro.theme';

export function getStoredPref(): ThemePref {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
	} catch {
		return 'system';
	}
}

export function getSystemTheme(): ResolvedTheme {
	return typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-color-scheme: dark)').matches
		? 'dark'
		: 'light';
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
	return pref === 'system' ? getSystemTheme() : pref;
}

export function applyTheme(theme: ResolvedTheme) {
	const root = document.documentElement;
	root.classList.toggle('dark', theme === 'dark');
	root.style.colorScheme = theme;
}

export function setStoredPref(pref: ThemePref) {
	try {
		localStorage.setItem(STORAGE_KEY, pref);
	} catch {
		/* ignore */
	}
}
