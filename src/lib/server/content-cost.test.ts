import { describe, expect, it } from 'vitest';
import { creditsForPost, creditsForBatch, budgetBrief, VIDEO_CREDITS, IMAGE_CREDITS } from './content-cost';

describe('creditsForPost', () => {
  it('un post di testo non costa niente da produrre', () => {
    expect(creditsForPost({ format: 'text_post' })).toBe(0);
    expect(creditsForPost({ format: 'link_post' })).toBe(0);
  });

  it("un'immagine singola costa un render", () => {
    expect(creditsForPost({ format: 'single_image' })).toBe(IMAGE_CREDITS);
  });

  it('un carosello costa quante sono le sue slide', () => {
    expect(creditsForPost({ format: 'carousel', slideCount: 6 })).toBe(6 * IMAGE_CREDITS);
  });

  it('un carosello senza conteggio usa il default di 5 slide, non zero', () => {
    expect(creditsForPost({ format: 'carousel' })).toBe(5 * IMAGE_CREDITS);
  });

  it('un video costa la clip più la sua copertina', () => {
    expect(creditsForPost({ format: 'video' })).toBe(VIDEO_CREDITS + IMAGE_CREDITS);
  });

  // Il commento nel codice diceva ~25×. Misurato su 97 render veri: ~16×. Un rapporto sbagliato
  // nel prompt fa scegliere male all'agente, ed è il numero su cui si decide il mix.
  it('un video vale una quindicina di immagini, non venticinque', () => {
    const ratio = (VIDEO_CREDITS + IMAGE_CREDITS) / IMAGE_CREDITS;
    expect(ratio).toBeGreaterThan(12);
    expect(ratio).toBeLessThan(20);
  });
});

describe('creditsForBatch', () => {
  it('somma i post e aggiunge il costo fisso di pianificazione', () => {
    const posts = [{ format: 'single_image' as const }, { format: 'single_image' as const }];
    expect(creditsForBatch(posts)).toBeGreaterThan(2 * IMAGE_CREDITS);
  });

  it('un batch vuoto costa comunque la pianificazione', () => {
    expect(creditsForBatch([])).toBeGreaterThan(0);
  });
});

describe('budgetBrief', () => {
  it('dice quanti crediti restano e quanto costa ogni formato', () => {
    const brief = budgetBrief(400);
    expect(brief).toContain('400');
    expect(brief).toMatch(/carousel/i);
    expect(brief).toMatch(/video/i);
  });

  it('è vuoto quando il budget non si sa: nessun brief inventato', () => {
    expect(budgetBrief(null)).toBe('');
  });
});
