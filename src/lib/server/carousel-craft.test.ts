import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CAROUSEL_CRAFT } from './carousel-craft';

/**
 * IL MESTIERE NON SI PARAFRASA. Se «ripeti gli STESSI 2-3 gettoni ALLA LETTERA» diventa «mantieni
 * uno stile coerente», la logica e' persa e nessun altro test se ne accorge: le immagini tornano
 * comunque, solo scollegate. Queste asserzioni tengono ferme le parole che portano il peso.
 */
describe('CAROUSEL_CRAFT', () => {
  it('dice ALLA LETTERA, non «coerente»', () => {
    expect(CAROUSEL_CRAFT).toContain('verbatim in EVERY slide prompt');
    expect(CAROUSEL_CRAFT).toContain('SAME 2-3 continuity tokens');
  });

  it('dice cosa sono i gettoni, invece di lasciarlo indovinare', () => {
    expect(CAROUSEL_CRAFT).toContain('palette words, recurring motif, lighting phrase');
  });

  it('tiene la regola della copertina a dimensione miniatura', () => {
    expect(CAROUSEL_CRAFT).toContain('THUMBNAIL size');
    expect(CAROUSEL_CRAFT).toContain('at most 4 quoted words');
  });

  it('tiene la regola di una idea per slide, con il suo esempio', () => {
    expect(CAROUSEL_CRAFT).toContain('exactly ONE idea');
    expect(CAROUSEL_CRAFT).toContain('two sentences to describe is two slides');
  });

  it('e la STESSA copia che usa il percorso dei post, non una seconda', () => {
    // Due copie divergono alla prima correzione, e la meta' vecchia continua a girare in silenzio.
    const batchPrompt = readFileSync(
      fileURLToPath(new URL('./content-preview/caption-quality.ts', import.meta.url)),
      'utf8'
    );
    expect(batchPrompt).toContain('${CAROUSEL_CRAFT}');
    expect(batchPrompt).not.toContain('CAROUSEL CRAFT (hard): the COVER');
  });
});
