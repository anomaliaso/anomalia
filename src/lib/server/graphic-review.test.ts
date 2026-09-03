import { describe, expect, it } from 'vitest';
import { attachRenderForReview } from './graphic-review';

const png = Buffer.from('fake-png-bytes');

describe('la grafica torna a chi l\'ha chiesta', () => {
  it('allega il render quando la rotta lo regge', () => {
    const out = attachRenderForReview(png, true);
    expect(out.reviewed).toBe(true);
    expect(out._images?.[0]).toMatchObject({ mimeType: 'image/png' });
    expect(out._images?.[0].base64).toBe(png.toString('base64'));
  });

  it('quando NON lo regge lo dice, invece di allegare a vuoto', () => {
    // kie scarta i media nei risultati dei tool in silenzio. Allegare e basta significherebbe
    // credere di aver risolto su tre rotte su quattro: un modello che sa di non aver visto puo'
    // chiedere, uno che crede di aver visto consegna una headline tagliata dicendo che va bene.
    const out = attachRenderForReview(png, false);
    expect(out.reviewed).toBe(false);
    expect(out._images).toBeUndefined();
    expect(out.review_note).toMatch(/have not seen/i);
  });
});
