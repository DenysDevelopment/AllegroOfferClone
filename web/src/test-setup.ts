// Patch Node v25's non-functional built-in localStorage with jsdom's proper implementation.
// Node 25 exposes a global `localStorage` object (without --localstorage-file it has no methods),
// which prevents vitest's populateGlobal from overriding it with jsdom's real Storage.
import { beforeAll } from 'vitest';

beforeAll(() => {
	// @ts-expect-error -- jsdom is injected by vitest's jsdom environment
	const jsdomLocalStorage = globalThis.jsdom?.window?.localStorage;
	if (jsdomLocalStorage) {
		Object.defineProperty(globalThis, 'localStorage', {
			value: jsdomLocalStorage,
			writable: true,
			configurable: true,
		});
	}
});
