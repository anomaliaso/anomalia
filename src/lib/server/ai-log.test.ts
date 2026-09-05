import { describe, it, expect } from 'vitest';
import { billedUsdInScope, computeCostUsd, extractSdkUsage, noteLlmCost, takeLlmCost, withBrandContext } from './ai-log';
import { GEMINI_FLASH, NANO_BANANA_PRO } from './gemini';

const GO = 'go';

// The two image-call expectations are real billed receipts from live Nano Banana Pro calls
// (2026-07-13): usageMetadata captured via the API, cost cross-checked against the official
// price list ($2/M in, $12/M thinking, $120/M image out → 1120 tok = $0.134/image ≤2K).
describe('computeCostUsd', () => {
  /**
   * `null` voleva dire DUE cose incompatibili: "esente, non addebitare" e "non siamo riusciti a
   * prezzarla". `credits.ts` somma solo le righe non nulle, quindi il secondo significato non era
   * prudente — era GRATIS, in silenzio. Misurato in produzione: 62 righe riuscite e 6.099.353
   * token fatturati a nessuno in 30 giorni, il 53% negli ultimi 7.
   *
   * Dopo: `0` è l'esenzione (un fatto), `null` è solo il buco (un guasto interrogabile).
   */
  it('una chiamata riuscita senza prezzo non vale quanto una esente', () => {
    const esente = computeCostUsd({ label: 'read_file', provider: 'internal', ms: 1, ok: true });
    const ignoto = computeCostUsd({
      label: 'chat', provider: 'llm', model: 'un/modello-che-nessuno-ha-prezzato',
      ms: 1200, ok: true, inputTokens: 40_000, outputTokens: 8_000
    });
    expect(esente).toBe(0);
    expect(ignoto).toBeNull();
  });

  it('l’esenzione non tocca i crediti: zero non sposta una somma', () => {
    expect(computeCostUsd({ label: 'grep', provider: 'internal', ms: 1, ok: true })).toBe(0);
    // Anche con dei token addosso: `internal` è un evento dell'agente, non una chiamata a un modello.
    expect(
      computeCostUsd({ label: 'db_query', provider: 'internal', ms: 1, ok: true, inputTokens: 900, outputTokens: 100 })
    ).toBe(0);
  });

  it('una fallita resta null: `ok` la disambigua già, e forzarla a zero la farebbe contare', () => {
    // Portare i fallimenti a 0 li renderebbe visibili al tetto orario della chat, che oggi
    // scarta le righe nulle. `ok=false` dice già "non fatturata" senza aiuto.
    expect(computeCostUsd({ label: 'chat', provider: 'kie', ms: 5, ok: false, flatCostUsd: 0.02 })).toBeNull();
  });

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

  /**
   * MISURATO sul database, non dedotto: 54 righe `llm/z-ai/glm-5.3-flash` con zero costo accanto a
   * 181 righe dello STESSO modello, prezzate, sotto l'id nudo. Il prefisso lo mette il bridge
   * (`adapters.ts`), la normalizzazione ne toglieva uno solo, e il tier che scrive le composizioni
   * motion smetteva di toccare i crediti passando dall'harness.
   */
  it('prezza lo stesso modello anche sotto il prefisso `llm/` del bridge', () => {
    const usage = { label: 'chat', ms: 0, ok: true, inputTokens: 1_000_000, outputTokens: 1_000_000 };
    expect(computeCostUsd({ ...usage, provider: 'llm', model: 'llm/z-ai/glm-5.3-flash' })).toBeCloseTo(0.325, 4);
  });

  /**
   * MISURATO su produzione, 30 giorni: 4 righe `kie/gpt-5-6-luna` e 10 `google/gemini-embedding-001`
   * riuscite, con i token contati, e senza costo — perché le RATES tengono quegli id NUDI e la
   * normalizzazione toglieva solo `openrouter/` e `llm/`. Ogni trasporto nuovo aggiungeva un
   * prefisso e un buco: la regola ora è una sola, l'ULTIMO segmento, e vale anche per il prossimo.
   */
  it('prezza un modello sotto il prefisso di QUALUNQUE trasporto', () => {
    const usage = { label: 'chat', ms: 0, ok: true, inputTokens: 1_000_000, outputTokens: 0 };
    expect(computeCostUsd({ ...usage, provider: 'kie', model: 'kie/gpt-5-6-luna' })).toBeCloseTo(0.056, 4);
    expect(computeCostUsd({ ...usage, provider: 'llm', model: 'google/gemini-embedding-001' })).toBeCloseTo(0.15, 4);
  });

  /** Un id che somiglia a uno noto non è quello noto: `-vision-exp` è un altro modello. */
  it('non spaccia per noto un modello diverso che finisce in modo simile', () => {
    expect(
      computeCostUsd({
        label: 'chat', provider: 'llm', model: 'vendor/deepseek-v4-flash-vision-exp',
        ms: 0, ok: true, inputTokens: 10, outputTokens: 10
      })
    ).toBeNull();
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

  it('returns null when usage is missing or the model has no price list', () => {
    expect(computeCostUsd({ label: 'x', provider: 'gemini', ms: 0, ok: false })).toBeNull();
    expect(computeCostUsd({ label: 'x', provider: 'gemini', model: 'lyria-3-clip-preview', ms: 0, ok: true, inputTokens: 10, outputTokens: 10 })).toBeNull();
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


/**
 * Un turno di chat non è UNA chiamata: ogni passo con i tool ne è una, e ognuna ha la sua
 * generazione fatturata. La riga aggregata che si scrive alla fine deve poterle sommare tutte,
 * quindi gli id si accumulano nello scope come già fanno i crediti kie.
 */
describe('fatture del gateway nello scope', () => {
  it('somma i passi del turno e li consegna una volta sola', async () => {
    await withBrandContext('brand-1', async () => {
      noteLlmCost(0.001);
      noteLlmCost(0.002);
      expect(takeLlmCost()).toBeCloseTo(0.003, 10);
      expect(takeLlmCost()).toBeUndefined();
    });
  });

  it('due turni paralleli non si mescolano i costi', async () => {
    await Promise.all([
      withBrandContext('brand-1', async () => {
        noteLlmCost(1);
        await new Promise((r) => setTimeout(r, 5));
        expect(takeLlmCost()).toBe(1);
      }),
      withBrandContext('brand-2', async () => {
        noteLlmCost(2);
        await new Promise((r) => setTimeout(r, 5));
        expect(takeLlmCost()).toBe(2);
      })
    ]);
  });

  it('fuori da uno scope non esplode e non ricorda nulla', () => {
    noteLlmCost(5);
    expect(takeLlmCost()).toBeUndefined();
  });

  it('quello che e` stato ritirato resta leggibile: e` il numero scritto nella riga', async () => {
    await withBrandContext('brand-1', async () => {
      expect(billedUsdInScope()).toBeUndefined();

      noteLlmCost(0.004);
      expect(takeLlmCost()).toBeCloseTo(0.004, 10);

      expect(billedUsdInScope()).toBeCloseTo(0.004, 10);
    });
  });

  it('somma le fatture di piu` chiamate nello stesso scope', async () => {
    await withBrandContext('brand-1', async () => {
      noteLlmCost(0.001);
      takeLlmCost();
      noteLlmCost(0.002);
      takeLlmCost();

      expect(billedUsdInScope()).toBeCloseTo(0.003, 10);
    });
  });

  it('senza fattura del gateway non inventa uno zero: resta sconosciuto', async () => {
    await withBrandContext('brand-1', async () => {
      takeLlmCost();
      expect(billedUsdInScope()).toBeUndefined();
    });
  });
});
