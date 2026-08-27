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
