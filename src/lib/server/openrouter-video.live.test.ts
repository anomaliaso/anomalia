/**
 * I test che parlano con OpenRouter DAVVERO, e che non spendono niente: il catalogo è una GET, e
 * un invio con un id inesistente è rifiutato alla validazione, prima di qualunque render.
 *
 *   OPENROUTER_LIVE=1 npx vitest run src/lib/server/openrouter-video.live.test.ts
 *
 * Perché esistono: la mappa `openrouterId` è scritta a mano, una riga per modello, e un trattino
 * al posto di un punto è un 400 al 100% in produzione che nessun test su payload finti può vedere.
 * Il catalogo video vive su una superficie SEPARATA — cercarli in `GET /models` dà zero risultati
 * e fa concludere che non esistano.
 *
 * NESSUN VIDEO VIENE GENERATO QUI. Un job vero costa fra $0,40 e $4 e non serve a sapere se parte.
 */
import { describe, expect, it } from 'vitest';
import { VIDEO_MODEL_CHOICES, videoModelSpec } from '$lib/video-models';

const LIVE = process.env.OPENROUTER_LIVE === '1' && !!process.env.OPENROUTER_API_KEY;
const BASE = 'https://openrouter.ai/api/v1';
const auth = () => ({ authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` });

describe.skipIf(!LIVE)('OpenRouter video, dal vivo', () => {
  it('ogni openrouterId che mappiamo esiste davvero nel catalogo video', async () => {
    const res = await fetch(`${BASE}/videos/models`, { headers: auth() });
    expect(res.ok).toBe(true);
    const catalogue = new Set(((await res.json())?.data ?? []).map((m: { id: string }) => m.id));

    for (const choice of VIDEO_MODEL_CHOICES) {
      const id = videoModelSpec(choice.id)?.openrouterId;
      if (!id) continue;
      expect(catalogue.has(id), `${choice.id} → ${id}`).toBe(true);
    }
  }, 30_000);

  it('il prezzo si legge senza spendere: sta in pricing_skus, non in pricing', async () => {
    const res = await fetch(`${BASE}/videos/models`, { headers: auth() });
    const models = ((await res.json())?.data ?? []) as { id: string; pricing: unknown; pricing_skus: unknown }[];

    const seedance = models.find((m) => m.id === 'bytedance/seedance-2.5');
    expect(seedance?.pricing, 'pricing è nullo su tutti e 28: guardare lì fa concludere il falso').toBeFalsy();
    expect(seedance?.pricing_skus).toBeTruthy();
  }, 30_000);

  it('un invio con un id inesistente è rifiutato alla validazione, e non costa niente', async () => {
    const res = await fetch(`${BASE}/videos`, {
      method: 'POST',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'bytedance/seedance-2-5', prompt: 'x' })
    });
    expect(res.status).toBe(400);
    expect(String((await res.json())?.error?.message)).toMatch(/does not exist/i);
  }, 30_000);
});
