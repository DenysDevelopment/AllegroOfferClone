import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Two distinct source offers. The bug: after editing images/description on the
// FIRST offer and then loading the SECOND, the editors kept the FIRST offer's
// images/description (a previous product leaking into the next clone). We assert
// the gallery is reseeded from the offer that's actually loaded.
const fx = vi.hoisted(() => {
	const mkPreview = (id: string, name: string, imgs: string[]) => ({
		id,
		name,
		publication: { status: 'ACTIVE' },
		sellingMode: { price: { amount: id === 'A' ? '100' : '200', currency: 'PLN' } },
		stock: { available: id === 'A' ? 1 : 2, unit: 'UNIT' },
		images: imgs.map(url => ({ url })),
		product: { id: `prod-${id}`, name, images: [] },
		parameters: [],
		categoryParameters: [],
		description: {
			sections: [{ items: [{ type: 'TEXT', content: `Opis ${name}` }] }],
		},
	});
	return {
		previewA: mkPreview('A', 'Lenovo ThinkPad L460', [
			'https://img/a1.jpg',
			'https://img/a2.jpg',
		]),
		previewB: mkPreview('B', 'DELL Latitude 5310', [
			'https://img/b1.jpg',
			'https://img/b2.jpg',
		]),
	};
});

vi.mock('./api', () => ({
	setActiveAccountIdGetter: vi.fn(),
	api: {
		accounts: vi.fn().mockResolvedValue({
			accounts: [
				{
					id: 'acc1',
					label: 'Main',
					connected: true,
					hasCredentials: true,
					env: 'production',
				},
			],
			defaultAccountId: 'acc1',
		}),
		descriptionTemplates: { list: vi.fn().mockResolvedValue({ templates: [] }) },
		offerPreview: vi.fn((id: string) =>
			Promise.resolve(id === 'A' ? fx.previewA : fx.previewB),
		),
		gpsr: {
			listProducers: vi.fn().mockResolvedValue({ producers: [] }),
			listPersons: vi.fn().mockResolvedValue({ persons: [] }),
		},
		helpers: {
			shippingRates: vi.fn().mockResolvedValue([]),
			returnPolicies: vi.fn().mockResolvedValue([]),
			impliedWarranties: vi.fn().mockResolvedValue([]),
			warranties: vi.fn().mockResolvedValue([]),
		},
		clone: vi.fn(),
		uploadImageByUrl: vi.fn(),
	},
}));

// Import AFTER vi.mock so App binds to the mocked api module.
const { default: App } = await import('./App');

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
	(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	(globalThis as unknown as { __BUILD_SHA__: string }).__BUILD_SHA__ = 'test';
	(globalThis as unknown as { __BUILD_TIME__: string }).__BUILD_TIME__ =
		'2026-01-01T00:00:00.000Z';
	// jsdom has no execCommand; DescriptionEditor calls it on mount.
	(document as unknown as { execCommand: () => boolean }).execCommand = () => false;
});

beforeEach(() => {
	container = document.createElement('div');
	document.body.appendChild(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	vi.clearAllMocks();
});

const flush = () =>
	act(async () => {
		await new Promise(r => setTimeout(r, 0));
	});

const setInput = (el: HTMLInputElement, value: string) => {
	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		'value',
	)!.set!;
	setter.call(el, value);
	el.dispatchEvent(new Event('input', { bubbles: true }));
};

const offerIdInput = () =>
	container.querySelector('input[placeholder="ID оферты"]') as HTMLInputElement;

const loadButton = () =>
	Array.from(container.querySelectorAll('button')).find(b =>
		/Загрузить|· · ·/.test(b.textContent ?? ''),
	) as HTMLButtonElement;

// ImagesEditor renders each gallery URL as <input placeholder="https://…">.
const galleryInputs = () =>
	Array.from(
		container.querySelectorAll('input[placeholder="https://…"]'),
	) as HTMLInputElement[];
const galleryValues = () => galleryInputs().map(i => i.value);

const loadOffer = async (id: string) => {
	await act(async () => setInput(offerIdInput(), id));
	await act(async () => loadButton().dispatchEvent(new MouseEvent('click', { bubbles: true })));
	await flush();
};

describe('App — source offer seeding', () => {
	it('reseeds the gallery from the newly loaded offer, never the previous one', async () => {
		await act(async () => {
			root = createRoot(container);
			root.render(<App />);
		});
		await flush(); // accounts + templates load

		// Load offer A → gallery seeded from A.
		await loadOffer('A');
		expect(galleryValues()).toEqual(['https://img/a1.jpg', 'https://img/a2.jpg']);

		// Operator edits a gallery URL on A (sets imagesUserEdited = true).
		await act(async () =>
			setInput(galleryInputs()[0], 'https://img/a1-EDITED.jpg'),
		);
		expect(galleryValues()).toEqual([
			'https://img/a1-EDITED.jpg',
			'https://img/a2.jpg',
		]);

		// Now load a DIFFERENT offer B. The gallery MUST reseed from B, not keep A.
		await loadOffer('B');
		expect(galleryValues()).toEqual(['https://img/b1.jpg', 'https://img/b2.jpg']);
	});
});
