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

  it('ogni scelta risolve sul centralino: il provider è sempre \'llm\'', () => {
    // La vecchia multi-route (kie Luna/Grok, DeepSeek, Gemini di ripiego) non esiste più: il tier
    // resta un'etichetta per UI/log, il tubo è uno.
    for (const tier of ['deepseek-pro', 'gpt-terra', 'gpt-sol'] as const) {
      const m = resolveChatModel(tier);
      expect(m.provider).toBe('llm');
      expect(m.tier).toBe(tier);
    }
  });

  /**
   * Auto, Fast e Pro non sono piu` tier: erano alias per LLM_DEFAULT_MODEL e per il SECONDO
   * elemento di LLM_MODELS. Chi ne scrive uno adesso non sta scegliendo niente, e prende il
   * default — non il secondo modello della lista, che era la scelta piu` sorprendente di tutte.
   */
  it('i preset spariti non sono piu\' una scelta: cadono sul default', () => {
    for (const gone of ['auto', 'fast', 'pro']) {
      const m = resolveChatModel(gone);
      expect(m.tier).toBe(null);
      expect(m.modelId).toBe(PICK_1);
    }
  });

  it('un id del catalogo passa intatto', () => {
    expect(resolveChatModel(PICK_2).modelId).toBe(PICK_2);
    expect(resolveChatModel(PICK_2).tier).toBe(PICK_2);
  });

  it('nessuna scelta prende il default, non il primo della lista per caso', () => {
    env.LLM_DEFAULT_MODEL = PICK_2;
    expect(resolveChatModel(undefined).modelId).toBe(PICK_2);
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
    env.CHAT_TIER = 'pro';
    const m = resolveChatModel(undefined);
    expect(m.provider).toBe('llm');
    expect(m.modelId).toBe(PICK_1);
  });

  it('senza default configurato il resolver lancia llm_unconfigured, non indovina un modello', () => {
    delete env.LLM_DEFAULT_MODEL;
    delete env.LLM_API_KEY;
    expect(() => resolveChatModel('fast')).toThrow('llm_unconfigured');
  });

  it('callOptions portano solo il tetto di output pieno del centralino', () => {
    // Senza tetto ogni OpenAI-compat applica il proprio default (spesso 4096) e la risposta lunga
    // si tronca in silenzio. Per provider 'llm' il limite conservativo dell'harness vale per tutti.
    for (const tier of [null, 'gpt-terra', 'gpt-sol'] as const) {
      expect(resolveChatModel(tier ?? undefined).callOptions).toEqual({
        maxOutputTokens: HARNESS_MAX_OUTPUT_TOKENS
      });
    }
  });

  it('senza scelta il pensiero parte da medium sulla scala comune', () => {
    expect(resolveChatModel(undefined).reasoning).toBe('medium');
    expect(resolveChatModel(PICK_2).reasoning).toBe('medium');
  });

  it('la scala comune accetta low|medium|high; xhigh collassa su high; spazzatura sul default', () => {
    expect(resolveChatModel(undefined, 'high').reasoning).toBe('high');
    // Alias legacy: xhigh → max → nearest sulla scala comune = high.
    expect(resolveChatModel(undefined, 'xhigh').reasoning).toBe('high');
    expect(resolveChatModel(undefined, 'nonsense').reasoning).toBe('medium');
    expect(resolveChatModel(undefined, 'low').reasoning).toBe('low');
    // 'off' e 'max' non esistono sulla scala comune: pavimento e soffitto.
    expect(resolveChatModel(undefined, 'off').reasoning).toBe('low');
    expect(resolveChatModel(undefined, 'none').reasoning).toBe('low');
    expect(resolveChatModel(undefined, 'max').reasoning).toBe('high');
  });

  it('con immagini il turno NON scambia mai modello: il gateway è già multimodale per contratto', () => {
    // Anche un pick solo-testo (Claude) dichiara visione sul provider 'llm': il vecchio swap
    // verso Gemini è morto e l'etichetta del modello resta quella scelta.
    const m = resolveChatModel(PICK_2);
    expect(m.provider).toBe('llm');
    expect(m.modelId).toBe(PICK_2);
    expect(modelSeesImages(m)).toBe(true);
    expect(modelSeesImages(resolveChatModel(undefined))).toBe(true);
  });

  it('le clip passano solo su un pick google/gemini-*, e lo dice prima di partire', () => {
    expect(modelSeesVideo(resolveChatModel(undefined))).toBe(true); // default Gemini sul gateway
    expect(modelSeesVideo(resolveChatModel(PICK_2))).toBe(false); // Claude: no video
    // Un default non-Gemini chiude anche lì: niente turno finto sulla clip mai vista.
    env.LLM_DEFAULT_MODEL = 'openai/gpt-5-mini';
    env.LLM_MODELS = 'openai/gpt-5-mini,anthropic/claude-sonnet-4';
    expect(modelSeesVideo(resolveChatModel(undefined))).toBe(false);
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

  /**
   * Il classificatore NON sceglie piu` il modello: l'escalation Auto→Pro e` morta coi preset,
   * e non c'e` piu` un "Pro" su cui scalare. Resta perche' l'harness lo usa per decidere quali
   * strumenti mettere sul tavolo — un incarico di produzione e una domanda non chiedono gli
   * stessi. Questo test e` la guardia contro il ritorno della scalata silenziosa.
   */
  it('una richiesta pesante non cambia piu\' il modello di nascosto', () => {
    const heavy = resolveChatModel(undefined, undefined, {});
    expect(heavy.modelId).toBe(PICK_1);
    expect(heavy.tier).toBe(null);
  });
});

describe('la preferenza salvata su thread e agente custom (0225)', () => {
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    setLlmEnv();
  });

  /**
   * La policy degli agenti di sistema e` stata eliminata con i preset: lo spec motion non impone
   * piu` la sua famiglia. Resta la riga SALVATA — quella del thread o dell'agente custom — che
   * governa il pensiero, mentre il modello resta quello risolto.
   */
  it('il pensiero salvato governa, e lo spec dell\'agente non ha piu\' voce', () => {
    const m = resolveChatModel(undefined, undefined, {
      agentId: 'motion',
      model: { family: 'grok', thinking: 'low' }
    });
    expect(m.reasoning).toBe('low');
    expect(m.modelId).toBe(PICK_1);
  });

  it('la famiglia salvata imposta il VOCABOLARIO: DeepSeek concede off dove Luna lo collassa', () => {
    const off = resolveChatModel('deepseek-pro', undefined, {
      model: { family: 'deepseek-pro', thinking: 'off' }
    });
    expect(off.reasoning).toBe('off'); // DeepSeek ha l'off vero

    // Senza scelta la scala comune mette il pavimento: non ha un off.
    const common = resolveChatModel(undefined, undefined, { model: { family: 'luna', thinking: 'off' } });
    expect(common.reasoning).toBe('low');
  });

  it('una riga sporca non cambia nulla: default, e pensiero di default', () => {
    const m = resolveChatModel(undefined, undefined, { model: { family: 'pippo' } });
    expect(m.modelId).toBe(PICK_1);
    expect(m.reasoning).toBe('medium');
  });

  it('un id esplicito vince sulla riga salvata', () => {
    const m = resolveChatModel(PICK_2, undefined, { model: { family: 'luna', thinking: 'low' } });
    expect(m.modelId).toBe(PICK_2);
  });

  it('il giro completo: un id salvato sul thread torna come tier e riacquista il suo modello', () => {
    const row = policyForChoice(PICK_2, 'high');
    expect(choiceForPolicy(row)?.tier).toBe(PICK_2);
    const m = resolveChatModel(choiceForPolicy(row)?.tier);
    expect(m.modelId).toBe(PICK_2);
    expect(m.provider).toBe('llm');
  });

  it('salvare "nessuna scelta" produce null: il thread torna al default', () => {
    expect(policyForChoice(null, 'high')).toBeNull();
    expect(resolveChatModel(undefined).modelId).toBe(PICK_1);
  });
});

/**
 * RE-TARGET DEL VECCHIO «il turno non è muto finché non ha finito» (eval 24/8). Quel silenzio era
 * la Responses di kie senza `reasoningSummary`, e il rimedio viveva nei callOptions di Terra/Sol/
 * Luna/Grok: tutto rimosso con il gateway. Oggi i pick Terra e Sol attraversano solo
 * llmModelForPicker, e nessun turno porta callOptions speciali.
 */
describe('il turno non è muto finché non ha finito', () => {
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    setLlmEnv();
  });

  /**
   * Terra e Sol restano etichette valide (ci sono thread che le hanno salvate), ma nessuna delle
   * due sale piu` al SECONDO id di LLM_MODELS: quel salto era la meccanica del preset Pro, e
   * sceglieva un modello per posizione in una lista.
   */
  it('Terra e Sol restano etichette, e risolvono sul default', () => {
    for (const tier of ['gpt-terra', 'gpt-sol'] as const) {
      const m = resolveChatModel(tier);
      expect(m.modelId).toBe(PICK_1);
      expect(m.provider).toBe('llm');
      expect(m.tier).toBe(tier);
    }
  });

  it('nessun trucco per far parlare prima il modello: niente reasoningSummary né temperature', () => {
    for (const tier of [undefined, 'gpt-terra', 'gpt-sol'] as const) {
      const opts = resolveChatModel(tier).callOptions;
      expect(opts).toEqual({ maxOutputTokens: HARNESS_MAX_OUTPUT_TOKENS });
      expect('temperature' in opts).toBe(false);
      expect('providerOptions' in opts).toBe(false);
    }
  });
});
