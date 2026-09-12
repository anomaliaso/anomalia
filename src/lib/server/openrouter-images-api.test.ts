import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `POST /api/v1/images` è un endpoint diverso da `chat/completions`, non una variante: corpo
 * diverso (`prompt`, `input_references`, `aspect_ratio`), risposta diversa (`b64_json` +
 * `media_type`), ed è l'unico posto dove i GPT Image 2.5 esistono.
 *
 * Le tre cose che devono reggere, tutte misurate contro l'endpoint vero il 2026-09-12:
 *  · i riferimenti hanno UNA forma sola — `{type:'image_url', image_url:{url}}`. Le altre quattro
 *    provate tornano 400, tranne `image:` che torna 200 E IGNORA l'immagine: un limone verde
 *    inventato da zero invece dello stesso limone colorato. Il silenzio è il guasto peggiore.
 *  · 4:5 non è fra i rapporti che accettano per nome: va chiesto in pixel, o è un 400.
 *  · una risposta senza immagine non è un successo.
 */
const M = vi.hoisted(() => ({ env: {} as Record<string, string | undefined>, logged: [] as any[] }));
vi.mock('$env/dynamic/private', () => ({ env: M.env }));
vi.mock('$lib/server/ai-log', () => ({
  logAiCall: (e: unknown) => void M.logged.push(e),
  getBrandContext: () => null
}));

const REQ = {
  model: 'gpt-image-2.5-sunburst',
  contents: [{ parts: [{ text: 'una tazza di ceramica su pietra bagnata' }] }],
  config: { imageConfig: { aspectRatio: '4:5' } }
};

const B64 = '/9j/4AAQSkZJRg==';

function reply(body: unknown, status = 200) {
  return vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }));
}
const sentBody = (f: any) => JSON.parse(String(f.mock.calls[0][1].body));
const sentUrl = (f: any) => String(f.mock.calls[0][0]);
const ok = () => ({ data: [{ b64_json: B64, media_type: 'image/png' }], usage: { cost: 0.00527 } });

describe('il render sull’API immagini di OpenRouter', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(M.env)) delete M.env[k];
    M.env.OPENROUTER_API_KEY = 'o';
    M.logged.length = 0;
  });

  it('parla con /images e non con chat/completions', async () => {
    const f = reply(ok());
    vi.stubGlobal('fetch', f);
    const { generateImageOnOpenrouterImages } = await import('./openrouter-images-api');
    await generateImageOnOpenrouterImages(REQ);
    expect(sentUrl(f)).toMatch(/\/images$/);
  });

  it('restituisce un data URL col tipo che il provider dichiara', async () => {
    vi.stubGlobal('fetch', reply(ok()));
    const { generateImageOnOpenrouterImages } = await import('./openrouter-images-api');
    expect(await generateImageOnOpenrouterImages(REQ)).toBe(`data:image/png;base64,${B64}`);
  });

  it('manda l’id con cui OpenRouter chiama quel modello, non il nostro', async () => {
    const f = reply(ok());
    vi.stubGlobal('fetch', f);
    const { generateImageOnOpenrouterImages } = await import('./openrouter-images-api');
    await generateImageOnOpenrouterImages(REQ);
    expect(sentBody(f).model).toBe('openai/gpt-image-2.5-sunburst');
  });

  it('4:5 si chiede in pixel, perché per nome non esiste', async () => {
    const f = reply(ok());
    vi.stubGlobal('fetch', f);
    const { generateImageOnOpenrouterImages } = await import('./openrouter-images-api');
    await generateImageOnOpenrouterImages(REQ);
    const body = sentBody(f);
    expect(body.size).toBe('1024x1280');
    expect(body.aspect_ratio).toBeUndefined();
  });

  it('un rapporto che hanno per nome si chiede per nome', async () => {
    const f = reply(ok());
    vi.stubGlobal('fetch', f);
    const { generateImageOnOpenrouterImages } = await import('./openrouter-images-api');
    await generateImageOnOpenrouterImages({
      ...REQ,
      config: { imageConfig: { aspectRatio: '9:16' } }
    });
    const body = sentBody(f);
    expect(body.aspect_ratio).toBe('9:16');
    expect(body.size).toBeUndefined();
  });

  it('i riferimenti viaggiano nella forma che l’endpoint accetta davvero', async () => {
    const f = reply(ok());
    vi.stubGlobal('fetch', f);
    const { generateImageOnOpenrouterImages } = await import('./openrouter-images-api');
    await generateImageOnOpenrouterImages({
      ...REQ,
      contents: [
        {
          parts: [
            { text: 'rendi il limone verde' },
            { inlineData: { mimeType: 'image/png', data: 'AAA' } }
          ]
        }
      ]
    });
    const body = sentBody(f);
    expect(body.prompt).toBe('rendi il limone verde');
    expect(body.input_references).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }
    ]);
  });

  it('una risposta senza immagine non è un successo silenzioso', async () => {
    vi.stubGlobal('fetch', reply({ data: [] }));
    const { generateImageOnOpenrouterImages } = await import('./openrouter-images-api');
    await expect(generateImageOnOpenrouterImages(REQ)).rejects.toThrow(/nessuna immagine/i);
  });

  it('il costo è quello che fattura la chiamata, e finisce nel registro', async () => {
    vi.stubGlobal('fetch', reply(ok()));
    const { generateImageOnOpenrouterImages } = await import('./openrouter-images-api');
    await generateImageOnOpenrouterImages(REQ);
    expect(M.logged.at(-1)).toMatchObject({
      provider: 'openrouter',
      model: 'openai/gpt-image-2.5-sunburst',
      ok: true,
      flatCostUsd: 0.00527
    });
  });

  it('un errore del provider è un errore, e lo dice anche al registro', async () => {
    vi.stubGlobal('fetch', reply({ error: { message: 'Provider rejection' } }, 400));
    const { generateImageOnOpenrouterImages } = await import('./openrouter-images-api');
    await expect(generateImageOnOpenrouterImages(REQ)).rejects.toThrow(/Provider rejection/);
    expect(M.logged.at(-1)).toMatchObject({ ok: false });
  });

  it('senza chiave non ci prova nemmeno', async () => {
    delete M.env.OPENROUTER_API_KEY;
    vi.stubGlobal('fetch', reply(ok()));
    const { generateImageOnOpenrouterImages } = await import('./openrouter-images-api');
    await expect(generateImageOnOpenrouterImages(REQ)).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});
