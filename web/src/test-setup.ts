import { beforeAll } from 'vitest';

class MemoryStorage implements Storage {
	private store = new Map<string, string>();
	get length() {
		return this.store.size;
	}
	clear() {
		this.store.clear();
	}
	getItem(key: string) {
		return this.store.has(key) ? this.store.get(key)! : null;
	}
	key(index: number) {
		return Array.from(this.store.keys())[index] ?? null;
	}
	removeItem(key: string) {
		this.store.delete(key);
	}
	setItem(key: string, value: string) {
		this.store.set(key, String(value));
	}
}

function isFunctionalStorage(s: unknown): boolean {
	try {
		if (!s) return false;
		const st = s as Storage;
		st.setItem('__probe__', '1');
		st.removeItem('__probe__');
		return true;
	} catch {
		return false;
	}
}

// Node 25 ships a non-functional `localStorage` global that jsdom does not
// override. Install an in-memory Storage whenever the active global is
// missing or throws — independent of any jsdom internal object graph.
beforeAll(() => {
	if (!isFunctionalStorage(globalThis.localStorage)) {
		Object.defineProperty(globalThis, 'localStorage', {
			value: new MemoryStorage(),
			configurable: true,
			writable: true,
		});
	}
});
