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

	it('keeps multiple real <p> paragraphs (regression)', () => {
		expect(sanitizeAllegroHtml('<p>a</p><p>b</p><p>c</p>')).toBe(
			'<p>a</p><p>b</p><p>c</p>',
		);
	});

	it('keeps <b> inside a paragraph', () => {
		expect(sanitizeAllegroHtml('<p>hi <b>there</b> you</p>')).toBe(
			'<p>hi <b>there</b> you</p>',
		);
	});

	// ── Paragraph-splitting: the paste bug ──────────────────────────────────

	it('splits a single <p> that carries \\n\\n into separate <p>', () => {
		expect(sanitizeAllegroHtml('<p>line one\n\nline two</p>')).toBe(
			'<p>line one</p><p>line two</p>',
		);
	});

	it('splits on U+2028 LINE SEPARATOR', () => {
		expect(sanitizeAllegroHtml('<p>a\u2028b\u2028c</p>')).toBe(
			'<p>a</p><p>b</p><p>c</p>',
		);
	});

	it('splits on U+2029 PARAGRAPH SEPARATOR', () => {
		expect(sanitizeAllegroHtml('<p>a\u2029b</p>')).toBe('<p>a</p><p>b</p>');
	});

	it('splits on a single \\n too', () => {
		expect(sanitizeAllegroHtml('<p>a\nb</p>')).toBe('<p>a</p><p>b</p>');
	});

	it('turns <br> into a paragraph break', () => {
		expect(sanitizeAllegroHtml('a<br>b<br>c')).toBe(
			'<p>a</p><p>b</p><p>c</p>',
		);
	});

	it('treats <div>-wrapped lines as separate paragraphs', () => {
		expect(sanitizeAllegroHtml('<div>a</div><div>b</div>')).toBe(
			'<p>a</p><p>b</p>',
		);
	});

	it('drops empty lines and trims trailing &nbsp;', () => {
		expect(
			sanitizeAllegroHtml('<p>a&nbsp;\n\n\n\nb\u2028\u2028</p>'),
		).toBe('<p>a</p><p>b</p>');
	});

	it('output never contains raw \\n, U+2028 or U+2029', () => {
		const out = sanitizeAllegroHtml(
			'<p>one\u2028\n\ntwo\u2029three<br>four</p>',
		);
		expect(out).not.toMatch(/[\n\u2028\u2029]/);
		expect(out).toBe('<p>one</p><p>two</p><p>three</p><p>four</p>');
	});

	it('collapses breaks inside a heading instead of dropping text', () => {
		expect(sanitizeAllegroHtml('<h2>big\u2028title</h2>')).toBe(
			'<h2>big title</h2>',
		);
	});

	it('keeps every list item when a list has internal newlines', () => {
		expect(
			sanitizeAllegroHtml('<ul>\n<li>a</li>\n<li>b</li>\n</ul>'),
		).toBe('<ul><li>a</li><li>b</li></ul>');
	});

	// ── The exact real-world content that triggered the bug report ──────────

	it('reproduces the report: pasted 6-bullet blob → 6 clean <p>, no loss', () => {
		const LS = '\u2028';
		const pasted =
			'<p>✅ Na życzenie przed zakupem możemy wysłać krótki filmik wideo dokładnie tego&nbsp;\n\n' +
			'✅ egzemplarza, który otrzymasz.' + LS + '\n\n' +
			'✅ Laptop jest gotowy do pracy zaraz po wyjęciu z pudełka.' + LS + '\n\n' +
			'✅ Jest w pełni sprawny technicznie' + LS + '\n\n' +
			'✅ Wszystkie funkcje działają w 100%' + LS + '\n\n' +
			'✅ Zainstalowany Windows 11 Pro' + LS + '\n\n' +
			'✅ Po serwisie i dokładnym czyszczeniu\n\n\n\n</p>';
		const out = sanitizeAllegroHtml(pasted);
		const paragraphs = out.match(/<p>.*?<\/p>/g) ?? [];
		expect(paragraphs).toHaveLength(7);
		// none of the lines are dropped or truncated
		expect(out).toContain('<p>✅ Jest w pełni sprawny technicznie</p>');
		expect(out).toContain(
			'<p>✅ Na życzenie przed zakupem możemy wysłać krótki filmik wideo dokładnie tego</p>',
		);
		expect(out).toContain('<p>✅ egzemplarza, który otrzymasz.</p>');
		expect(out).toContain('<p>✅ Po serwisie i dokładnym czyszczeniu</p>');
		// clean output — Allegro gets no exotic separators
		expect(out).not.toMatch(/[\n\u2028\u2029]/);
		expect(out).not.toContain('&nbsp;');
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
