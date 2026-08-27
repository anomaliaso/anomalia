/**
 * DeepSeek web search — the cheapest grounding provider in the chain.
 *
 * DELIBERATELY SEPARATE from deepseek.ts. That module speaks DeepSeek's OpenAI-compatible wire
 * format; the web-search tool only exists on the ANTHROPIC-compatible endpoint, which differs in
 * auth header, response shape (content blocks instead of choices) and token accounting. Keeping
 * the two protocols in one file would mean every reader of deepseek.ts having to know which of
 * two dialects a given function speaks.
 *
 * WHY IT LEADS THE FALLBACKS: groundedText answers on Google grounding first (source quality
 * decides the order), and this is the first link tried when Google comes back empty or errors.
 * Measured live, a grounded answer here costs ~$0.0006 for a simple question and ~$0.004 for a
 * hard one (6 searches, 38 sources, a full comparison table), against ~$0.005 (Exa), ~$0.008
 * (Tavily) and ~$0.07 (Gemini + Google grounding). It is also the only provider that keeps
 * searching until the question is actually covered instead of returning one shot at it, which is
 * what makes it the right first fallback rather than merely the cheapest.
 *
 * CAVEAT, on purpose in the source: this capability is documented only on DeepSeek's Claude Code
 * integration page — the API reference sidebar has no "Web Search" entry. It is verified working
 * (2026-08-04) but it is not a contract. That is exactly why it is a link in a fallback chain and
 * never a hard dependency: if it stops answering, Exa/Tavily/Gemini still do.
 */
import { DEEPSEEK_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import { env } from '$env/dynamic/private';
import { logAiCall } from '$lib/server/ai-log';
import { DEEPSEEK_MODEL, deepseekAlive, noteDeepseekFailure } from '$lib/server/deepseek';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

// `deepseekAlive()` e non `!!env.DEEPSEEK_API_KEY`: la chiave presente non vuol dire chiave con
// credito. Chi legge questo booleano non sta solo scegliendo un fallback — geo.ts ci registra
// DeepSeek come MOTORE DI RISPOSTA misurato, e una chiave morta non costava una chiamata sprecata:
// scriveva "il brand non è citato su DeepSeek" su un motore che non abbiamo mai raggiunto.
export const deepseekSearchConfigured = (): boolean =>
  deepseekAlive() && env.DEEPSEEK_WEB_SEARCH !== 'off';

// How many searches the model may run for one question. This is the point of using a MODEL for
// grounding instead of a search API: it reads what came back, notices what is missing, and
// searches again — so a multi-part question ("what is X and what does it cost") resolves in one
// call instead of returning half an answer. Observed to be a soft guide rather than a hard cap
// (max_uses 3 produced 4 requests), which is fine: the ceiling exists to bound cost, and every
// extra search is a few hundred cheap tokens.
const MAX_SEARCHES = Number(env.DEEPSEEK_WEB_SEARCH_MAX_USES ?? 5);

// Searching several times then writing a cited answer needs real output room. The first live test
// stopped at `max_tokens` with 800 and returned a truncated answer, which the chain would have
// read as a usable result — worse than an empty one, because it would not have fallen through.
const MAX_OUTPUT_TOKENS = DEEPSEEK_MAX_OUTPUT_TOKENS;

// Multiple rounds of search + synthesis; well above the 30s a single search API needs.
const TIMEOUT_MS = 120_000;

const SYSTEM = [
  'You answer questions using live web search.',
  // Spelled out because the whole cost advantage rests on it doing this by itself.
  `Search as many times as the question needs (up to ${MAX_SEARCHES}). After each search, check what is still missing or unconfirmed and search again for exactly that — a second, narrower query is expected, not a fallback. Prefer primary sources (official docs, the vendor's own pages) over aggregators.`,
  'Then write a direct, factual answer in prose. State figures and dates explicitly.',
  'If the web results do not actually answer the question, say so plainly instead of guessing.'
].join('\n');

/**
 * Grounded answer to a query. Returns the same { text, citations } shape as exa.ts and tavily.ts so
 * groundedText() can try providers in order without knowing which one answered.
 *
 * Best-effort: returns empty text on ANY failure (no key, HTTP error, timeout, truncated output).
 * Empty is the chain's signal to try the next provider, so this must never throw.
 */
export async function deepseekGroundedAnswer(
  query: string
): Promise<{ text: string; citations: Array<{ uri: string; title: string }> }> {
  const key = env.DEEPSEEK_API_KEY;
  if (!deepseekAlive()) return { text: '', citations: [] };
  const base = env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const t0 = Date.now();

  try {
    const res = await fetch(`${base}/anthropic/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }],
        messages: [{ role: 'user', content: query }]
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    const body = (await res.json()) as AnyRec;
    const blocks: AnyRec[] = Array.isArray(body?.content) ? body.content : [];
    const usage = (body?.usage ?? {}) as AnyRec;
    const searches = Number(usage?.server_tool_use?.web_search_requests ?? 0) || 0;

    // The prose lives in `text` blocks; `thinking` and the tool blocks are scaffolding.
    const text = blocks
      .filter((b) => b?.type === 'text' && typeof b?.text === 'string')
      .map((b) => b.text as string)
      .join('\n')
      .trim();

    // Sources come back inside each web_search_tool_result block. An errored search yields a
    // block with `error_code` and no url, hence the filter.
    const citations: Array<{ uri: string; title: string }> = [];
    const seen = new Set<string>();
    for (const b of blocks) {
      if (b?.type !== 'web_search_tool_result' || !Array.isArray(b.content)) continue;
      for (const r of b.content as AnyRec[]) {
        const uri = String(r?.url ?? '');
        if (!uri || seen.has(uri)) continue;
        seen.add(uri);
        citations.push({ uri, title: String(r?.title ?? uri) });
      }
    }

    // A `max_tokens` stop means the answer was cut mid-sentence. Treat it as a miss so the chain
    // moves on rather than grounding a research stage on half a paragraph.
    const truncated = body?.stop_reason === 'max_tokens';
    const ok = res.ok && !!text && !truncated;
    // 401/402 = la chiave non pagherà nemmeno la prossima: spegne DeepSeek per il processo.
    if (!res.ok) noteDeepseekFailure(res.status);

    // TOKEN ACCOUNTING — the Anthropic format differs from OpenAI's and getting this wrong
    // silently under-bills. Here `input_tokens` EXCLUDES cache reads (the two are disjoint),
    // whereas computeCostUsd expects cachedTokens to be a SUBSET of inputTokens. So the total
    // input is the sum, and cachedTokens is the cache-read part of it.
    const freshIn = Number(usage.input_tokens ?? 0) || 0;
    const cachedIn = Number(usage.cache_read_input_tokens ?? 0) || 0;

    logAiCall({
      label: 'deepseekSearch',
      provider: 'deepseek',
      model: DEEPSEEK_MODEL,
      prompt: query,
      ms: Date.now() - t0,
      ok,
      error: ok
        ? undefined
        : !res.ok
          ? `HTTP ${res.status}: ${JSON.stringify(body?.error ?? body).slice(0, 200)}`
          : truncated
            ? 'truncated at max_tokens'
            : 'no answer text',
      inputTokens: freshIn + cachedIn,
      cachedTokens: cachedIn,
      outputTokens: Number(usage.output_tokens ?? 0) || 0,
      // Not a billed fee we know of (DeepSeek documents only "additional token costs"), but worth
      // recording: it is how we would spot the model over-searching a simple question.
      groundingQueries: searches,
      context: `${searches} search(es)`
    });

    if (!ok) return { text: '', citations: [] };
    return { text, citations };
  } catch (e) {
    logAiCall({
      label: 'deepseekSearch',
      provider: 'deepseek',
      model: DEEPSEEK_MODEL,
      prompt: query,
      ms: Date.now() - t0,
      ok: false,
      error: e instanceof Error ? e.message : 'deepseek search failed'
    });
    return { text: '', citations: [] };
  }
}
