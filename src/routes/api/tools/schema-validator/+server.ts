import type { RequestHandler } from './$types';
import { runUrlTool, safeFetchUrl } from '$lib/server/tool-guard';
import { analyseSchema } from '$lib/server/seo-tools';

// Structured-data (JSON-LD + microdata) validator.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const { url } = await request.json().catch(() => ({ url: '' }));
  return runUrlTool('schema-validator', getClientAddress(), url, async (input) => {
    const res = await safeFetchUrl(input, { maxBytes: 1_500_000 });
    return analyseSchema(res.body, res.url);
  });
};
