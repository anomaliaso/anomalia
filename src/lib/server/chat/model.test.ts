import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HARNESS_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import { choiceForPolicy, policyForChoice } from '$lib/chat-model-policy';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { resolveChatModel, modelSeesImages, modelSeesVideo, compactionModel, isHeavyProductionAsk } =
  await import('./model');

// Il default del centralino è un Gemini (i video passano solo lì); il secondo id è solo-testo,
// così le asserzioni su immagini/video distinguono davvero i due pick.
const PICK_1 = 'google/gemini-2.5-flash';
const PICK_2 = 'anthropic/claude-sonnet-4';

function setLlmEnv(): void {
  env.LLM_API_KEY = 'llm-test';
  env.LLM_DEFAULT_MODEL = PICK_1;
  env.LLM_MODELS = `${PICK_1},${PICK_2}`;
}

describe('resolveChatModel', () => {
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    setLlmEnv();
  });

  it('ogni tier risolve sul centralino: il provider è sempre \'llm\'', () => {
    // La vecchia multi-route (kie Luna/Grok, DeepSeek, Gemini di ripiego) non esiste più: il tier
    // resta un'etichetta per UI/log, il tubo è uno.
    for (const tier of ['auto', 'fast', 'pro', 'deepseek-pro', 'gpt-terra', 'gpt-sol'] as const) {
      const m = resolveChatModel(tier);
      expect(m.provider).toBe('llm');
      expect(m.tier).toBe(tier);
    }
  });

  it('il picker mappa Fast/auto sul primo modello e Pro sull\'ultimo di LLM_MODELS', () => {
    expect(resolveChatModel('fast').modelId).toBe(PICK_1);
    expect(resolveChatModel('auto').modelId).toBe(PICK_1);
    expect(resolveChatModel('gpt-terra').modelId).toBe(PICK_1);
    // Solo 'pro' (e gli alias 'deepseek-pro' / 'gpt-sol') salgono al secondo id.
    expect(resolveChatModel('pro').modelId).toBe(PICK_2);
    expect(resolveChatModel('gpt-sol').modelId).toBe(PICK_2);
    expect(resolveChatModel('deepseek-pro').modelId).toBe(PICK_2);
  });

  it('senza LLM_MODELS la lista è il solo default: Pro ricade lì invece di lanciare', () => {
    delete env.LLM_MODELS;
    expect(resolveChatModel('fast').modelId).toBe(PICK_1);
    expect(resolveChatModel('pro').modelId).toBe(PICK_1);
  });

  it('chiavekie, DeepSeek, Xiaomi, Gemini e CHAT_* vecchi sono decorativi', () => {
    // Residui dei routing precedenti: se si accendono da soli in produzione non devono cambiare
    // nulla — nessun fallback "esperto" che manda la chat altrove.
    env.KIE_API_KEY = 'kie-test';
    env.DEEPSEEK_API_KEY = 'ds-test';
    env.XIAOMI_MIMO_API_KEY = 'xm-test';
    env.GEMINI_API_KEY = 'gemini-test';
    env.GOOGLE_API_KEY = 'google-test';
    env.CHAT_FAST_PROVIDER = 'deepseek';
    env.KIE_MODEL = 'grok-4-5';
    for (const tier of ['fast', 'auto', 'pro'] as const) {
      const m = resolveChatModel(tier);
      expect(m.provider).toBe('llm');
      expect(m.modelId).toBe(tier === 'pro' ? PICK_2 : PICK_1);
    }
  });

  it('CHAT_TIER decide quando il turno non dice il suo, una spazzatura torna su Auto', () => {
    env.CHAT_TIER = 'pro';
    const m = resolveChatModel(undefined);
    expect(m.tier).toBe('pro');
    expect(m.modelId).toBe(PICK_2);

    env.CHAT_TIER = 'nonsense';
    expect(resolveChatModel(undefined).tier).toBe('auto');

    // Un tier in ingresso valido batte comunque la env.
    expect(resolveChatModel('fast').tier).toBe('fast');
  });

  it('senza default configurato il resolver lancia llm_unconfigured, non indovina un modello', () => {
    delete env.LLM_DEFAULT_MODEL;
    delete env.LLM_API_KEY;
    expect(() => resolveChatModel('fast')).toThrow('llm_unconfigured');
  });

  it('callOptions portano solo il tetto di output pieno del centralino', () => {
    // Senza tetto ogni OpenAI-compat applica il proprio default (spesso 4096) e la risposta lunga
    // si tronca in silenzio. Per provider 'llm' il limite conservativo dell'harness vale per tutti.
    for (const tier of ['fast', 'auto', 'pro', 'gpt-terra', 'gpt-sol'] as const) {
      expect(resolveChatModel(tier).callOptions).toEqual({ maxOutputTokens: HARNESS_MAX_OUTPUT_TOKENS });
    }
  });

  it('Fast resta medium; Auto (generalista) sale a high per policy; Pro parla alto per famiglia', () => {
    expect(resolveChatModel('fast').reasoning).toBe('medium');
    expect(resolveChatModel('auto').reasoning).toBe('high'); // DEFAULT_AGENT_MODEL
    expect(resolveChatModel('pro').reasoning).toBe('high'); // default della famiglia Grok
  });

  it('Auto (Luna) accetta low|medium|high; xhigh collassa su high; spazzatura sul pavimento della famiglia', () => {
    expect(resolveChatModel('auto', 'high').reasoning).toBe('high');
    // Alias legacy: xhigh → max → nearest sulla scala Luna = high.
    expect(resolveChatModel('auto', 'xhigh').reasoning).toBe('high');
    // Un valore non riconosciuto cade sul default della FAMIGLIA sotto il tier, non della policy.
    expect(resolveChatModel('auto', 'nonsense').reasoning).toBe('medium');
    // Fast si regola o sregola dal suo medium; 'off' e 'max' non esistono su Luna: pavimento e soffitto.
    expect(resolveChatModel('fast', 'low').reasoning).toBe('low');
    expect(resolveChatModel('fast', 'high').reasoning).toBe('high');
    expect(resolveChatModel('fast', 'off').reasoning).toBe('low');
    expect(resolveChatModel('fast', 'none').reasoning).toBe('low');
    expect(resolveChatModel('fast', 'max').reasoning).toBe('high');
  });

  it('con immagini il turno NON scambia mai modello: il gateway è già multimodale per contratto', () => {
    // Anche il pick "Pro" qui è un modello solo-testo (Claude), ma il provider 'llm' dichiara
    // visione: il vecchio swap verso Gemini/solo-visione è morte e l'etichetta tier resta.
    const m = resolveChatModel('pro', undefined, { vision: true });
    expect(m.provider).toBe('llm');
    expect(m.modelId).toBe(PICK_2);
    expect(m.tier).toBe('pro');
    expect(modelSeesImages(m)).toBe(true);
    expect(modelSeesImages(resolveChatModel('fast', undefined, { vision: true }))).toBe(true);
  });

  it('le clip passano solo su un pick google/gemini-*, e lo dice prima di partire', () => {
    expect(modelSeesVideo(resolveChatModel('auto'))).toBe(true); // default Gemini sul gateway
    expect(modelSeesVideo(resolveChatModel('pro'))).toBe(false); // Claude: no video
    // Un default non-Gemini chiude anche lì: niente turno finto sulla clip mai vista.
    env.LLM_DEFAULT_MODEL = 'openai/gpt-5-mini';
    env.LLM_MODELS = 'openai/gpt-5-mini,anthropic/claude-sonnet-4';
    for (const tier of ['auto', 'fast', 'pro'] as const) {
      expect(modelSeesVideo(resolveChatModel(tier))).toBe(false);
    }
  });
});

describe('compactionModel', () => {
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    setLlmEnv();
  });

  it('compatta sul default del gateway a pensiero basso, MAI sul modello della conversazione', () => {
    const c = compactionModel();
    expect(c?.provider).toBe('llm');
    expect(c?.modelId).toBe(PICK_1);
    expect(c?.reasoning).toBe('low');
    expect(c?.callOptions).toEqual({ maxOutputTokens: HARNESS_MAX_OUTPUT_TOKENS });
  });

  it('senza gateway non si compatta: meglio un thread lungo che una bolletta a sorpresa', () => {
    // Le chiavi degli altri tempi non riaprono la compattazione: null è deliberato.
    env.KIE_API_KEY = 'kie-test';
    env.GEMINI_API_KEY = 'gemini-test';
    delete env.LLM_API_KEY;
    expect(compactionModel()).toBeNull();
  });
});

describe('le richieste di produzione pesanti riconosciute senza chiamate modello', () => {
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    setLlmEnv();
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

  it('Auto + richiesta pesante → tier Pro, cioè il secondo modello della lista', () => {
    const m = resolveChatModel('auto', undefined, { userText: 'crea un carosello per il lancio' });
    expect(m.tier).toBe('pro');
    expect(m.modelId).toBe(PICK_2);
    expect(m.provider).toBe('llm');
  });

  it('la scalata non richiede alcuna chiave legacy: il solo centralino basta', () => {
    // Già corretto: prima il gate era `kieConfigured()` e un brand senza KIE_API_KEY non
    // scalava mai. Il Pro ora è semplicemente il secondo modello della lista del picker.
    const m = resolveChatModel('auto', undefined, { userText: 'crea un carosello per il lancio' });
    expect(m.tier).toBe('pro');
    expect(m.modelId).toBe(PICK_2);
  });

  it('Auto + domanda normale resta Auto: primo modello, nessuna scalata', () => {
    const m = resolveChatModel('auto', undefined, { userText: 'che piano ho attivo?' });
    expect(m.tier).toBe('auto');
    expect(m.modelId).toBe(PICK_1);
  });

  it('un tier ESPLICITO non scala mai: Fast resta Fast anche su una richiesta pesante', () => {
    const m = resolveChatModel('fast', undefined, { userText: 'genera un video e tre post' });
    expect(m.tier).toBe('fast');
    expect(m.modelId).toBe(PICK_1);
  });
});

describe('la preferenza salvata su thread e agente custom (0225)', () => {
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    setLlmEnv();
  });

  it('su Auto il pensiero salvato batte la policy dello spec, ma il modello resta quello del picker', () => {
    // Lo spec motion chiederebbe Grok a high: la riga salvata vince sul THINKING, mentre il tubo
    // resta quello che il tier risolve — la famiglia non sceglie più il modello.
    const m = resolveChatModel('auto', undefined, {
      agentId: 'motion',
      model: { family: 'grok', thinking: 'low' }
    });
    expect(m.reasoning).toBe('low');
    expect(m.modelId).toBe(PICK_1);
  });

  it('la famiglia salvata imposta il VOCABOLARIO: DeepSeek concede off dove Luna lo collassa', () => {
    const off = resolveChatModel('auto', undefined, {
      model: { family: 'deepseek-pro', thinking: 'off' }
    });
    expect(off.reasoning).toBe('off'); // DeepSeek ha l'off vero

    // Con la stessa richiesta e nessuna famiglia la Luna mette il pavimento.
    const luna = resolveChatModel('auto', undefined, { model: { family: 'luna', thinking: 'off' } });
    expect(luna.reasoning).toBe('low');
  });

  it('una riga sporca non cambia nulla: policy di default, primo modello', () => {
    const m = resolveChatModel('auto', undefined, { model: { family: 'pippo' } });
    expect(m.modelId).toBe(PICK_1);
    expect(m.reasoning).toBe('high');
  });

  it('un tier esplicito vince sulla riga salvata e passa per il picker: Pro → secondo modello', () => {
    const m = resolveChatModel('pro', undefined, { model: { family: 'luna', thinking: 'low' } });
    expect(m.modelId).toBe(PICK_2);
    // Il pensiero salvato conta solo su Auto: qui decide la famiglia Grok sotto Pro.
    expect(m.reasoning).toBe('high');
  });

  it('il giro completo: pick \'pro\' salvato sul thread torna come tier e riacquista il secondo modello', () => {
    const row = policyForChoice('pro', 'high');
    expect(choiceForPolicy(row)?.tier).toBe('pro');
    const m = resolveChatModel(choiceForPolicy(row)?.tier);
    expect(m.modelId).toBe(PICK_2);
    expect(m.provider).toBe('llm');
  });

  it('salvare Auto produce null: il thread torna alla risoluzione di default', () => {
    expect(policyForChoice('auto', 'high')).toBeNull();
    expect(resolveChatModel('auto').modelId).toBe(PICK_1);
  });
});

/**
 * RE-TARGET DEL VECCHIO «il turno non è muto finché non ha finito» (eval 24/8). Quel silenzio era
 * la Responses di kie senza `reasoningSummary`, e il rimedio viveva nei callOptions di Terra/Sol/
 * Luna/Grok: tutto rimosso con il gateway. Oggi i pick Terra e Sol attraversano solo
 * llmModelForPicker ('gpt-sol' → secondo modello), e nessun turno porta callOptions speciali.
 */
describe('il turno non è muto finché non ha finito', () => {
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    setLlmEnv();
  });

  it('Terra resta sul primo modello; Sol risolve come Pro, sul secondo', () => {
    // Terra non è tra gli alias del picker: ricade sul default. Solo 'pro'/'deepseek-pro'/
    // 'gpt-sol' salgono a LLM_MODELS[1].
    expect(resolveChatModel('gpt-terra').modelId).toBe(PICK_1);
    const sol = resolveChatModel('gpt-sol');
    expect(sol.modelId).toBe(PICK_2);
    expect(sol.provider).toBe('llm');
    expect(sol.tier).toBe('gpt-sol');
  });

  it('nessun trucco per far parlare prima il modello: niente reasoningSummary né temperature', () => {
    for (const tier of ['fast', 'auto', 'pro', 'gpt-terra', 'gpt-sol'] as const) {
      const opts = resolveChatModel(tier).callOptions;
      expect(opts).toEqual({ maxOutputTokens: HARNESS_MAX_OUTPUT_TOKENS });
      expect('temperature' in opts).toBe(false);
      expect('providerOptions' in opts).toBe(false);
    }
  });
});
