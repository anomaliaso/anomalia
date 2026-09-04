import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));

const state = vi.hoisted(() => ({
  kit: {} as Record<string, unknown>,
  written: [] as Record<string, unknown>[],
  fetched: [] as string[],
  fetchResult: { url: 'https://cdn.anomalia.test/stored/logo.png' } as { url: string } | { error: string },
  availableFonts: new Set(['Inter', 'Playfair Display']),
  updateFails: null as string | null
}));

vi.mock('$lib/server/studio-actions', () => ({
  storeBrandLogoFromUrl: async (_c: unknown, opts: { imageUrl: string }) => {
    state.fetched.push(opts.imageUrl);
    return state.fetchResult;
  }
}));

vi.mock('$lib/server/design-typography', () => ({
  fontIsAvailable: async (name: string) => state.availableFonts.has(name)
}));

const client = {
  from: () => {
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: state.kit }),
      update: (row: Record<string, unknown>) => {
        state.written.push(row);
        return {
          eq: async () => ({ error: state.updateFails ? { message: state.updateFails } : null })
        };
      },
      upsert: async (row: Record<string, unknown>) => {
        state.written.push(row);
        return { error: state.updateFails ? { message: state.updateFails } : null };
      }
    });
    return q;
  },
  auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) }
};

import { GET, PUT } from './+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

const BRAND = { id: 'brand-1', slug: 'demo', plan: 'pro' };
const base = 'https://example.test/api/v1/brands/demo/studio/appearance';

const call = (h: unknown, method: string, body?: unknown) =>
  (h as (e: unknown) => Promise<Response>)({
    request: new Request(base, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }),
    params: { slug: 'demo' }
  });

beforeEach(() => {
  state.kit = {
    logos: [{ url: 'https://cdn.anomalia.test/old.png', type: 'uploaded' }],
    favicon_url: null,
    brand_colors: ['#111111'],
    graphic_style: { display_font: 'Inter', body_font: 'Inter', instructions: '' },
    visual_style: null,
    visual_style_locked: false
  };
  state.written = [];
  state.fetched = [];
  state.fetchResult = { url: 'https://cdn.anomalia.test/stored/logo.png' };
  state.availableFonts = new Set(['Inter', 'Playfair Display']);
  state.updateFails = null;
  vi.mocked(authenticate).mockResolvedValue({ supabase: client, apiKey: undefined } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: BRAND } as never);
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(undefined as never);
});

describe('GET /studio/appearance', () => {
  it('riporta il logo come una URL sola, non come l’array grezzo del database', async () => {
    const body = await (await call(GET, 'GET')).json();
    expect(body.appearance.logo_url).toBe('https://cdn.anomalia.test/old.png');
    expect(body.appearance).not.toHaveProperty('logos');
  });

  it('un logo che e’ solo un’og-image non conta come logo', async () => {
    state.kit.logos = [{ url: 'https://x.test/og.png', type: 'og-image' }];
    const body = await (await call(GET, 'GET')).json();
    expect(body.appearance.logo_url).toBeNull();
  });
});

describe('PUT /studio/appearance', () => {
  it('una richiesta senza campi e’ 400 dichiarato, non un salvataggio a vuoto', async () => {
    const res = await call(PUT, 'PUT', {});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('no_fields');
    expect(state.written).toHaveLength(0);
  });

  /**
   * Il campo si chiama `logo_url`, ma quello che finisce nel database e' l'indirizzo NOSTRO. Se
   * salvassimo quello di chi chiama, ogni grafica del brand mostrerebbe un'immagine che un altro
   * puo' cambiare o togliere dopo averla fatta approvare.
   */
  it('salva l’indirizzo che abbiamo scaricato, non quello che ci hanno dato', async () => {
    const res = await call(PUT, 'PUT', { logo_url: 'https://cdn.example.com/theirs.png' });
    expect(res.status).toBe(200);
    expect(state.fetched).toEqual(['https://cdn.example.com/theirs.png']);
    const logos = state.written[0].logos as { url: string }[];
    expect(logos[0].url).toBe('https://cdn.anomalia.test/stored/logo.png');
  });

  it('un indirizzo che la guardia rifiuta non lascia niente scritto', async () => {
    state.fetchResult = { error: 'That image URL is not fetchable (blocked or not http/https).' };
    const res = await call(PUT, 'PUT', { logo_url: 'http://169.254.169.254/latest/meta-data/' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('image_rejected');
    expect(state.written).toHaveLength(0);
  });

  it('mettere e togliere il logo insieme e’ un rifiuto, non un ordine indovinato', async () => {
    const res = await call(PUT, 'PUT', { logo_url: 'https://cdn.example.com/x.png', remove_logo: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('logo_conflict');
    expect(state.fetched).toHaveLength(0);
  });

  it('un font che Google Fonts non serve e’ rifiutato prima di scrivere, e dice quale', async () => {
    const res = await call(PUT, 'PUT', { display_font: 'Comic Papyrus', body_font: 'Inter' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('font_not_available');
    expect(body.missing).toEqual(['Comic Papyrus']);
    expect(state.written).toHaveLength(0);
  });

  it('un font solo non e’ una coppia: rifiuta invece di accoppiarlo con quello vecchio', async () => {
    const res = await call(PUT, 'PUT', { display_font: 'Playfair Display' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('font_pair_incomplete');
    expect(state.written).toHaveLength(0);
  });

  it('scrivere il brief visivo lo blocca, o la ricostruzione notturna lo riscrive', async () => {
    const res = await call(PUT, 'PUT', { visual_style: 'Fotografia naturale, luce morbida, niente testo.' });
    expect(res.status).toBe(200);
    expect(state.written[0].visual_style_locked).toBe(true);
  });

  it('una chiave di sola lettura non scrive', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(
      new Response(JSON.stringify({ error: 'API key is read-only' }), { status: 403 }) as never
    );
    const res = await call(PUT, 'PUT', { visual_style: 'x'.repeat(30) });
    expect(res.status).toBe(403);
    expect(state.written).toHaveLength(0);
    expect(state.fetched).toHaveLength(0);
  });
});
