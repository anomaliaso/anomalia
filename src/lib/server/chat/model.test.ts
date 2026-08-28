import { beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { resolveChatModel, modelSeesImages, modelSeesVideo, compactionModel, takeKieUsage, isHeavyProductionAsk } =
  await import('./model');

/** What actually goes on the wire as thinkingConfig for a Gemini call. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const thinking = (m: { callOptions: Record<string, any> }) =>
  m.callOptions.providerOptions.google.thinkingConfig;

/** Quello che finisce davvero sul filo come reasoning effort per una chiamata kie. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const effort = (m: { callOptions: Record<string, any> }) =>
  m.callOptions.providerOptions.openai.reasoningEffort;

describe('resolveChatModel', () => {
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    env.DEEPSEEK_API_KEY = 'ds-test';
    env.KIE_API_KEY = 'kie-test';
    env.GEMINI_API_KEY = 'gemini-test';
  });

  it('sends the DeepSeek Pro custom pick to deepseek-v4-pro', () => {
    const m = resolveChatModel('deepseek-pro');
    expect(m.provider).toBe('deepseek');
    expect(m.modelId).toBe('deepseek-v4-pro');
    expect(m.tier).toBe('deepseek-pro');
    expect(m.reasoning).toBe('high');
  });

  it('sends GPT 5.6 Terra and Sol to kie Codex with penultimate thinking', () => {
    const terra = resolveChatModel('gpt-terra');
    expect(terra.provider).toBe('kie');
    expect(terra.modelId).toBe('gpt-5-6-terra');
    expect(terra.tier).toBe('gpt-terra');
    // Penultimate di ['off','low','medium','high','max'] è 'high' (il filo kie lo scrive xhigh).
    expect(terra.reasoning).toBe('high');

    const sol = resolveChatModel('gpt-sol');
    expect(sol.modelId).toBe('gpt-5-6-sol');
    expect(sol.tier).toBe('gpt-sol');
    expect(sol.reasoning).toBe('high');
  });

  it('runs Fast e Auto su Luna; Pro su Grok; motion+Auto su Grok', () => {
    const fast = resolveChatModel('fast');
    expect(fast.provider).toBe('kie');
    expect(fast.modelId).toBe('gpt-5-6-luna');
    expect(fast.tier).toBe('fast');

    // Auto senza agente (generalista) → Luna, policy default (DEFAULT_AGENT_MODEL: high).
    const auto = resolveChatModel('auto');
    expect(auto.provider).toBe('kie');
    expect(auto.modelId).toBe('gpt-5-6-luna');
    expect(auto.tier).toBe('auto');
    expect(auto.reasoning).toBe('high');

    const pro = resolveChatModel('pro');
    expect(pro.provider).toBe('kie');
    expect(pro.modelId).toBe('grok-4-6');
    expect(pro.tier).toBe('pro');

    // Solo lo spec motion forza Grok sotto Auto.
    const motion = resolveChatModel('auto', undefined, { agentId: 'motion' });
    expect(motion.modelId).toBe('grok-4-6');
    expect(motion.tier).toBe('auto');
    expect(motion.reasoning).toBe('high');

    // content resta Luna.
    expect(resolveChatModel('auto', undefined, { agentId: 'content' }).modelId).toBe('gpt-5-6-luna');
  });

  // Fast resta Luna a medium (tier scelto a mano). Auto (generalista) legge DEFAULT_AGENT_MODEL,
  // che il proprietario ha portato a high il 23/8: Auto è la testa che lavora, Fast resta veloce.
  it('Fast resta Luna a medium; Auto (generalista) sale a high; Pro è Grok a high', () => {
    const fast = resolveChatModel('fast');
    expect(fast.reasoning).toBe('medium');
    expect(effort(fast)).toBe('medium');

    const auto = resolveChatModel('auto');
    expect(auto.modelId).toBe('gpt-5-6-luna');
    expect(auto.reasoning).toBe('high');
    expect(effort(auto)).toBe('high');
    expect(resolveChatModel('pro').reasoning).toBe('high');
  });

  it('resends nothing of the conversation to kie: store stays false on Fast and Auto', () => {
    // Senza store:false l'SDK rimanda gli item come {type:'item_reference'} e kie risponde con una
    // busta 500 in HTTP 200: il turno finisce con uno step vuoto dopo che il tool è già girato.
    for (const tier of ['fast', 'auto'] as const) {
      expect(resolveChatModel(tier).callOptions.providerOptions.openai.store).toBe(false);
    }
  });

  it('forza il reasoning su Grok (Pro e motion Auto), o effort e pensieri spariscono', () => {
    // Il provider OpenAI riconosce i reasoning model dal NOME (o1|o3|o4-mini|gpt-5*): `grok-4-6`
    // non ci sta dentro, quindi senza forceReasoning NON manda reasoning.effort.
    for (const m of [
      resolveChatModel('pro'),
      resolveChatModel('auto', undefined, { agentId: 'motion' })
    ]) {
      const openai = m.callOptions.providerOptions.openai;
      expect(openai.forceReasoning).toBe(true);
      expect(openai.reasoningEffort).toBeTruthy();
    }
  });

  it('never sends 2.5-era token budgets to the Gemini fallback', () => {
    delete env.KIE_API_KEY;
    for (const tier of ['fast', 'auto'] as const) {
      expect(thinking(resolveChatModel(tier))).not.toHaveProperty('thinkingBudget');
    }
  });

  it('Auto (Luna) accetta low|medium|high; xhigh collassa su high; spazzatura sul pavimento di Luna, nessuna scelta sul default della policy (high)', () => {
    expect(resolveChatModel('auto', 'high').reasoning).toBe('high');
    // Scala comune: xhigh è alias di max → nearest su Luna = high.
    expect(resolveChatModel('auto', 'xhigh').reasoning).toBe('high');
    // Un valore non riconosciuto (ma non assente) cade sul default della FAMIGLIA Luna, non
    // della policy agente: coerceReasoning non vede mai policy.thinking per una stringa scartata.
    expect(resolveChatModel('auto', 'nonsense').reasoning).toBe('medium');
    // Nessuna scelta → resolveChatModel inietta il default della policy agente (high, 23/8).
    expect(resolveChatModel('auto', undefined).reasoning).toBe('high');
  });

  it('lets Fast be turned down or up from its medium default', () => {
    const level = (l: string) => effort(resolveChatModel('fast', l));
    expect(level('low')).toBe('low');
    expect(level('high')).toBe('high');
    // Vocabulary from the other models: the Fast picker only offers low/medium/high, so these
    // land on its own floor and ceiling instead of going out raw and 500ing on kie.
    expect(level('off')).toBe('low');
    expect(level('none')).toBe('low');
    expect(level('max')).toBe('high');
    expect(level('xhigh')).toBe('high');
  });

  it('ignores a stale CHAT_FAST_PROVIDER: Fast e Auto restano Luna', () => {
    for (const stale of ['deepseek', 'gemini', 'nonsense']) {
      env.CHAT_FAST_PROVIDER = stale;
      expect(resolveChatModel('fast').modelId).toBe('gpt-5-6-luna');
      expect(resolveChatModel('auto').modelId).toBe('gpt-5-6-luna');
    }
  });

  it('reads images on Fast natively', () => {
    const fast = resolveChatModel('fast');
    expect(fast.provider).toBe('kie');
    expect(fast.modelId).toBe('gpt-5-6-luna');
    expect(modelSeesImages(fast)).toBe(true);
  });

  it('no preset tier watches a clip any more — and says so instead of pretending', () => {
    // Il video allegato al turno resta solo su Gemini: se un giorno tornasse un default che non
    // vede le clip senza dirlo, questo test cade prima dell'utente.
    for (const tier of ['fast', 'auto', 'pro'] as const) {
      expect(modelSeesVideo(resolveChatModel(tier))).toBe(false);
    }
    delete env.KIE_API_KEY;
    expect(modelSeesVideo(resolveChatModel('fast'))).toBe(true);
  });

  it('keeps the text-only DeepSeek Pro pick on an image turn — the swap is gone', () => {
    const m = resolveChatModel('deepseek-pro');
    expect(m.provider).toBe('deepseek');
    expect(m.modelId).toBe('deepseek-v4-pro');
    expect(modelSeesImages(m)).toBe(false);
  });

  it('keeps Pro on grok-4-6 even when KIE_MODEL is still grok-4-5', () => {
    env.KIE_MODEL = 'grok-4-5';
    const pro = resolveChatModel('pro');
    expect(pro.modelId).toBe('grok-4-6');
  });

  it('does not swap Pro to Gemini when images are attached', () => {
    const pro = resolveChatModel('pro');
    expect(pro.provider).toBe('kie');
    expect(pro.modelId).toBe('grok-4-6');
    expect(modelSeesImages(pro)).toBe(true);
  });

  it('falls back from DeepSeek Pro to Grok when the DeepSeek key is missing', () => {
    delete env.DEEPSEEK_API_KEY;
    const m = resolveChatModel('deepseek-pro');
    expect(m.provider).toBe('kie');
    expect(m.tier).toBe('deepseek-pro');
  });

  it('follows GEMINI_FLASH at call time on the fallback path', () => {
    delete env.KIE_API_KEY;
    env.GEMINI_FLASH = 'gemini-3.8-flash';
    const m = resolveChatModel('fast');
    expect(m.provider).toBe('gemini');
    expect(m.modelId).toBe('gemini-3.8-flash');
    env.GEMINI_FLASH = 'gemini-3.7-flash';
    expect(resolveChatModel('fast').modelId).toBe('gemini-3.7-flash');
  });

  it('falls back to Gemini Flash when the kie key is missing, keeping the tier', () => {
    delete env.KIE_API_KEY;
    const fast = resolveChatModel('fast');
    expect(fast.provider).toBe('gemini');
    expect(fast.modelId).toBe('gemini-3.7-flash');
    expect(fast.tier).toBe('fast');
  });

  it('compacts on Luna, on Gemini without kie, and on nothing without either', () => {
    // La compattazione non deve MAI essere il modello della conversazione, e non deve pagare il
    // ragionamento di un turno per fare un riassunto meccanico.
    const luna = compactionModel();
    expect(luna?.modelId).toBe('gpt-5-6-luna');
    expect(luna?.reasoning).toBe('low');

    delete env.KIE_API_KEY;
    expect(compactionModel()?.modelId).toBe('gemini-3.7-flash');

    delete env.GEMINI_API_KEY;
    delete env.GOOGLE_API_KEY;
    // null = non si compatta. Meglio un thread lungo che una bolletta a sorpresa.
    expect(compactionModel()).toBeNull();
  });
});

describe('takeKieUsage', () => {
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    env.KIE_API_KEY = 'kie-test';
  });

  it('non riporta niente per un provider che non fattura a crediti', () => {
    delete env.KIE_API_KEY;
    env.GEMINI_API_KEY = 'gemini-test';
    expect(takeKieUsage(resolveChatModel('fast'))).toEqual({});
  });

  it('somma i credits_consumed dello stream, li azzera, e ne ricava cost_usd', async () => {
    const m = resolveChatModel('fast');
    // Si passa dalla fetch del modello: è l'unico punto in cui i crediti esistono davvero.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doFetch = (m.model as any).config.fetch as typeof fetch;
    const sse =
      'data: {"type":"response.output_text.delta","delta":"ok"}\n\n' +
      'data: {"type":"response.completed","credits_consumed":0.42,"response":{}}\n\n';
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(sse, { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;
    try {
      const res = await doFetch('https://api.kie.ai/codex/v1/responses', { method: 'POST' });
      expect(await res.text()).toContain('response.completed'); // il corpo passa intatto
    } finally {
      globalThis.fetch = orig;
    }

    // 0.42 crediti × $0.005 = $0.0021.
    expect(takeKieUsage(m)).toEqual({ providerCredits: 0.42, flatCostUsd: 0.0021 });
    // Seconda lettura: il contatore è azzerato, così padre e sotto-agente non fatturano due volte.
    expect(takeKieUsage(m)).toEqual({});
  });
});

describe('Auto → Pro: la scalata sui lavori di produzione', () => {
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    env.KIE_API_KEY = 'kie-test';
  });

  it('riconosce le richieste di produzione, in italiano e inglese', () => {
    expect(isHeavyProductionAsk('crea un carosello per il lancio di settembre')).toBe(true);
    expect(isHeavyProductionAsk('generate a video for the product launch')).toBe(true);
    expect(isHeavyProductionAsk('fai un post con la nuova offerta')).toBe(true);
    expect(isHeavyProductionAsk('produci tre immagini per il feed')).toBe(true);
    expect(isHeavyProductionAsk('serve un UGC per TikTok')).toBe(true); // termine forte da solo
    expect(isHeavyProductionAsk('render the motion trailer')).toBe(true);
  });

  it('NON scala su domande e conversazione normale', () => {
    expect(isHeavyProductionAsk("com'è andata la settimana?")).toBe(false);
    expect(isHeavyProductionAsk('what does my plan include?')).toBe(false);
    expect(isHeavyProductionAsk('spiegami la strategia SEO')).toBe(false);
    expect(isHeavyProductionAsk('')).toBe(false);
    expect(isHeavyProductionAsk(undefined)).toBe(false);
  });

  it('Auto + richiesta pesante → il turno gira su Grok (Pro), e lo dice', () => {
    const m = resolveChatModel('auto', undefined, { userText: 'crea un carosello per il lancio' });
    expect(m.tier).toBe('pro');
    expect(m.modelId).toBe('grok-4-6');
  });

  it('Auto + domanda normale resta Auto: Luna al default della policy (high), nessuna scalata a Pro', () => {
    const m = resolveChatModel('auto', undefined, { userText: 'che piano ho attivo?' });
    expect(m.tier).toBe('auto');
    expect(m.modelId).toBe('gpt-5-6-luna');
    expect(m.reasoning).toBe('high');
  });

  it('un tier ESPLICITO non scala mai: Fast resta Fast anche su una richiesta pesante', () => {
    const m = resolveChatModel('fast', undefined, { userText: 'genera un video e tre post' });
    expect(m.tier).toBe('fast');
    expect(m.modelId).toBe('gpt-5-6-luna');
  });

  it('senza kie non si scala: il ripiego Gemini resta il ripiego', () => {
    delete env.KIE_API_KEY;
    env.GEMINI_API_KEY = 'gemini-test';
    const m = resolveChatModel('auto', undefined, { userText: 'crea un carosello' });
    expect(m.tier).toBe('auto');
    expect(m.provider).toBe('gemini');
  });
});

describe('la preferenza salvata su thread e agente custom (0225)', () => {
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    env.DEEPSEEK_API_KEY = 'ds-test';
    env.KIE_API_KEY = 'kie-test';
  });

  it('su Auto la famiglia salvata batte quella dello spec dell agente', () => {
    const m = resolveChatModel('auto', undefined, {
      agentId: 'motion',
      model: { family: 'deepseek-pro', thinking: 'low' }
    });
    expect(m.modelId).toBe('deepseek-v4-pro');
    expect(m.reasoning).toBe('low');
  });

  it('una famiglia scelta a mano non viene scalata a Pro da una richiesta pesante', () => {
    const m = resolveChatModel('auto', undefined, {
      userText: 'crea un carosello per il lancio',
      model: { family: 'gpt-terra', thinking: 'high' }
    });
    expect(m.modelId).toBe('gpt-5-6-terra');
  });

  it('una riga sporca non cambia nulla: resta il default del tier', () => {
    const m = resolveChatModel('auto', undefined, { model: { family: 'pippo' } });
    expect(m.modelId).toBe('gpt-5-6-luna');
  });

  it('un tier esplicito resta la scelta di chi scrive adesso', () => {
    const m = resolveChatModel('pro', undefined, { model: { family: 'luna', thinking: 'low' } });
    expect(m.modelId).toBe('grok-4-6');
  });
});

describe('temperature sui reasoning model kie', () => {
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    env.KIE_API_KEY = 'kie-test';
    env.GEMINI_API_KEY = 'gemini-test';
  });

  it('Luna e Grok portano temperature:undefined nei callOptions — spanto DOPO il default 0.4, la toglie dal filo', () => {
    for (const tier of ['fast', 'auto', 'pro', 'gpt-terra', 'gpt-sol'] as const) {
      const m = resolveChatModel(tier);
      expect('temperature' in m.callOptions).toBe(true);
      expect(m.callOptions.temperature).toBeUndefined();
    }
  });

  it('i modelli non-reasoning NON vengono toccati', () => {
    delete env.KIE_API_KEY;
    const gemini = resolveChatModel('fast');
    expect('temperature' in gemini.callOptions).toBe(false);
  });
});

/**
 * IL SILENZIO DEI PRIMI 90% DEL TURNO — eval del 24/8.
 *
 * La prima parola arrivava a 7,5s su 8,3s e a 24,3s su 25,7s. Non era lentezza: era che senza
 * `summary` la Responses di kie non emette UN SOLO evento di ragionamento, quindi fino alla
 * `reply` finale non esisteva niente da mostrare. `sendReasoning: true` (bridge/live.ts) era già
 * lì e spediva il vuoto. Verificato sul filo, stesso prompt:
 *   reasoning:{effort:'high'}                → 0 eventi reasoning_summary_*
 *   reasoning:{effort:'high',summary:'auto'} → reasoning_summary_text.delta come PRIMO output
 *                                              item, prima del testo e della function_call.
 */
describe('il turno non è muto finché non ha finito', () => {
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    env.KIE_API_KEY = 'kie-test';
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const summary = (m: { callOptions: Record<string, any> }) =>
    m.callOptions.providerOptions.openai.reasoningSummary;

  it('Fast e Auto (Luna, il motore di quasi tutti i turni) chiedono il riassunto del ragionamento', () => {
    expect(summary(resolveChatModel('fast'))).toBe('auto');
    expect(summary(resolveChatModel('auto'))).toBe('auto');
  });

  it('vale anche per Terra e Sol: è della famiglia GPT su kie, non di un tier', () => {
    expect(summary(resolveChatModel('gpt-terra'))).toBe('auto');
    expect(summary(resolveChatModel('gpt-sol'))).toBe('auto');
  });

  it("su Grok non c'è: il parametro passa ma non produce eventi, e un'opzione inerte è solo rumore", () => {
    expect(summary(resolveChatModel('pro'))).toBeUndefined();
  });
});
