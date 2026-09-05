import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * DUE BUGIE DELLO STESSO TIPO, trovate provando i tool da un client MCP vero.
 *
 * 1. `render_failed` nudo. Il motivo — «Localhost URLs are not allowed» — esisteva solo nel log del
 *    server. Chi chiama il tool non sapeva se riprovare, cambiare parametro o rinunciare, ed e'
 *    probabilmente il motivo per cui l'agente si e' arreso. Un errore che dice CHE e' fallito e
 *    nasconde PERCHE' e' la forma peggiore.
 *
 * 2. La durata raddoppiata in silenzio. Chiesti 5 secondi, salvati 10, pagati 10 — i video si
 *    fatturano al secondo. `clampVideoDuration` alza il pavimento a MIN_DURATION ignorando il
 *    minimo che il modello dichiara. Non si riporta di nascosto: o si rifiuta dicendo la finestra,
 *    o si dichiara cosa e' stato mandato.
 */

const submitAndTrackVideoRender = vi.fn();
const countOutstandingVideoRenders = vi.fn();

vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: () => admin }));
vi.mock('$lib/server/video-render-queue', () => ({
  submitAndTrackVideoRender: (...a: unknown[]) => submitAndTrackVideoRender(...a),
  countOutstandingVideoRenders: (...a: unknown[]) => countOutstandingVideoRenders(...a)
}));
vi.mock('$lib/server/brand-media', () => ({ resolveBrandImageIds: async () => ['https://x/y.png'] }));
vi.mock('$lib/server/usage', () => ({ remaining: async () => ({ videos: 5 }) }));
vi.mock('$lib/server/ai-log', () => ({ withBrandContext: <T>(_b: string, fn: () => T) => fn() }));

const admin = {
  from: (table: string) => ({
    select: () => ({
      eq: () =>
        table === 'brand_media'
          ? { limit: async () => ({ data: [], error: null }) }
          : {
              maybeSingle: async () => ({
                data:
                  table === 'brands'
                    ? { plan: 'pro', timezone: 'Europe/Rome', content_prefs: {} }
                    : { id: 'job-1' },
                error: null
              })
            }
    })
  })
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  countOutstandingVideoRenders.mockResolvedValue(0);
  submitAndTrackVideoRender.mockResolvedValue({ taskId: 't', model: 'grok-imagine-video-1-5-preview' });
});

const run = async (over: Record<string, unknown> = {}) => {
  const { generateBrandVideo } = await import('./media-generate');
  return generateBrandVideo({
    brandId: 'brand-1',
    userId: 'user-1',
    prompt: 'un carrello lento',
    ...over
  } as never);
};

describe('il fornitore rifiuta: il motivo deve arrivare a chi ha chiamato', () => {
  it('porta su la causa invece di un render_failed nudo', async () => {
    // Il fornitore rifiuta l'invio e spiega perche'.
    submitAndTrackVideoRender.mockImplementation(async (opts: { onSubmitError?: (r: string) => void }) => {
      opts.onSubmitError?.('Invalid reference URL: Localhost URLs are not allowed');
      return null;
    });

    const out = await run();

    expect(out.ok).toBe(false);
    expect('error' in out && out.error).toBe('render_failed');
    // La riga che decide se l'agente sa cosa fare.
    expect('reason' in out && out.reason).toContain('Localhost URLs are not allowed');
  });

  it('senza motivo dal fornitore non inventa niente', async () => {
    submitAndTrackVideoRender.mockResolvedValue(null);

    const out = await run();

    expect('error' in out && out.error).toBe('render_failed');
    // La chiave non c'e' proprio: meglio assente che una stringa di comodo che nessuno ha detto.
    expect('reason' in out).toBe(false);
  });
});

describe('la durata non si riporta di nascosto', () => {
  it('sotto il minimo del modello si rifiuta, dicendo la finestra', async () => {
    // Seedance 2.5 parte da 4 secondi: uno non e' ottenibile su QUEL modello.
    //
    // L'esempio era 5 secondi su Grok, che il pavimento di prodotto a 10 rendeva irraggiungibile.
    // Quel pavimento e' stato tolto — il minimo ora viene dal modello, e Grok dichiara 1, quindi 5
    // si ottiene eccome. Il rifiuto resta giusto, cambia solo quando scatta: sui numeri che il
    // modello davvero non fa, non su una preferenza nostra.
    const out = await run({ durationSeconds: 1, model: 'bytedance/seedance-2-5' });

    expect(out.ok).toBe(false);
    expect('error' in out && out.error).toBe('duration_out_of_range');
    // Senza i numeri il rifiuto e' un vicolo cieco: l'agente non sa cosa richiedere.
    expect('reason' in out && String(out.reason)).toMatch(/4/);
    expect(submitAndTrackVideoRender).not.toHaveBeenCalled();
  });

  it('cinque secondi ora si ottengono: e il conto che Andrea aveva pagato doppio', async () => {
    const out = await run({ durationSeconds: 5, model: 'grok-imagine-video-1-5-preview' });

    expect(out.ok).toBe(true);
    expect(submitAndTrackVideoRender.mock.calls[0][0].render.duration).toBe(5);
  });

  it('una durata ottenibile passa e viene dichiarata nella risposta', async () => {
    const out = await run({ durationSeconds: 12, model: 'grok-imagine-video-1-5-preview' });

    expect(out.ok).toBe(true);
    expect(out.ok && out.durationSeconds).toBe(12);
    expect(submitAndTrackVideoRender.mock.calls[0][0].render.duration).toBe(12);
  });

  it('senza durata chiesta non si rifiuta niente', async () => {
    const out = await run();

    expect(out.ok).toBe(true);
    expect(submitAndTrackVideoRender).toHaveBeenCalled();
  });
});
