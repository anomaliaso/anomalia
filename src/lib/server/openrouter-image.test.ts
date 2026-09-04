import { describe, it, expect, vi, beforeEach } from 'vitest';

// Il render su OpenRouter è SINCRONO: niente createTask, niente polling, quindi niente task
// abbandonato-e-fatturato. Le due cose che devono reggere sono l'estrazione dell'immagine — una
// risposta senza parte immagine NON è un successo — e il rapporto d'aspetto, che senza il campo
// giusto torna panoramico: misurato 1408x768 invece di 4:5.

const M = vi.hoisted(() => ({ env: {} as Record<string, string | undefined>, logged: [] as unknown[] }));
vi.mock('$env/dynamic/private', () => ({ env: M.env }));
vi.mock('$lib/server/ai-log', () => ({
  logAiCall: (e: unknown) => void M.logged.push(e),
  getBrandContext: () => null
}));

const REQ = {
  model: 'gemini-3.1-flash-lite-image',
  contents: [{ parts: [{ text: 'una tazza di ceramica su pietra bagnata' }] }],
  config: { imageConfig: { aspectRatio: '4:5' } }
};

const PIXEL = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

function reply(body: unknown, status = 200) {
  return vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }));
}

function sentBody(f: ReturnType<typeof reply>) {
  return JSON.parse(String(f.mock.calls[0][1].body));
}

function withImage() {
  return {
    choices: [{ message: { role: 'assistant', images: [{ type: 'image_url', image_url: { url: PIXEL } }] } }],
    usage: { cost: 0.0336, prompt_tokens: 33, completion_tokens: 1120 }
  };
}

describe('il render su OpenRouter', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(M.env)) delete M.env[k];
    M.env.OPENROUTER_API_KEY = 'o';
    M.logged.length = 0;
  });

  it('tira fuori l’immagine da choices[0].message.images', async () => {
    vi.stubGlobal('fetch', reply(withImage()));
    const { generateImageOnOpenrouter } = await import('./openrouter-image');
    expect(await generateImageOnOpenrouter(REQ)).toBe(PIXEL);
  });

  it('una risposta senza parte immagine non è un successo silenzioso', async () => {
    vi.stubGlobal('fetch', reply({ choices: [{ message: { role: 'assistant', content: 'non disegno' } }] }));
    const { generateImageOnOpenrouter } = await import('./openrouter-image');
    await expect(generateImageOnOpenrouter(REQ)).rejects.toThrow(/nessuna immagine/i);
  });

  it('manda il rapporto d’aspetto: senza, l’immagine torna panoramica', async () => {
    const f = reply(withImage());
    vi.stubGlobal('fetch', f);
    const { generateImageOnOpenrouter } = await import('./openrouter-image');
    await generateImageOnOpenrouter(REQ);
    const body = sentBody(f);
    expect(body.image_config).toEqual({ aspect_ratio: '4:5' });
    expect(body.modalities).toEqual(['image', 'text']);
  });

  it('il modello va col fornitore davanti: è così che OpenRouter lo chiama', async () => {
    const f = reply(withImage());
    vi.stubGlobal('fetch', f);
    const { generateImageOnOpenrouter } = await import('./openrouter-image');
    await generateImageOnOpenrouter(REQ);
    const body = sentBody(f);
    expect(body.model).toBe('google/gemini-3.1-flash-lite-image');
  });

  it('i riferimenti inline diventano image_url, senza passare da un upload', async () => {
    const f = reply(withImage());
    vi.stubGlobal('fetch', f);
    const { generateImageOnOpenrouter } = await import('./openrouter-image');
    await generateImageOnOpenrouter({
      ...REQ,
      contents: [
        { parts: [{ text: 'il prodotto vero' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] }
      ]
    });
    const body = sentBody(f);
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'il prodotto vero' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }
    ]);
  });

  it('il costo viene da usage.cost, non da un listino scritto a mano', async () => {
    vi.stubGlobal('fetch', reply(withImage()));
    const { generateImageOnOpenrouter } = await import('./openrouter-image');
    await generateImageOnOpenrouter(REQ);
    expect(M.logged[0]).toMatchObject({ provider: 'openrouter', ok: true, flatCostUsd: 0.0336 });
  });

  it('una chiamata fallita lascia la riga, senza costo', async () => {
    vi.stubGlobal('fetch', reply({ error: { message: 'rate limited' } }, 429));
    const { generateImageOnOpenrouter } = await import('./openrouter-image');
    await expect(generateImageOnOpenrouter(REQ)).rejects.toThrow();
    expect(M.logged[0]).toMatchObject({ provider: 'openrouter', ok: false });
    expect((M.logged[0] as { flatCostUsd?: number }).flatCostUsd).toBeUndefined();
  });
});
