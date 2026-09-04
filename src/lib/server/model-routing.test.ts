import { describe, it, expect, vi, beforeEach } from 'vitest';

// Il registro sostituisce cinque interruttori nati separatamente. Le due cose che devono reggere
// sono: le vecchie variabili continuano a funzionare (sono già scritte in produzione), e una rotta
// verso un provider che non sa fare il lavoro si ferma con un errore invece di degradare.

const M = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: M.env }));

function setEnv(vars: Record<string, string | undefined>) {
  for (const k of Object.keys(M.env)) delete M.env[k];
  Object.assign(M.env, vars);
}

const KEYS = { GEMINI_API_KEY: 'g', KIE_API_KEY: 'k', XIAOMI_MIMO_API_KEY: 'x' };

describe('il registro delle rotte', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv(KEYS);
  });

  it('i default: testo su Google, immagini su openrouter, voce su kie', async () => {
    setEnv({ ...KEYS, OPENROUTER_API_KEY: 'o' });
    const { route } = await import('./model-routing');
    expect(route('text')).toMatchObject({ family: 'gemini', endpoint: 'google', provider: 'gemini' });
    expect(route('image')).toMatchObject({ endpoint: 'openrouter', provider: 'openrouter' });
    expect(route('tts')).toMatchObject({ endpoint: 'kie', provider: 'kie' });
  });

  it('dice i due assi separatamente: famiglia @ endpoint', async () => {
    setEnv({ ...KEYS, AI_ROUTE_TEXT: 'gemini@kie' });
    const { route } = await import('./model-routing');
    // Stessa famiglia (la garanzia di qualità), altro conto da pagare.
    expect(route('text')).toMatchObject({ family: 'gemini', endpoint: 'kie', provider: 'kie' });
  });

  it('senza @ prende l’endpoint di casa della famiglia', async () => {
    setEnv({ ...KEYS, AI_ROUTE_TEXT: 'mimo' });
    const { route } = await import('./model-routing');
    expect(route('text')).toMatchObject({ family: 'mimo', endpoint: 'xiaomi', provider: 'xiaomi' });
  });

  it('le cinque vecchie variabili continuano a comandare', async () => {
    for (const [env, expected] of [
      [{ GTM_PROVIDER: 'xiaomi' }, { slot: 'text', family: 'mimo', endpoint: 'xiaomi' }],
      [{ GTM_PROVIDER: 'kie' }, { slot: 'text', family: 'grok', endpoint: 'kie' }],
      [{ GEMINI_TRANSPORT: 'kie' }, { slot: 'text', family: 'gemini', endpoint: 'kie' }],
      [{ IMAGE_PROVIDER: 'gemini' }, { slot: 'image', family: 'nano-banana', endpoint: 'google' }],
      [{ TTS_PROVIDER: 'gemini' }, { slot: 'tts', family: 'gemini-tts', endpoint: 'google' }]
    ] as const) {
      vi.resetModules();
      setEnv({ ...KEYS, ...env });
      const { route } = await import('./model-routing');
      const { slot, ...want } = expected;
      expect(route(slot), JSON.stringify(env)).toMatchObject(want);
    }
  });

  it('la nuova variabile batte la vecchia', async () => {
    setEnv({ ...KEYS, GTM_PROVIDER: 'xiaomi', AI_ROUTE_TEXT: 'gemini' });
    const { route } = await import('./model-routing');
    expect(route('text')).toMatchObject({ family: 'gemini', endpoint: 'google' });
  });

  it('un endpoint senza chiave non è una rotta: si ripiega, rumorosamente', async () => {
    setEnv({ GEMINI_API_KEY: 'g', AI_ROUTE_IMAGE: 'nano-banana@kie' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { route } = await import('./model-routing');
    expect(route('image')).toMatchObject({ endpoint: 'google', provider: 'gemini' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('un valore che non si capisce non spegne niente: si torna al default', async () => {
    setEnv({ ...KEYS, AI_ROUTE_TEXT: 'llama@ollama' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { route } = await import('./model-routing');
    expect(route('text')).toMatchObject({ family: 'gemini', endpoint: 'google' });
  });

  it('una capacità mancante si ferma qui, con dentro la variabile da cambiare', async () => {
    setEnv({ ...KEYS, AI_ROUTE_TEXT: 'gemini@kie' });
    const { requireCapabilities, can } = await import('./model-routing');
    expect(can('kie', 'grounding')).toBe(false);
    expect(can('google', 'grounding')).toBe(true);
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
    expect(missingCapabilities('google')).toEqual([]);
  });

  it('openrouter è una rotta, e AI_ROUTE_IMAGE la seleziona', async () => {
    setEnv({ ...KEYS, OPENROUTER_API_KEY: 'o', AI_ROUTE_IMAGE: 'nano-banana@openrouter' });
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

  it('senza chiave openrouter non è una rotta: si ripiega, rumorosamente', async () => {
    setEnv({ GEMINI_API_KEY: 'g', AI_ROUTE_IMAGE: 'nano-banana@openrouter' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { route } = await import('./model-routing');
    expect(route('image')).toMatchObject({ endpoint: 'google', provider: 'gemini' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('una coppia senza trasporto non è una rotta: si ripiega, e dice perché', async () => {
    // `geminiTransport()` conosce solo kie e google: il testo verso openrouter atterrerebbe su
    // Google IN SILENZIO, cioè la rotta si legge come rispettata e non lo è. Vale identico per le
    // coppie che erano già cieche prima di openrouter — una regola sola, non un'eccezione.
    for (const raw of ['gemini@openrouter', 'gemini@xiaomi', 'gemini@deepseek', 'mimo@kie']) {
      vi.resetModules();
      setEnv({ ...KEYS, OPENROUTER_API_KEY: 'o', DEEPSEEK_API_KEY: 'd', AI_ROUTE_TEXT: raw });
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
      ['gemini@google', 'text', 'google'],
      ['mimo@xiaomi', 'text', 'xiaomi'],
      ['grok@kie', 'text', 'kie'],
      ['nano-banana@openrouter', 'image', 'openrouter'],
      ['nano-banana@google', 'image', 'google'],
      ['gemini-tts@kie', 'tts', 'kie']
    ] as const) {
      vi.resetModules();
      setEnv({ ...KEYS, OPENROUTER_API_KEY: 'o', [SLOT_VAR[slot]]: raw });
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
    setEnv({ ...KEYS, OPENROUTER_API_KEY: 'o' });
    const { route } = await import('./model-routing');
    expect(route('image')).toMatchObject({ family: 'nano-banana', endpoint: 'openrouter' });
  });

  it('il testo e la voce NON si spostano con le immagini', async () => {
    setEnv({ ...KEYS, OPENROUTER_API_KEY: 'o' });
    const { route } = await import('./model-routing');
    expect(route('text').endpoint).toBe('google');
    expect(route('tts').endpoint).toBe('kie');
  });

  it('senza chiave openrouter le immagini ripiegano su kie, che resta il ripiego', async () => {
    setEnv({ ...KEYS });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { route } = await import('./model-routing');
    expect(route('image').endpoint).toBe('kie');
    warn.mockRestore();
  });

  it('IMAGE_PROVIDER=gemini VINCE ancora: e` scritta in produzione e tiene le immagini su Google', async () => {
    // Il difetto piu` facile di questo cambio: girare il default e credere che basti. La vecchia
    // variabile batte SLOT_DEFAULT, quindi finche` resta impostata su Vercel il deploy non sposta
    // un solo render. Si scavalca con AI_ROUTE_IMAGE, che batte entrambe.
    setEnv({ ...KEYS, OPENROUTER_API_KEY: 'o', IMAGE_PROVIDER: 'gemini' });
    const { route } = await import('./model-routing');
    expect(route('image').endpoint).toBe('google');

    vi.resetModules();
    setEnv({ ...KEYS, OPENROUTER_API_KEY: 'o', IMAGE_PROVIDER: 'gemini', AI_ROUTE_IMAGE: 'nano-banana@openrouter' });
    const { route: route2 } = await import('./model-routing');
    expect(route2('image').endpoint).toBe('openrouter');
  });

  it('i modelli video: nuova variabile, vecchia variabile, default', async () => {
    setEnv({ ...KEYS, AI_ROUTE_VIDEO_I2V: 'bytedance/seedance-2-5', KIE_VIDEO_MODEL_T2V: 'vecchio/t2v' });
    const { videoModel } = await import('./model-routing');
    expect(videoModel('i2v')).toBe('bytedance/seedance-2-5');
    expect(videoModel('t2v')).toBe('vecchio/t2v');
    expect(videoModel('upscale')).toBe('grok-imagine/upscale');
  });
});

describe('i due assi non si collassano', () => {
  beforeEach(() => vi.resetModules());

  it('AI_ROUTE_TEXT=grok@kie sposta il default, ma non il trasporto di Gemini', async () => {
    setEnv({ ...KEYS, AI_ROUTE_TEXT: 'grok@kie' });
    const { geminiTransport } = await import('./gemini');
    const { AI_PROVIDER } = await import('./xiaomi');
    // Il default del lavoro strutturato diventa kie/Grok…
    expect(AI_PROVIDER).toBe('kie');
    // …ma le 28 chiamate con PIN_GEMINI restano Gemini, e Gemini resta su Google.
    expect(geminiTransport()).toBe('google');
  });

  it('AI_ROUTE_TEXT=gemini@kie sposta il trasporto, non la famiglia', async () => {
    setEnv({ ...KEYS, AI_ROUTE_TEXT: 'gemini@kie' });
    const { geminiTransport } = await import('./gemini');
    const { AI_PROVIDER } = await import('./xiaomi');
    expect(geminiTransport()).toBe('kie');
    expect(AI_PROVIDER).toBe('gemini');
  });
});
