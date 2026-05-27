import { describe, expect, it, vi } from 'vitest';
import {
	finalizeDescriptionForAllegro,
	sanitizeAllegroHtml,
} from './descriptionSanitize';

describe('sanitizeAllegroHtml', () => {
	it('maps <strong> to <b>', () => {
		expect(sanitizeAllegroHtml('<strong>x</strong>')).toBe('<p><b>x</b></p>');
	});

	it('keeps <b> as <b>', () => {
		expect(sanitizeAllegroHtml('<b>x</b>')).toBe('<p><b>x</b></p>');
	});

	it('wraps bare text in <p>', () => {
		expect(sanitizeAllegroHtml('plain text')).toBe('<p>plain text</p>');
	});

	it('unwraps unallowed tags (e.g. <em>, <span>)', () => {
		expect(sanitizeAllegroHtml('<em>x</em>')).toBe('<p>x</p>');
		expect(sanitizeAllegroHtml('<span class="x">y</span>')).toBe('<p>y</p>');
	});

	it('keeps <h1> / <h2> / <ul> / <ol> / <li>', () => {
		expect(sanitizeAllegroHtml('<h1>title</h1>')).toBe('<h1>title</h1>');
		expect(sanitizeAllegroHtml('<ul><li>a</li></ul>')).toBe(
			'<ul><li>a</li></ul>',
		);
	});

	it('returns empty string for empty input', () => {
		expect(sanitizeAllegroHtml('')).toBe('');
		expect(sanitizeAllegroHtml('   ')).toBe('');
	});
});

describe('finalizeDescriptionForAllegro', () => {
	it('sanitizes TEXT items and re-uploads IMAGE URLs', async () => {
		const upload = vi.fn(async (url: string) => ({
			location: `attached:${url}`,
		}));
		const r = await finalizeDescriptionForAllegro(
			{
				sections: [
					{
						items: [
							{ type: 'TEXT', content: '<strong>Hi</strong>' },
							{ type: 'IMAGE', url: 'http://x/a.jpg' },
						],
					},
				],
			},
			upload,
		);
		expect(r.sections).toEqual([
			{
				items: [
					{ type: 'TEXT', content: '<p><b>Hi</b></p>' },
					{ type: 'IMAGE', url: 'attached:http://x/a.jpg' },
				],
			},
		]);
		expect(upload).toHaveBeenCalledOnce();
		expect(upload).toHaveBeenCalledWith('http://x/a.jpg');
	});

	it('drops empty TEXT items and empty sections', async () => {
		const upload = vi.fn(async (url: string) => ({ location: `att:${url}` }));
		const r = await finalizeDescriptionForAllegro(
			{
				sections: [
					{ items: [{ type: 'TEXT', content: '   ' }] },
					{
						items: [
							{ type: 'TEXT', content: 'real' },
							{ type: 'IMAGE', url: '   ' },
						],
					},
				],
			},
			upload,
		);
		expect(r.sections).toEqual([
			{ items: [{ type: 'TEXT', content: '<p>real</p>' }] },
		]);
		expect(upload).not.toHaveBeenCalled();
	});

	it('throws a clear error when upload fails', async () => {
		const upload = vi.fn(async () => {
			throw new Error('boom');
		});
		await expect(
			finalizeDescriptionForAllegro(
				{
					sections: [{ items: [{ type: 'IMAGE', url: 'http://x/y.jpg' }] }],
				},
				upload,
			),
		).rejects.toThrow(/http:\/\/x\/y\.jpg.*boom/);
	});
});
