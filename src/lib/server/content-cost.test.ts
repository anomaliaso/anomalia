import { describe, expect, it } from 'vitest';
import { creditsForPost, creditsForBatch, budgetBrief, videoCredits, IMAGE_CREDITS } from './content-cost';

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
    expect(creditsForPost({ format: 'video' })).toBe(videoCredits() + IMAGE_CREDITS);
  });

  // Il prezzo di una clip cambia di 17× fra i due modelli: grok (default) mediana $0.12,
  // seedance-2-5 (ads a 22s) mediana $2.10. Un numero unico sbaglia su entrambi, e nel prompt
  // diventa il consiglio sbagliato sulla decisione più cara che l'agente prende.
  it('prezza la clip dal modello che gira davvero, non da una media', () => {
    expect(videoCredits('grok-imagine-video-1-5-preview')).toBeLessThan(videoCredits('bytedance/seedance-2-5'));
  });

  it('col modello di default un video vale poche immagini, non una storia intera', () => {
    const ratio = (videoCredits('grok-imagine-video-1-5-preview') + IMAGE_CREDITS) / IMAGE_CREDITS;
    expect(ratio).toBeLessThan(4);
  });

  it('un modello sconosciuto si prezza al più caro: sottostimare fa partire lavori che non finiscono', () => {
    expect(videoCredits('un-modello-mai-visto')).toBe(videoCredits('bytedance/seedance-2-5'));
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
