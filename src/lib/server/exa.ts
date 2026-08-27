// Exa — standalone GEO citation engine (docs.exa.ai). Separate from GPT/Grok/Claude: those use
// their own web_search via kie, not Exa. /answer returns a synthesized answer + web citations.
import { env } from '$env/dynamic/private';
import { logAiCall } from '$lib/server/ai-log';

export const exaConfigured = () => !!env.EXA_API_KEY;

// Exa /answer list price: $5/1k requests (exa.ai/pricing, verified 2026-07). Logged to
// ai_calls so GEO audits bill the brand's credits (brand_id via withBrandContext).
const EXA_ANSWER_COST_USD = 0.005;
const EXA_MODEL = 'exa-answer';

// Exa rate-limits bursts with a 429, and it rejects FAST (~200ms, measured in ai_calls) rather
// than queueing. In groundedText Exa is now a fallback behind Google grounding and DeepSeek, so a
// 429 here means the chain has already spent its earlier links and is about to come back empty.
// Two short retries cost well under a second of latency and are the difference between a cited
// answer and none.
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_BACKOFF_MS = [400, 1200];

async function fetchWithRateLimitRetry(key: string, query: string): Promise<Response> {
  let res!: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch('https://api.exa.ai/answer', {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000)
    });
    if (res.status !== 429 || attempt >= RATE_LIMIT_RETRIES) return res;
    // Honour Retry-After when Exa sends one, but never sleep longer than our own backoff — a
    // long server-suggested wait is worse than just paying for the Gemini fallback.
    const retryAfter = Number(res.headers.get('retry-after'));
    const suggested = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
    const delay = Math.min(suggested || RATE_LIMIT_BACKOFF_MS[attempt], RATE_LIMIT_BACKOFF_MS[attempt]);
    await new Promise((r) => setTimeout(r, delay));
  }
}

// Grounded answer to a query. Returns the same shape as research.ts groundedText so it's a drop-in
// for the GEO probe. Best-effort: empty on any failure or when the key isn't set.
export async function exaGroundedAnswer(query: string): Promise<{ text: string; citations: Array<{ uri: string; title: string }> }> {
  const key = env.EXA_API_KEY;
  if (!key) return { text: '', citations: [] };
  const t0 = Date.now();
  try {
    const res = await fetchWithRateLimitRetry(key, query);
    logAiCall({
      label: 'exaAnswer',
      provider: 'exa',
      model: EXA_MODEL,
      prompt: query,
      ms: Date.now() - t0,
      ok: res.ok,
      error: res.ok ? undefined : `HTTP ${res.status}`,
      groundingQueries: res.ok ? 1 : undefined,
      flatCostUsd: EXA_ANSWER_COST_USD
    });
    if (!res.ok) return { text: '', citations: [] };
    const data = await res.json();
    // answer is a string by default (no outputSchema); citations carry the source URLs.
    const text = typeof data?.answer === 'string' ? data.answer : '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const citations = (Array.isArray(data?.citations) ? data.citations : [])
      .map((c: any) => ({ uri: String(c?.url ?? ''), title: String(c?.title ?? c?.url ?? '') }))
      .filter((c: { uri: string }) => c.uri);
    return { text, citations };
  } catch (e) {
    logAiCall({
      label: 'exaAnswer',
      provider: 'exa',
      model: EXA_MODEL,
      prompt: query,
      ms: Date.now() - t0,
      ok: false,
      error: e instanceof Error ? e.message : 'exa answer failed'
    });
    return { text: '', citations: [] };
  }
}
