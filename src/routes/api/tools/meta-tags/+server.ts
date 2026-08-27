import type { RequestHandler } from './$types';
import { runUrlTool, safeFetchUrl } from '$lib/server/tool-guard';
import { analyseMetaTags } from '$lib/server/seo-tools';

// Meta tags + SERP snippet preview. One fetch, no paid API.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const { url } = await request.json().catch(() => ({ url: '' }));
  return runUrlTool('meta-tags', getClientAddress(), url, async (input) => {
    // Only <head> matters here, so a small byte budget is plenty and keeps big pages cheap.
    const res = await safeFetchUrl(input, { maxBytes: 600_000 });
    return analyseMetaTags(res.body, res.url);
  });
};
