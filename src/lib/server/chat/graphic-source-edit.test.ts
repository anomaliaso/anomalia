import { describe, expect, it } from 'vitest';
import { compactGraphicPersist } from './graphic-source-edit';

describe('compactGraphicPersist', () => {
	it('passes through errors', () => {
		expect(compactGraphicPersist({ error: 'old_str not found in source' })).toEqual({
			error: 'old_str not found in source'
		});
	});

	it('drops the full source and reports source_chars', () => {
		const html = '<div class="canvas">Hi</div>';
		expect(
			compactGraphicPersist(
				{
					success: true,
					post_id: 'p1',
					media_url: 'https://cdn.example/g.png',
					graphic_source: html,
					graphic_spec: { v: 2, kind: 'html', aspect: '4:5' }
				},
				{ replaced: 1 }
			)
		).toEqual({
			ok: true,
			success: true,
			post_id: 'p1',
			media_url: 'https://cdn.example/g.png',
			source_chars: html.length,
			replaced: 1
		});
	});
});

describe('il render sopravvive al compattamento', () => {
	it('`_images` non viene scartato con la sorgente', () => {
		// La sorgente si toglie perche' e' enorme e il modello la rilegge con grep_source. Il
		// render no: e' l'unica cosa che gli fa vedere quello che ha appena composto, ed era
		// l'unico artefatto del prodotto che nessuno guardava.
		const out = compactGraphicPersist({
			success: true,
			graphic_source: '<div/>',
			graphic_spec: { blocks: [] },
			media_url: 'https://x/g.png',
			_images: [{ mimeType: 'image/png', base64: 'AAAA' }],
			reviewed: true
		});
		expect(out).toMatchObject({ ok: true, reviewed: true });
		expect((out as { _images?: unknown })._images).toEqual([{ mimeType: 'image/png', base64: 'AAAA' }]);
		expect((out as { graphic_source?: unknown }).graphic_source).toBeUndefined();
	});
})
