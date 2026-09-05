/**
 * Un carosello verso la LIBRERIA: N immagini che si leggono come UN oggetto, non come N immagini
 * scollegate.
 *
 * Cio' che le tiene insieme sono i GETTONI DI CONTINUITA' — le stesse 2-3 parole (palette, motivo
 * ricorrente, frase di luce) ripetute ALLA LETTERA in ogni prompt di slide. Il mestiere viene da
 * `CAROUSEL_CRAFT`, che e' la stessa stringa che usa il percorso dei post: qui non si riscrive e
 * non si riassume, perche' una parafrasi perde le parti che lo fanno funzionare e nessun test se ne
 * accorge — le immagini tornano comunque, solo slegate.
 *
 * I gettoni tornano al chiamante insieme agli id: per cambiare UNA slide si usa `refine_image` sul
 * suo id rimettendoli nell'istruzione, e la serie regge. Senza, l'istruzione che tocca palette o
 * luce fa uscire quella slide dalla serie e niente avvisa.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { CAROUSEL_CRAFT } from '$lib/server/carousel-craft';
import { CAROUSEL_MIN_SLIDES, carouselMaxSlides } from '$lib/server/content-preview/seed-model';

export type CarouselPlan = {
  continuityTokens: string[];
  slidePrompts: string[];
};

const PLAN_SCHEMA = {
  type: 'object' as const,
  properties: {
    continuity_tokens: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description:
        'The 2-3 literal tokens repeated verbatim in every slide prompt: palette words, a recurring motif, a lighting phrase.'
    },
    slide_prompts: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'One standalone render prompt per slide, slide 1 first.'
    }
  },
  required: ['continuity_tokens', 'slide_prompts']
};

export function clampSlideCount(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return CAROUSEL_MIN_SLIDES;
  return Math.min(carouselMaxSlides(), Math.max(CAROUSEL_MIN_SLIDES, v));
}

/**
 * I gettoni compaiono ALLA LETTERA in ogni prompt, o non e' una serie. Il modello a volte ne
 * dimentica uno in una slide: invece di rifiutare il piano e ripagare la pianificazione, il gettone
 * mancante si aggiunge in coda al prompt. E' la stessa scelta di `craftFloor` — un ingrediente si
 * inietta, non si spera.
 */
export function enforceContinuity(plan: CarouselPlan): CarouselPlan {
  const tokens = plan.continuityTokens.map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return plan;

  return {
    continuityTokens: tokens,
    slidePrompts: plan.slidePrompts.map((prompt) => {
      const missing = tokens.filter((t) => !prompt.toLowerCase().includes(t.toLowerCase()));
      return missing.length ? `${prompt} ${missing.join(', ')}.` : prompt;
    })
  };
}

export function buildCarouselPlanPrompt(opts: { brief: string; slides: number }): string {
  return [
    `Plan a ${opts.slides}-slide carousel for this brief: ${opts.brief}`,
    '',
    CAROUSEL_CRAFT,
    '',
    `Return EXACTLY ${opts.slides} slide prompts. Slide 1 is the cover.`
  ].join('\n');
}

export async function planCarousel(
  supabase: SupabaseClient,
  opts: { brandId: string; brief: string; slides: number }
): Promise<CarouselPlan | { error: 'plan_failed' }> {
  const { aiStructured } = await import('$lib/server/ai-text');
  void supabase;

  const parsed = await aiStructured<{ continuity_tokens?: unknown; slide_prompts?: unknown }>(
    buildCarouselPlanPrompt({ brief: opts.brief, slides: opts.slides }),
    PLAN_SCHEMA,
    'You plan carousels that read as one object. Obey the craft rules exactly.',
    'plan_carousel'
  ).catch(() => null);

  const prompts = Array.isArray(parsed?.slide_prompts)
    ? parsed.slide_prompts.map(String).filter(Boolean)
    : [];
  if (prompts.length < CAROUSEL_MIN_SLIDES) return { error: 'plan_failed' };

  const tokens = Array.isArray(parsed?.continuity_tokens)
    ? parsed.continuity_tokens.map(String).filter(Boolean)
    : [];

  return enforceContinuity({
    continuityTokens: tokens,
    slidePrompts: prompts.slice(0, opts.slides)
  });
}
