import { describe, it, expect } from 'vitest';
import { computeCostUsd, extractGeminiUsage, extractSdkUsage, extractXiaomiUsage, withBrandContext } from './ai-log';
import { GEMINI_FLASH, NANO_BANANA_PRO } from './gemini';

const GO = 'go';

// The two image-call expectations are real billed receipts from live Nano Banana Pro calls
// (2026-07-13): usageMetadata captured via the API, cost cross-checked against the official
// price list ($2/M in, $12/M thinking, $120/M image out → 1120 tok = $0.134/image ≤2K).
describe('computeCostUsd', () => {
  /**
   * I turni openrouter arrivavano con `cost_usd` NULL — 25 chiamate in tre giorni, zero
   * addebitate — perche` nessuna tariffa portava il loro id. Spostarci il traffico principale
   * senza questo avrebbe smesso di misurare l'agente piu` caro del prodotto.
   */
  it('prezza glm-5.3-flash su openrouter, con e senza il prefisso del provider nell’id', () => {
    const usage = { label: 'motion-video', ms: 0, ok: true, inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const bare = computeCostUsd({ ...usage, provider: 'openrouter', model: 'z-ai/glm-5.3-flash' });
    const prefixed = computeCostUsd({ ...usage, provider: 'openrouter', model: 'openrouter/z-ai/glm-5.3-flash' });
    // $0.075/M input + $0.25/M output
    expect(bare).toBeCloseTo(0.325, 4);
    expect(prefixed).toBeCloseTo(0.325, 4);
  });

  it('un modello openrouter senza tariffa resta null: meglio non misurato che misurato a caso', () => {
    expect(
      computeCostUsd({ label: 'chat', provider: 'openrouter', model: 'openrouter/qualcosa/mai-visto', ms: 0, ok: true, inputTokens: 10, outputTokens: 10 })
    ).toBeNull();
  });

  it('prices a Nano Banana Pro render (text-only prompt) at the Go share', () => {
    const cost = computeCostUsd({
      label: 'renderImage', provider: 'gemini', model: NANO_BANANA_PRO, ms: 0, ok: true,
      inputTokens: 35, outputTokens: 1229, thinkingTokens: 156, imageOutputTokens: 1120
    }, GO);
    // List: 35×2 + 156×12 + 109×12 + 1120×120 (per 1M) = $0.13765, billed in full
    expect(cost).toBeCloseTo(0.13765, 4);
  });

  it('prices a render with 2 reference images attached (refs land in inputTokens)', () => {
    const cost = computeCostUsd({
      label: 'renderImage', provider: 'gemini', model: NANO_BANANA_PRO, ms: 0, ok: true,
      inputTokens: 539, outputTokens: 1252, thinkingTokens: 128, imageOutputTokens: 1120
    }, GO);
    // List: 539×2 + 128×12 + 132×12 + 1120×120 (per 1M) = $0.138598, billed in full
    expect(cost).toBeCloseTo(0.1386, 4);
  });

  it('leaves Nano Banana 2 at full list regardless of plan', () => {
    const entry = {
      label: 'renderImage', provider: 'gemini' as const, model: 'gemini-3.1-flash-image', ms: 0, ok: true,
      inputTokens: 1000, outputTokens: 1120, imageOutputTokens: 1120
    };
    // (1000×0.5 + 1120×60)/1M = $0.0677
    expect(computeCostUsd(entry)).toBeCloseTo(0.0677, 4);
    expect(computeCostUsd(entry, 'pro')).toBeCloseTo(0.0677, 4);
    expect(computeCostUsd(entry, null)).toBeCloseTo(0.0677, 4);
  });

  it('prices a Flash call with cache discount, defaulting a missing model to Flash', () => {
    const cost = computeCostUsd({
      label: 'director', provider: 'gemini', ms: 0, ok: true,
      inputTokens: 17516, outputTokens: 219, cachedTokens: 5174, thinkingTokens: 2010
    });
    // List (17516−5174)×1.5 + 5174×0.15 + (219+2010)×7.5 (per 1M) = $0.036007
    // No plan → still full list: the plan has not changed the price since 2026-08.
    expect(cost).toBeCloseTo(0.036007, 5);
  });

  it('adds the grounding fee ($14/1k queries) on top of token cost', () => {
    const base = { label: 'grounded', provider: 'gemini' as const, model: GEMINI_FLASH, ms: 0, ok: true, inputTokens: 1000, outputTokens: 1000 };
    const without = computeCostUsd(base)!;
    const withFee = computeCostUsd({ ...base, groundingQueries: 3 })!;
    expect(withFee - without).toBeCloseTo(0.042, 6); // 3 × $0.014 list, billed in full
  });

  it('still prices historical gemini-3.6-flash rows at the Flash rate', () => {
    const legacy = computeCostUsd({
      label: 'grounded', provider: 'gemini', model: 'gemini-3.6-flash', ms: 0, ok: true,
      inputTokens: 1000, outputTokens: 1000
    });
    const current = computeCostUsd({
      label: 'grounded', provider: 'gemini', model: GEMINI_FLASH, ms: 0, ok: true,
      inputTokens: 1000, outputTokens: 1000
    });
    expect(legacy).not.toBeNull();
    expect(legacy).toBeCloseTo(current!, 6);
  });

  it('prices an unknown Flash id at the current Flash rate so a live GEMINI_FLASH bump still bills', () => {
    const unknown = computeCostUsd({
      label: 'grounded', provider: 'gemini', model: 'gemini-3.8-flash', ms: 0, ok: true,
      inputTokens: 1000, outputTokens: 1000
    });
    const current = computeCostUsd({
      label: 'grounded', provider: 'gemini', model: GEMINI_FLASH, ms: 0, ok: true,
      inputTokens: 1000, outputTokens: 1000
    });
    expect(unknown).not.toBeNull();
    expect(unknown).toBeCloseTo(current!, 6);
  });

  it('keeps gemini-3.1-flash-image on its own image rate, not text Flash', () => {
    const image = computeCostUsd({
      label: 'renderImage', provider: 'gemini', model: 'gemini-3.1-flash-image', ms: 0, ok: true,
      inputTokens: 1000, outputTokens: 1120, imageOutputTokens: 1120
    });
    const flash = computeCostUsd({
      label: 'grounded', provider: 'gemini', model: GEMINI_FLASH, ms: 0, ok: true,
      inputTokens: 1000, outputTokens: 1120
    });
    expect(image).not.toBeNull();
    expect(flash).not.toBeNull();
    expect(image).not.toBeCloseTo(flash!, 4);
  });

  // Flash and Nano Banana Pro carried a per-plan discount (free 75% … pro 27%) until 2026-08.
  // They no longer do: the plan is passed but MUST NOT move the number. Every plan below is
  // asserted on purpose — a fraction reappearing on any one of them is lost revenue.
  it('bills Flash and Nano Banana Pro at 100% of list on every plan', () => {
    const flashEntry = {
      label: 'grounded', provider: 'gemini' as const, model: GEMINI_FLASH, ms: 0, ok: true,
      inputTokens: 1000, outputTokens: 1000
    };
    const stillEntry = {
      label: 'renderImage', provider: 'gemini' as const, model: NANO_BANANA_PRO, ms: 0, ok: true,
      inputTokens: 539, outputTokens: 1252, thinkingTokens: 128, imageOutputTokens: 1120
    };
    // List Flash: (1000×1.5 + 1000×7.5)/1M = $0.009
    for (const plan of [null, 'go', 'starter', 'pro', 'scale']) {
      expect(computeCostUsd(flashEntry, plan)).toBeCloseTo(0.009, 6);
      // Same full price for Nano Banana Pro (list $0.1386)
      expect(computeCostUsd(stillEntry, plan)).toBeCloseTo(0.1386, 4);
    }
  });

  it('reads the plan from withBrandContext when computeCostUsd is not passed one', () => {
    const cost = withBrandContext(
      'brand-1',
      () =>
        computeCostUsd({
          label: 'grounded',
          provider: 'gemini',
          model: GEMINI_FLASH,
          ms: 0,
          ok: true,
          inputTokens: 1000,
          outputTokens: 1000
        }),
      'starter'
    );
    expect(cost).toBeCloseTo(0.009, 6); // full list, whatever the plan in context says
  });

  // Real billed receipt from a live mimo-v2.5-pro call with web_search (2026-07-13):
  // prompt 3638 (192 cached), completion 688 (reasoning 673 is a SUBSET — must not be re-priced),
  // web_search_usage.tool_usage 3 → 3 × $0.005 Internet Connectivity fee.
  it('prices a MiMo pro call with search fee, without double-counting reasoning', () => {
    const cost = computeCostUsd({
      label: 'grounded', provider: 'xiaomi', model: 'mimo-v2.5-pro', ms: 0, ok: true,
      inputTokens: 3638, outputTokens: 688, cachedTokens: 192, thinkingTokens: 673, groundingQueries: 3
    });
    // (3446×0.435 + 192×0.0036 + 688×0.87)/1M + 3×0.005 = $0.017098
    expect(cost).toBeCloseTo(0.017098, 5);
  });

  it('prices a MiMo ultraspeed call (live receipt: 257 in / 128 cached / 20 out)', () => {
    const cost = computeCostUsd({
      label: 'text', provider: 'xiaomi', model: 'mimo-v2.5-pro-ultraspeed', ms: 0, ok: true,
      inputTokens: 257, outputTokens: 20, cachedTokens: 128, thinkingTokens: 17
    });
    // (129×1.305 + 128×0.0108 + 20×2.61)/1M = $0.000222
    expect(cost).toBeCloseTo(0.000222, 6);
  });

  it('uses the flat per-request price for non-token providers, billing only successes', () => {
    expect(computeCostUsd({ label: 'scrape', provider: 'scrapecreators', ms: 0, ok: true, flatCostUsd: 0.002 })).toBe(0.002);
    expect(computeCostUsd({ label: 'exaAnswer', provider: 'exa', ms: 0, ok: true, flatCostUsd: 0.005 })).toBe(0.005);
    expect(computeCostUsd({ label: 'grokPlan', provider: 'kie', ms: 0, ok: true, flatCostUsd: 0.00015 })).toBe(0.00015);
    expect(computeCostUsd({ label: 'scrape', provider: 'scrapecreators', ms: 0, ok: false, flatCostUsd: 0.002 })).toBeNull();
  });

  it('una sandbox FALLITA si paga lo stesso: la VM è stata accesa comunque', () => {
    // Regola giusta per Tavily (non ci fattura una ricerca fallita), sbagliata per una microVM che
    // ha consumato tempo macchina: azzerare qui rendeva gratis il 32,1% dei secondi misurati, cioè
    // il percorso che costa di più era l'unico non addebitato — e l'invito a riprovare all'infinito.
    const failed = computeCostUsd({ label: 'sandbox.agent', provider: 'sandbox', model: 'agent', ms: 0, ok: false, flatCostUsd: 0.0064 });
    expect(failed).toBe(0.0064);
    expect(computeCostUsd({ label: 'sandbox.motion_render', provider: 'sandbox', ms: 0, ok: true, flatCostUsd: 0.0064 })).toBe(0.0064);
  });

  it('prices Grok 4.5 at Input $0.80 / Cached $0.20 / Output $2.40 per 1M', () => {
    const cost = computeCostUsd({
      label: 'chat', provider: 'kie', model: 'grok-4-5', ms: 0, ok: true,
      inputTokens: 10_000, outputTokens: 1_000, cachedTokens: 2_000
    });
    // (8000×0.8 + 2000×0.2 + 1000×2.4)/1M = $0.0092
    expect(cost).toBeCloseTo(0.0092, 6);
  });

  it('prices Grok 4.6 at the same kie Chat fallback as 4.5', () => {
    const cost = computeCostUsd({
      label: 'chat', provider: 'kie', model: 'grok-4-6', ms: 0, ok: true,
      inputTokens: 10_000, outputTokens: 1_000, cachedTokens: 2_000
    });
    expect(cost).toBeCloseTo(0.0092, 6);
  });

  it('prices DeepSeek V4 Pro at the peak rate: Input $1.32 / Cached $0.044 / Output $3.96 per 1M', () => {
    const cost = computeCostUsd({
      label: 'chat', provider: 'deepseek', model: 'deepseek-v4-pro', ms: 0, ok: true,
      inputTokens: 10_000, outputTokens: 1_000, cachedTokens: 2_000
    });
    // (8000×1.32 + 2000×0.044 + 1000×3.96)/1M = $0.014608
    // Tariffa PEAK, che è quella che teniamo: vedi il commento su RATES. I numeri di prima
    // (0.435/0.87) erano il listino vecchio, e questo test li ha tenuti in vita nel titolo per
    // mesi dopo che DeepSeek li aveva alzati — un test che pinna un prezzo è utile solo se
    // qualcuno rilegge il listino.
    expect(cost).toBeCloseTo(0.014608, 6);
  });

  it('prices GPT 5.6 Terra at Input $2 / Cached $0.20 / Output $12 per 1M', () => {
    const cost = computeCostUsd({
      label: 'chat', provider: 'kie', model: 'gpt-5-6-terra', ms: 0, ok: true,
      inputTokens: 10_000, outputTokens: 1_000, cachedTokens: 2_000
    });
    // (8000×2 + 2000×0.2 + 1000×12)/1M = $0.0284
    expect(cost).toBeCloseTo(0.0284, 6);
  });

  it('non muove un centesimo sulle forme inclusive: stesso usage estratto, stesso prezzo di prima della normalizzazione', () => {
    // Flash: (400k×1.5 + 600k×0.15 + 50k×7.5)/1M = $1.065 — la forma google/ai@7 inclusiva
    // non passa per nessuna ricomposizione: input entra com'è, cached sconta solo la sua quota.
    const cost = computeCostUsd({
      label: 'grounded', provider: 'gemini', model: GEMINI_FLASH, ms: 0, ok: true,
      ...extractSdkUsage({
        inputTokens: 1_000_000,
        inputTokenDetails: { noCacheTokens: 400_000, cacheReadTokens: 600_000 },
        outputTokens: 50_000,
        outputTokenDetails: { textTokens: 50_000 }
      })
    });
    expect(cost).toBeCloseTo(1.065, 6);
  });

  it('sulla forma pi/harness il costo torna quello vero: prima la clamp su cached lo schiacciava', () => {
    // grok-4-6 via harness: prompt vero 1M di cui 800k da cache, 50k out.
    // Prima: input=200k, cached=min(800k,200k)=200k → $0.16. Canone dopo il fix:
    // (200k×0.8 + 800k×0.2 + 50k×2.4)/1M = $0.44
    const cost = computeCostUsd({
      label: 'chat', provider: 'openrouter' as never, model: 'grok-4-6', ms: 0, ok: true,
      ...extractSdkUsage({
        inputTokens: 200_000,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: 800_000, cacheWriteTokens: 0 },
        outputTokens: 50_000
      })
    });
    expect(cost).toBeCloseTo(0.44, 6);
  });

  it('returns null when usage is missing or the model has no price list', () => {
    expect(computeCostUsd({ label: 'x', provider: 'gemini', ms: 0, ok: false })).toBeNull();
    expect(computeCostUsd({ label: 'x', provider: 'xiaomi', model: 'mimo-unknown', ms: 0, ok: true, inputTokens: 10, outputTokens: 10 })).toBeNull();
    expect(computeCostUsd({ label: 'x', provider: 'gemini', model: 'lyria-3-clip-preview', ms: 0, ok: true, inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
});

describe('extractXiaomiUsage', () => {
  it('extracts tokens, cached, reasoning and web_search_usage from a live-shaped response', () => {
    const usage = extractXiaomiUsage({
      usage: {
        prompt_tokens: 3638,
        completion_tokens: 688,
        total_tokens: 4326,
        prompt_tokens_details: { cached_tokens: 192 },
        completion_tokens_details: { reasoning_tokens: 673 },
        web_search_usage: { tool_usage: 3, page_usage: 6 }
      }
    });
    expect(usage).toMatchObject({ inputTokens: 3638, outputTokens: 688, cachedTokens: 192, thinkingTokens: 673, groundingQueries: 3 });
  });
});

describe('extractGeminiUsage', () => {
  it('splits IMAGE-modality output tokens out of the candidates count', () => {
    const usage = extractGeminiUsage({
      usageMetadata: {
        promptTokenCount: 539,
        candidatesTokenCount: 1252,
        thoughtsTokenCount: 128,
        promptTokensDetails: [{ modality: 'TEXT', tokenCount: 23 }, { modality: 'IMAGE', tokenCount: 516 }],
        candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }]
      }
    });
    expect(usage).toMatchObject({ inputTokens: 539, outputTokens: 1252, thinkingTokens: 128, imageOutputTokens: 1120 });
  });

  it('mappa cachedContentTokenCount → cachedTokens quando Gemini la manda (prompt è GIÀ il totale)', () => {
    const usage = extractGeminiUsage({
      usageMetadata: { promptTokenCount: 10_000, candidatesTokenCount: 500, cachedContentTokenCount: 8_000 }
    });
    expect(usage).toMatchObject({ inputTokens: 10_000, cachedTokens: 8_000 });
  });

  it('senza cachedContentTokenCount cached resta zero, mai undefined', () => {
    const usage = extractGeminiUsage({
      usageMetadata: { promptTokenCount: 10_000, candidatesTokenCount: 500 }
    });
    expect(usage).toMatchObject({ inputTokens: 10_000, cachedTokens: 0 });
  });
});

describe('extractSdkUsage', () => {
  // CANONE ai_calls: `input_tokens` = TOTALE input fatturato INCLUSI i token cachati;
  // `cached_tokens` = sottoinsieme servito dalla cache. hit% = cached/input è allora
  // confrontabile fra provider ed è sempre ≤ 100%.
  it('legge la forma ai@7: cache e ragionamento dentro inputTokenDetails/outputTokenDetails', () => {
    expect(
      extractSdkUsage({
        inputTokens: 1000,
        inputTokenDetails: { noCacheTokens: 400, cacheReadTokens: 600, cacheWriteTokens: 50 },
        outputTokens: 149,
        outputTokenDetails: { textTokens: 68, reasoningTokens: 81 },
        totalTokens: 1149
      })
    ).toEqual({ inputTokens: 1000, outputTokens: 149, cachedTokens: 600, thinkingTokens: 81 });
  });

  it('forma già inclusiva (@ai-sdk/google e openai-compatible mandano noCache sempre): input resta com\'è', () => {
    expect(
      extractSdkUsage({
        inputTokens: 700,
        inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 700, cacheWriteTokens: undefined },
        outputTokens: 30,
        outputTokenDetails: { textTokens: 30, reasoningTokens: undefined }
      })
    ).toEqual({ inputTokens: 700, outputTokens: 30, cachedTokens: 700, thinkingTokens: undefined });
  });

  it('forma pi/harness (kie/openrouter/opencode): il ponte manda input GIÀ netto della cache e niente noCache → il totale si ricompone sommando read e write', () => {
    // Esattamente l'oggetto che `asLanguageModelUsage` ricava dal ponte harness-pi:
    // pi-ai consegna input = prompt − cached − write, quindi cached/input dava hit% impossibili.
    expect(
      extractSdkUsage({
        inputTokens: 200_000,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: 800_000, cacheWriteTokens: 0 },
        outputTokens: 50_000,
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
        totalTokens: 1_050_000
      })
    ).toEqual({
      inputTokens: 1_000_000,
      outputTokens: 50_000,
      cachedTokens: 800_000,
      thinkingTokens: undefined
    });
  });

  it('forma pi/harness con zero di cache: nessuna inventata aggiunta al totale', () => {
    expect(
      extractSdkUsage({
        inputTokens: 500,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: 0, cacheWriteTokens: 0 }
      })
    ).toMatchObject({ inputTokens: 500 });
  });

  it('numeri piatti senza dettagli non vengono toccati: la regola non indovina, riconosce', () => {
    expect(extractSdkUsage({ inputTokens: 10, outputTokens: 5 })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: undefined,
      thinkingTokens: undefined
    });
  });

  it('ripiega sui nomi piatti pre-ai@7', () => {
    expect(
      extractSdkUsage({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 3, reasoningTokens: 2 })
    ).toEqual({ inputTokens: 10, outputTokens: 5, cachedTokens: 3, thinkingTokens: 2 });
  });

  it('usage assente o non numerico produce campi undefined, mai zeri inventati', () => {
    expect(extractSdkUsage(undefined)).toEqual({});
    expect(extractSdkUsage({ inputTokens: NaN })).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
      cachedTokens: undefined,
      thinkingTokens: undefined
    });
  });
});
