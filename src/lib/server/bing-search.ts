// Bing Web Search → grounded answer for GEO “Copilot-style” visibility probes.
import { env } from '$env/dynamic/private';
import { llmText } from '$lib/server/llm';
import { logAiCall } from '$lib/server/ai-log';

export const bingConfigured = () => !!env.BING_SEARCH_API_KEY;

export async function bingGroundedAnswer(
  query: string
): Promise<{ text: string; citations: Array<{ uri: string; title: string }> }> {
  if (!bingConfigured()) throw new Error('Bing Search not configured');
  const t0 = Date.now();
  try {
    const u = new URL('https://api.bing.microsoft.com/v7.0/search');
    u.searchParams.set('q', query.slice(0, 200));
    u.searchParams.set('count', '8');
    u.searchParams.set('mkt', 'en-US');
    const res = await fetch(u.toString(), {
      headers: { 'Ocp-Apim-Subscription-Key': env.BING_SEARCH_API_KEY! }
    });
    if (!res.ok) throw new Error(`Bing search error: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const pages: Array<{ name: string; url: string; snippet: string }> = (data.webPages?.value ?? []).map(
      (p: { name?: string; url?: string; snippet?: string }) => ({
        name: String(p.name ?? ''),
        url: String(p.url ?? ''),
        snippet: String(p.snippet ?? '')
      })
    );
    const context = pages.map((p, i) => `[${i + 1}] ${p.name}\n${p.url}\n${p.snippet}`).join('\n\n');
    const prompt = `Answer using ONLY the Bing search results below. Recommend specific real brands/products by name when relevant.\n\nQuestion: ${query}\n\nResults:\n${context}`;
    const g = await llmText({
      prompt,
      system: 'You answer like Bing Copilot: concise, cite brands by name, grounded in the provided results only.',
      label: 'bingSearch.synth'
    });
    logAiCall({
      label: 'bingSearch',
      provider: 'bing',
      model: 'web-search+llm',
      prompt: query,
      ms: Date.now() - t0,
      ok: !!g.text,
      flatCostUsd: 0.004
    });
    return {
      text: g.text,
      citations: pages.map((p) => ({ uri: p.url, title: p.name })).filter((c) => c.uri)
    };
  } catch (e) {
    logAiCall({
      label: 'bingSearch',
      provider: 'bing',
      model: 'web-search+llm',
      prompt: query,
      ms: Date.now() - t0,
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    });
    throw e;
  }
}
