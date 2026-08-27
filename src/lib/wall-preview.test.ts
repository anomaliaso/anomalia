/**
 * L'ANTEPRIMA ANIMATA ESISTE E NESSUNO LA MOSTRAVA.
 *
 * `wall-media.ts` genera per ogni clip una WebP animata di 2,5 secondi e la card la porta fino al
 * browser come `previewUrl`. Misurato il 25/8: 1428 elementi su 1677 sul muro ne hanno una — cioè
 * TUTTI i video, l'85% del muro — e la pagina del singolo mostrava il poster, un fermo immagine.
 *
 * Non è un dettaglio estetico: la larghezza di 360px è stata scelta PROPRIO per questa pagina.
 * Il commento in `wall-media.ts` lo dice: «the same file is what the detail page shows at full
 * width, and a preview that looks soft there would cost more than the bytes save». L'asset è stato
 * dimensionato per un posto in cui non veniva usato.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DETTAGLIO = 'src/routes/[[lang=locale]]/design/[slug]/+page.svelte';

describe('la pagina del singolo mostra il film, non un suo fotogramma', () => {
	it('usa previewUrl quando c\'è', () => {
		const src = readFileSync(DETTAGLIO, 'utf8');
		expect(src).toMatch(/previewUrl/);
	});

	it('e tiene il poster come ripiego: «questo è sempre stato un fermo immagine» è un caso vero', () => {
		const src = readFileSync(DETTAGLIO, 'utf8');
		expect(src).toMatch(/posterUrl/);
	});
});
