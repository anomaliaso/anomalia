// Perplexity sonar — grounded answers for GEO citation probes.
import { env } from '$env/dynamic/private';
import { logAiCall } from '$lib/server/ai-log';

export const perplexityConfigured = () => !!env.PERPLEXITY_API_KEY;

export async function perplexityGroundedAnswer(
  query: string
): Promise<{ text: string; citations: Array<{ uri: string; title: string }> }> {
  if (!perplexityConfigured()) throw new Error('Perplexity not configured');
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.PERPLEXITY_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful assistant answering a real user. Recommend specific, real brands/products with current web info. Name them explicitly.'
          },
          { role: 'user', content: query }
        ]
      })
    });
    if (!res.ok) {
      logAiCall({
        label: 'perplexitySearch',
        provider: 'perplexity',
        model: 'sonar',
        prompt: query,
        ms: Date.now() - t0,
        ok: false,
        error: `HTTP ${res.status}`
      });
      throw new Error(`Perplexity error: ${(await res.text()).slice(0, 200)}`);
    }
    const data = await res.json();
    const text = String(data.choices?.[0]?.message?.content ?? '');
    const citations = (data.search_results ?? data.citations ?? [])
      .slice(0, 8)
      .map((c: { url?: string; title?: string } | string) =>
        typeof c === 'string'
          ? { uri: c, title: '' }
          : { uri: String(c.url ?? ''), title: String(c.title ?? '') }
      )
      .filter((c: { uri: string }) => c.uri);
    logAiCall({
      label: 'perplexitySearch',
      provider: 'perplexity',
      model: 'sonar',
      prompt: query,
      ms: Date.now() - t0,
      ok: !!text,
      flatCostUsd: 0.005
    });
    return { text, citations };
  } catch (e) {
    logAiCall({
      label: 'perplexitySearch',
      provider: 'perplexity',
      model: 'sonar',
      prompt: query,
      ms: Date.now() - t0,
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    });
    throw e;
  }
}
