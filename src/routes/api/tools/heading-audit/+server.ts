import type { RequestHandler } from './$types';
import { runUrlTool, safeFetchUrl } from '$lib/server/tool-guard';
import { analyseContent } from '$lib/server/seo-tools';

// Heading outline, image alt coverage, internal linking and word count.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const { url } = await request.json().catch(() => ({ url: '' }));
  return runUrlTool('heading-audit', getClientAddress(), url, async (input) => {
    const res = await safeFetchUrl(input, { maxBytes: 2_000_000 });
    return analyseContent(res.body, res.url);
  });
};
