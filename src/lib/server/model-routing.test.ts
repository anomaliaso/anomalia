import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Il registro sostituisce cinque interruttori nati separatamente. Le due cose che devono reggere
// sono: le vecchie variabili continuano a funzionare (sono già scritte in produzione), e una rotta
// verso un provider che non sa fare il lavoro si ferma con un errore invece di degradare.

const M = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: M.env }));

function setEnv(vars: Record<string, string | undefined>) {
  for (const k of Object.keys(M.env)) delete M.env[k];
  Object.assign(M.env, vars);
}

const KEYS = { KIE_API_KEY: 'k', OPENROUTER_API_KEY: 'o' };

describe('il registro delle rotte', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv(KEYS);
  });

  it('i default: testo, immagini e voce su openrouter', async () => {
    const { route } = await import('./model-routing');
    expect(route('text')).toMatchObject({ family: 'gemini', endpoint: 'openrouter', provider: 'openrouter' });
    expect(route('image')).toMatchObject({ endpoint: 'openrouter', provider: 'openrouter' });
    expect(route('tts')).toMatchObject({ family: 'gemini-tts', endpoint: 'openrouter', provider: 'openrouter' });
  });

  it('dice i due assi separatamente: famiglia @ endpoint', async () => {
    setEnv({ ...KEYS, AI_ROUTE_TEXT: 'gemini@kie' });
    const { route } = await import('./model-routing');
    // Stessa famiglia (la garanzia di qualità), altro conto da pagare.
    expect(route('text')).toMatchObject({ family: 'gemini', endpoint: 'kie', provider: 'kie' });
  });

  it('senza @ prende l’endpoint di casa della famiglia', async () => {
    setEnv({ ...KEYS, AI_ROUTE_TEXT: 'grok' });
    const { route } = await import('./model-routing');
    expect(route('text')).toMatchObject({ family: 'grok', endpoint: 'kie', provider: 'kie' });
  });

  it('le vecchie variabili che nominano un endpoint VIVO continuano a comandare', async () => {
    for (const [env, expected] of [
      [{ GTM_PROVIDER: 'kie' }, { slot: 'text', family: 'grok', endpoint: 'kie' }],
      [{ GEMINI_TRANSPORT: 'kie' }, { slot: 'text', family: 'gemini', endpoint: 'kie' }]
    ] as const) {
      vi.resetModules();
      setEnv({ ...KEYS, ...env });
      const { route } = await import('./model-routing');
      const { slot, ...want } = expected;
      expect(route(slot), JSON.stringify(env)).toMatchObject(want);
    }
  });

  it('la nuova variabile batte la vecchia', async () => {
    setEnv({ ...KEYS, GTM_PROVIDER: 'kie', AI_ROUTE_TEXT: 'gemini@openrouter' });
    const { route } = await import('./model-routing');
    expect(route('text')).toMatchObject({ family: 'gemini', endpoint: 'openrouter' });
  });

  it('un endpoint senza chiave non è una rotta: si ripiega, rumorosamente', async () => {
    setEnv({ KIE_API_KEY: 'k', AI_ROUTE_IMAGE: 'nano-banana@openrouter' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { route } = await import('./model-routing');
    expect(route('image')).toMatchObject({ endpoint: 'kie', provider: 'kie' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('un valore che non si capisce non spegne niente: si torna al default', async () => {
    setEnv({ ...KEYS, AI_ROUTE_TEXT: 'llama@ollama' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { route } = await import('./model-routing');
    expect(route('text')).toMatchObject({ family: 'gemini', endpoint: 'openrouter' });
  });

  it('una capacità mancante si ferma qui, con dentro la variabile da cambiare', async () => {
    setEnv({ ...KEYS, AI_ROUTE_TEXT: 'gemini@kie' });
    const { requireCapabilities, can } = await import('./model-routing');
    expect(can('kie', 'grounding')).toBe(false);
    expect(can('openrouter', 'grounding')).toBe(true);
    // Le citazioni vuote non fanno rumore da nessuna parte: meglio l'eccezione.
    expect(() => requireCapabilities('text', ['grounding'])).toThrow(/AI_ROUTE_TEXT.*grounding/s);
    // Quello che kie sa fare passa senza storie.
    expect(requireCapabilities('text', ['structured', 'tools', 'image-in']).endpoint).toBe('kie');
  });

  it('i fatti misurati su kie sono nel registro, non da riscoprire', async () => {
    const { missingCapabilities } = await import('./model-routing');
    expect(missingCapabilities('kie')).toEqual(
      expect.arrayContaining(['grounding', 'media-in-tool-result', 'video-fps', 'prompt-cache', 'embeddings', 'music'])
    );
    // Nessuna: l'ultima assenza era il TTS, ed era falsa. `/audio/speech` con
    // `google/gemini-3.1-flash-tts-preview` torna `audio/pcm;rate=24000;channels=1`.
    expect(missingCapabilities('openrouter')).toEqual([]);
  });

  it('openrouter è una rotta, e AI_ROUTE_IMAGE la seleziona', async () => {
    setEnv({ ...KEYS, AI_ROUTE_IMAGE: 'nano-banana@openrouter' });
    const { route } = await import('./model-routing');
    expect(route('image')).toMatchObject({
      family: 'nano-banana',
      endpoint: 'openrouter',
      provider: 'openrouter'
    });
  });

  it('la chiave del gateway del testo vale anche per openrouter', async () => {
    setEnv({ ...KEYS, LLM_API_KEY: 'o', AI_ROUTE_IMAGE: 'nano-banana@openrouter' });
    const { route } = await import('./model-routing');
    expect(route('image').endpoint).toBe('openrouter');
  });

  it('senza chiave openrouter non è una rotta: si ripiega su kie, rumorosamente', async () => {
    setEnv({ KIE_API_KEY: 'k', AI_ROUTE_IMAGE: 'nano-banana@openrouter' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { route } = await import('./model-routing');
    expect(route('image')).toMatchObject({ endpoint: 'kie', provider: 'kie' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('una coppia senza trasporto non è una rotta: si ripiega, e dice perché', async () => {
    // `geminiTransport()` conosce solo kie e google: il testo verso openrouter atterrerebbe su
    // Google IN SILENZIO, cioè la rotta si legge come rispettata e non lo è. Vale identico per le
    // coppie che erano già cieche prima di openrouter — una regola sola, non un'eccezione.
    for (const raw of ['grok@openrouter', 'gpt@openrouter']) {
      vi.resetModules();
      setEnv({ ...KEYS, AI_ROUTE_TEXT: raw });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { route } = await import('./model-routing');
      route('text');
      expect(warn, raw).toHaveBeenCalledWith(expect.stringMatching(/nessun trasporto/));
      warn.mockRestore();
    }
  });

  it('le coppie che un trasporto serve davvero passano senza rumore', async () => {
    const SLOT_VAR = { text: 'AI_ROUTE_TEXT', image: 'AI_ROUTE_IMAGE', tts: 'AI_ROUTE_TTS' } as const;
    for (const [raw, slot, endpoint] of [
      ['gemini@kie', 'text', 'kie'],
      ['gemini@openrouter', 'text', 'openrouter'],
      ['grok@kie', 'text', 'kie'],
      ['nano-banana@openrouter', 'image', 'openrouter'],
      ['nano-banana@kie', 'image', 'kie'],
      ['gemini-tts@kie', 'tts', 'kie'],
      ['gemini-tts@openrouter', 'tts', 'openrouter']
    ] as const) {
      vi.resetModules();
      setEnv({ ...KEYS, [SLOT_VAR[slot]]: raw });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { route } = await import('./model-routing');
      expect(route(slot).endpoint, raw).toBe(endpoint);
      expect(warn, raw).not.toHaveBeenCalled();
      warn.mockRestore();
    }
  });

  it('le immagini vanno su openrouter per default, senza nessuna variabile', async () => {
    // Non e` il prezzo: kie ha il 3,5% di fallimenti e un p95 di 142,9s contro i 3,4s di
    // OpenRouter. Il default e` la disponibilita`, non il risparmio.
    const { route } = await import('./model-routing');
    expect(route('image')).toMatchObject({ family: 'nano-banana', endpoint: 'openrouter' });
  });

  it('la voce si sposta col resto, e kie resta il ripiego', async () => {
    const { route } = await import('./model-routing');
    expect(route('tts').endpoint).toBe('openrouter');
    vi.resetModules();
    setEnv({ KIE_API_KEY: 'k' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { route: routeWithoutKey } = await import('./model-routing');
    expect(routeWithoutKey('tts').endpoint).toBe('kie');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/AI_ROUTE_TTS.*Ripiego su kie/));
    warn.mockRestore();
  });

  it('senza chiave openrouter le immagini ripiegano su kie, che resta il ripiego', async () => {
    setEnv({ KIE_API_KEY: 'k' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { route } = await import('./model-routing');
    expect(route('image').endpoint).toBe('kie');
    warn.mockRestore();
  });

  it('IMAGE_PROVIDER=gemini è ritirata: ignorata rumorosamente, non più vincente', async () => {
    setEnv({ ...KEYS, IMAGE_PROVIDER: 'gemini' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { route } = await import('./model-routing');
    expect(route('image').endpoint).toBe('openrouter');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/IMAGE_PROVIDER=gemini.*rimosso/));
    warn.mockRestore();
  });

  it('il video è uno slot, e si indirizza per famiglia e endpoint come gli altri', async () => {
    setEnv({ ...KEYS, OPENROUTER_API_KEY: 'o', AI_ROUTE_VIDEO: 'seedance@openrouter' });
    const { route } = await import('./model-routing');
    expect(route('video')).toMatchObject({
      family: 'seedance',
      endpoint: 'openrouter',
      provider: 'openrouter'
    });
  });

  it('una coppia video senza trasporto non è una rotta: si ripiega, e dice perché', async () => {
    // Famiglie che esistono e endpoint che esistono, ma nessun trasporto fra i due: e` il caso che
    // NON deve atterrare zitto su kie mentre la variabile dice openrouter.
    //
    // Le coppie vanno riscelte quando `SERVED_BY` cambia, e non e` pedanteria: `gemini@openrouter`
    // stava qui finche` il testo non aveva un trasporto, e adesso ce l'ha. Una coppia che diventa
    // servita rende il test rosso — rumoroso, quindi innocuo; una che diventa NON PARSABILE lo
    // farebbe restare verde misurando il ripiego al default invece dell'invariante. Sono due modi
    // opposti di sbagliare, e solo uno si vede.
    for (const raw of ['grok@openrouter', 'gpt@openrouter']) {
      vi.resetModules();
      setEnv({ ...KEYS, OPENROUTER_API_KEY: 'o', AI_ROUTE_VIDEO: raw });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { route } = await import('./model-routing');
      expect(route('video').endpoint, raw).not.toBe('openrouter');
      expect(warn, raw).toHaveBeenCalledWith(expect.stringMatching(/nessun trasporto/));
      warn.mockRestore();
    }
  });

  it('senza chiave openrouter il video non ci va: si ripiega su kie, rumorosamente', async () => {
    setEnv({ KIE_API_KEY: 'k', GEMINI_API_KEY: 'g', AI_ROUTE_VIDEO: 'seedance@openrouter' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { route } = await import('./model-routing');
    expect(route('video')).toMatchObject({ endpoint: 'kie', provider: 'kie' });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/la chiave manca/));
    warn.mockRestore();
  });

  it('le coppie video che un trasporto serve davvero passano senza rumore', async () => {
    for (const [raw, endpoint] of [
      ['grok-imagine@kie', 'kie'],
      ['seedance@kie', 'kie'],
      ['kling@kie', 'kie'],
      ['grok-imagine@openrouter', 'openrouter'],
      ['seedance@openrouter', 'openrouter'],
      ['kling@openrouter', 'openrouter']
    ] as const) {
      vi.resetModules();
      setEnv({ ...KEYS, OPENROUTER_API_KEY: 'o', AI_ROUTE_VIDEO: raw });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { route } = await import('./model-routing');
      expect(route('video').endpoint, raw).toBe(endpoint);
      expect(warn, raw).not.toHaveBeenCalled();
      warn.mockRestore();
    }
  });

  it('il video resta su kie: questa rotta costruisce la strada, non ci manda il traffico', async () => {
    setEnv({ ...KEYS, OPENROUTER_API_KEY: 'o' });
    const { route } = await import('./model-routing');
    expect(route('video')).toMatchObject({ endpoint: 'kie', provider: 'kie' });
  });

  it('i modelli video: nuova variabile, vecchia variabile, default', async () => {
    setEnv({ ...KEYS, AI_ROUTE_VIDEO_I2V: 'bytedance/seedance-2-5', KIE_VIDEO_MODEL_T2V: 'vecchio/t2v' });
    const { videoModel } = await import('./model-routing');
    expect(videoModel('i2v')).toBe('bytedance/seedance-2-5');
    expect(videoModel('t2v')).toBe('vecchio/t2v');
    expect(videoModel('upscale')).toBe('grok-imagine/upscale');
  });
});

/**
 * Famiglia ed endpoint sono DUE assi, e restano due.
 *
 * Prima qui si leggeva `AI_PROVIDER`, una costante che li ricollassava in uno: valeva `'kie'` o
 * `'gemini'`, e `'gemini'` voleva dire "il gateway" — cioè il valore diceva una famiglia e
 * significava un endpoint. Quattro rami del prodotto confrontavano quella costante con `'xiaomi'`,
 * un valore che il tipo non poteva assumere: sempre falsi, mai visti fallire.
 *
 * Ora si interroga il registro, che i due assi li tiene separati per costruzione.
 */
describe('i due assi non si collassano', () => {
  beforeEach(() => vi.resetModules());

  it('la famiglia si sposta senza portarsi dietro l endpoint', async () => {
    setEnv({ ...KEYS, AI_ROUTE_TEXT: 'grok@kie' });
    const { route } = await import('./model-routing');
    expect(route('text')).toMatchObject({ family: 'grok', endpoint: 'kie' });
  });

  it('l endpoint si sposta senza portarsi dietro la famiglia', async () => {
    setEnv({ ...KEYS, AI_ROUTE_TEXT: 'gemini@kie' });
    const { route } = await import('./model-routing');
    expect(route('text')).toMatchObject({ family: 'gemini', endpoint: 'kie' });

    vi.resetModules();
    setEnv({ ...KEYS, AI_ROUTE_TEXT: 'gemini@openrouter' });
    const { route: route2 } = await import('./model-routing');
    expect(route2('text')).toMatchObject({ family: 'gemini', endpoint: 'openrouter' });
  });

  it('nessuna costante derivata dalla rotta: si legge al momento della chiamata', () => {
    const src = readFileSync(join(HERE, 'ai-text.ts'), 'utf8');
    // Il NOME puo` comparire in un commento che racconta perche` non c'e` piu`; quello che non
    // deve tornare e` la DICHIARAZIONE, e la chiamata a `route()` fuori da una funzione — una foto
    // scattata al caricamento del modulo invecchia e mente.
    expect(src).not.toMatch(/^\s*export const AI_PROVIDER/m);
    expect(src).not.toMatch(/^const \w+ = route\(/m);
  });
});

// Restano due trasporti: openrouter serve, kie ripiega. Le tre uscite — google, xiaomi, deepseek —
// non sono piu` rotte, e la cosa che deve reggere e` che chi le nomina se ne accorga: un valore
// morto accettato in silenzio manda il traffico altrove e la rotta si legge come rispettata.
describe('restano solo openrouter e kie', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv({ OPENROUTER_API_KEY: 'o', KIE_API_KEY: 'k' });
  });

  it('un valore che nomina un endpoint rimosso viene rifiutato RUMOROSAMENTE', async () => {
    for (const raw of ['gemini@google', 'mimo@xiaomi', 'deepseek@deepseek', 'nano-banana@google']) {
      vi.resetModules();
      setEnv({ OPENROUTER_API_KEY: 'o', KIE_API_KEY: 'k', AI_ROUTE_TEXT: raw });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { route } = await import('./model-routing');
      const chosen = route('text');
      expect(warn, raw).toHaveBeenCalled();
      expect(['kie', 'openrouter'], raw).toContain(chosen.endpoint);
      warn.mockRestore();
    }
  });

  it('le vecchie variabili che nominano un endpoint morto non atterrano altrove in silenzio', async () => {
    for (const legacy of [
      { GTM_PROVIDER: 'xiaomi' },
      { GEMINI_TRANSPORT: 'google' },
      { IMAGE_PROVIDER: 'gemini' },
      { TTS_PROVIDER: 'gemini' }
    ]) {
      vi.resetModules();
      setEnv({ OPENROUTER_API_KEY: 'o', KIE_API_KEY: 'k', ...legacy });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { route } = await import('./model-routing');
      for (const slot of ['text', 'image', 'tts'] as const) {
        expect(['kie', 'openrouter'], JSON.stringify(legacy)).toContain(route(slot).endpoint);
      }
      expect(warn, JSON.stringify(legacy)).toHaveBeenCalled();
      warn.mockRestore();
    }
  });

  it('openrouter e` il default dove puo` servire, kie dove no', async () => {
    const { route } = await import('./model-routing');
    expect(route('text').endpoint).toBe('openrouter');
    expect(route('image').endpoint).toBe('openrouter');
    expect(route('tts').endpoint).toBe('openrouter');
  });

  it('il ripiego di ogni slot e` kie, mai altro', async () => {
    setEnv({ KIE_API_KEY: 'k' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { route } = await import('./model-routing');
    for (const slot of ['text', 'image', 'tts'] as const) {
      expect(route(slot).endpoint, slot).toBe('kie');
    }
    warn.mockRestore();
  });

  it('openrouter sa fare il TTS, e ora il registro lo dice', async () => {
    // Era scritto il contrario, e la prova che lo smentisce e` una chiamata sola:
    // `POST /audio/speech` con `google/gemini-3.1-flash-tts-preview` risponde 200 e
    // `content-type: audio/pcm;rate=24000;channels=1` — la forma esatta che il tagliatore vuole.
    const { missingCapabilities, can } = await import('./model-routing');
    expect(can('openrouter', 'tts')).toBe(true);
    expect(can('kie', 'tts')).toBe(true);
    expect(missingCapabilities('openrouter')).not.toContain('tts');
  });
});
