// Tavily — the SECOND web-grounding provider, sitting between Exa and Gemini's Google grounding.
//
// Why a second one at all: Exa rate-limits bursts with a 429 (measured: 49 of 241 calls over 14
// days, 44 of them in a single busy day). Every miss used to fall straight through to Gemini
// grounding at ~$0.07 a call — roughly 14x Exa. A second independent provider turns "Exa is
// throttled" into "use the other cheap one" instead of "pay the expensive one".
//
// /search with include_answer returns an LLM answer plus ranked sources, which is exactly the
// { text, citations } contract groundedText() is written against — same shape as exa.ts, so it is
// a drop-in link in the chain.
import { env } from '$env/dynamic/private';
import { logAiCall } from '$lib/server/ai-log';

export const tavilyConfigured = () => !!env.TAVILY_API_KEY;

// Tavily bills in credits: a basic search is 1 credit, advanced 2. On the pay-as-you-go tier a
// credit is $0.008 (tavily.com/#pricing). We ask for `basic` depth with an `advanced` answer —
// the answer quality is what this call is for, and basic depth keeps it at 1 credit.
// Logged to ai_calls so grounding spend bills the brand's credits like every other provider.
const TAVILY_SEARCH_COST_USD = 0.008;
const TAVILY_MODEL = 'tavily-search';

// Same burst problem Exa has, same cheap answer: a rate-limited request that is retried a moment
// later still costs far less than the Gemini fallback it would otherwise trigger.
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_BACKOFF_MS = [400, 1200];

async function searchWithRetry(key: string, query: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        include_answer: 'advanced',
        max_results: 5
      }),
      signal: AbortSignal.timeout(30_000)
    });
    if (res.status !== 429 || attempt >= RATE_LIMIT_RETRIES) return res;
    const retryAfter = Number(res.headers.get('retry-after'));
    const suggested = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
    await new Promise((r) => setTimeout(r, Math.min(suggested || RATE_LIMIT_BACKOFF_MS[attempt], RATE_LIMIT_BACKOFF_MS[attempt])));
  }
}

/**
 * Grounded answer to a query. Returns the same shape as exa.ts / research.ts groundedText, so the
 * chain can try providers in order without any caller knowing which one answered.
 * Best-effort: empty on any failure or when the key isn't set — an empty result is the signal the
 * caller uses to move to the next provider, so failures must never throw.
 */
export async function tavilyGroundedAnswer(
  query: string
): Promise<{ text: string; citations: Array<{ uri: string; title: string }> }> {
  const key = env.TAVILY_API_KEY;
  if (!key) return { text: '', citations: [] };
  const t0 = Date.now();
  try {
    const res = await searchWithRetry(key, query);
    logAiCall({
      label: 'tavilySearch',
      provider: 'tavily',
      model: TAVILY_MODEL,
      prompt: query,
      ms: Date.now() - t0,
      ok: res.ok,
      error: res.ok ? undefined : `HTTP ${res.status}`,
      groundingQueries: res.ok ? 1 : undefined,
      flatCostUsd: TAVILY_SEARCH_COST_USD
    });
    if (!res.ok) return { text: '', citations: [] };
    const data = await res.json();
    // `answer` is present only because we asked for include_answer; without it there is no prose
    // and the caller must fall through rather than publish a bare link list.
    const text = typeof data?.answer === 'string' ? data.answer : '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const citations = (Array.isArray(data?.results) ? data.results : [])
      .map((r: any) => ({ uri: String(r?.url ?? ''), title: String(r?.title ?? r?.url ?? '') }))
      .filter((c: { uri: string }) => c.uri);
    return { text, citations };
  } catch (e) {
    logAiCall({
      label: 'tavilySearch',
      provider: 'tavily',
      model: TAVILY_MODEL,
      prompt: query,
      ms: Date.now() - t0,
      ok: false,
      error: e instanceof Error ? e.message : 'tavily search failed'
    });
    return { text: '', citations: [] };
  }
}
