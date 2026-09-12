import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Il modello con cui si disegna quando il brand non ha scelto, e la rotta dello slot, devono dire
 * la STESSA cosa. Erano due costanti separate: lo slot poteva puntare a una famiglia e il render
 * partire con l'id di un'altra, e il trasporto si sceglieva sull'id — cioè la rotta si leggeva
 * come rispettata senza esserlo. Qui il default LEGGE la rotta, così non possono divergere.
 */
const M = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: M.env }));

describe('il modello di default delle immagini', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(M.env)) delete M.env[k];
  });

  it('segue la famiglia dello slot: su gpt-image è Sunburst', async () => {
    M.env.OPENROUTER_API_KEY = 'o';
    M.env.KIE_API_KEY = 'k';
    const { defaultImageModel } = await import('./default-image-model');
    expect(defaultImageModel()).toBe('gpt-image-2.5-sunburst');
  });

  it('quando la rotta ripiega su kie, il default torna quello di casa', async () => {
    M.env.KIE_API_KEY = 'k';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { defaultImageModel } = await import('./default-image-model');
    expect(defaultImageModel()).toBe('gemini-3.1-flash-lite-image');
    warn.mockRestore();
  });

  it('una rotta scelta a mano decide anche il modello', async () => {
    M.env.OPENROUTER_API_KEY = 'o';
    M.env.KIE_API_KEY = 'k';
    M.env.AI_ROUTE_IMAGE = 'nano-banana@openrouter';
    const { defaultImageModel } = await import('./default-image-model');
    expect(defaultImageModel()).toBe('gemini-3.1-flash-lite-image');
  });
});
