import type { RequestHandler } from './$types';
import { runUrlTool, safeFetchUrl } from '$lib/server/tool-guard';
import { analyseRobots } from '$lib/server/seo-tools';

// robots.txt fetch + rule tester. Reports per-crawler verdicts for the tested path, including
// the AI crawlers — being blocked there is the modern version of being deindexed.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const body = await request.json().catch(() => ({}));
  const testPath = typeof body?.path === 'string' && body.path.trim() ? body.path.trim() : '/';
  return runUrlTool('robots-tester', getClientAddress(), body?.url, async (input) => {
    const origin = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`).origin;
    const res = await safeFetchUrl(`${origin}/robots.txt`, { maxBytes: 500_000 });
    // A 404 is a valid answer ("no robots.txt"), not an error — so is HTML served by a catch-all
    // route, which is why the content type is checked rather than trusted.
    const isText = !/^\s*<(!doctype|html)/i.test(res.body);
    const found = res.ok && !!res.body.trim() && isText;
    return analyseRobots(found ? res.body : '', origin, testPath.startsWith('/') ? testPath : `/${testPath}`, found);
  });
};
