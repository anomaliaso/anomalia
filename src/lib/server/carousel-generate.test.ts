import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * IL TEST CHE DISTINGUE UN CAROSELLO DA N IMMAGINI SCOLLEGATE.
 *
 * «Tornano N immagini» passa anche quando le immagini non c'entrano una con l'altra, che e'
 * precisamente il difetto. Quello che si misura e' che i GETTONI DI CONTINUITA' compaiano ALLA
 * LETTERA in TUTTI i prompt di slide.
 */

const aiStructured = vi.fn();

vi.mock('$lib/server/ai-text', () => ({ aiStructured: (...a: unknown[]) => aiStructured(...a) }));
vi.mock('$lib/server/brand-context', () => ({ genaiClient: () => ({}) }));

import {
  buildCarouselPlanPrompt,
  clampSlideCount,
  enforceContinuity,
  planCarousel
} from './carousel-generate';
import { CAROUSEL_MIN_SLIDES, carouselMaxSlides } from './content-preview/seed-model';

const TOKENS = ['warm ochre palette', 'the brass compass', 'low raking window light'];

beforeEach(() => vi.clearAllMocks());

const everyPromptHasEveryToken = (prompts: string[], tokens: string[]) =>
  prompts.every((p) => tokens.every((t) => p.toLowerCase().includes(t.toLowerCase())));

describe('i gettoni di continuita', () => {
  it('compaiono ALLA LETTERA in tutti i prompt, o non e una serie', async () => {
    aiStructured.mockResolvedValue({
      continuity_tokens: TOKENS,
      // Il modello ne dimentica due nella slide 2 e uno nella 3 — succede.
      slide_prompts: [
        'Cover: a desk, warm ochre palette, the brass compass, low raking window light',
        'A hand reaching, warm ochre palette',
        'The map unfolds, the brass compass, low raking window light'
      ]
    });

    const plan = await planCarousel({} as never, { brandId: 'b', brief: 'un viaggio', slides: 3 });

    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(everyPromptHasEveryToken(plan.slidePrompts, TOKENS)).toBe(true);
  });

  it('un gettone mancante si inietta invece di ripagare la pianificazione', () => {
    const out = enforceContinuity({
      continuityTokens: ['warm ochre'],
      slidePrompts: ['a desk', 'a hand, warm ochre']
    });

    expect(out.slidePrompts[0]).toContain('warm ochre');
    // Quello che gia' ce l'aveva non viene toccato due volte.
    expect(out.slidePrompts[1]).toBe('a hand, warm ochre');
  });

  it('senza gettoni non inventa niente', () => {
    const out = enforceContinuity({ continuityTokens: [], slidePrompts: ['a', 'b'] });

    expect(out.slidePrompts).toEqual(['a', 'b']);
  });

  it('tornano al chiamante: servono a refine_image per non uscire dalla serie', async () => {
    aiStructured.mockResolvedValue({
      continuity_tokens: TOKENS,
      slide_prompts: ['a', 'b', 'c']
    });

    const plan = await planCarousel({} as never, { brandId: 'b', brief: 'x', slides: 3 });

    expect('error' in plan ? [] : plan.continuityTokens).toEqual(TOKENS);
  });
});

describe('il numero di slide', () => {
  it('sta fra il minimo e il massimo', () => {
    expect(clampSlideCount(1)).toBe(CAROUSEL_MIN_SLIDES);
    expect(clampSlideCount(99)).toBe(carouselMaxSlides());
    expect(clampSlideCount('quattro')).toBe(CAROUSEL_MIN_SLIDES);
  });

  it('un piano piu corto del minimo e un fallimento, non un carosello piccolo', async () => {
    aiStructured.mockResolvedValue({ continuity_tokens: TOKENS, slide_prompts: ['solo una'] });

    const plan = await planCarousel({} as never, { brandId: 'b', brief: 'x', slides: 3 });

    expect(plan).toEqual({ error: 'plan_failed' });
  });
});

describe('il prompt di pianificazione', () => {
  it('porta il mestiere ALLA LETTERA, non una parafrasi', () => {
    const p = buildCarouselPlanPrompt({ brief: 'x', slides: 4 });

    expect(p).toContain('verbatim in EVERY slide prompt');
    expect(p).toContain('THUMBNAIL size');
    expect(p).toContain('EXACTLY 4 slide prompts');
  });
});
