import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { SHORT_CODE_RE, bumpLinkClick } from '$lib/server/post-links';

// Anonymous landing beacon for post CTAs: POST { code } from the target page itself (e.g. the
// brand's own blog article, loaded via a UTM-tagged /l/[code] redirect). No cookies, no personal
// data — just bumps clicks_landing. Always 204: a failed count must never surface to the page.
// This is the CLEAN click signature (vs clicks_redirect, which platform unfurl crawlers
// inflate): only real page loads fire it. The target page knows the code by reading the utm
// params it arrived with and looking the code up — wiring that lookup lives with the blog site,
// not here.
export const POST: RequestHandler = async ({ request }) => {
  try {
    const { code } = await request.json();
    if (typeof code === 'string' && SHORT_CODE_RE.test(code)) {
      await bumpLinkClick(createAdminClient(), code, 'landing');
    }
  } catch { /* malformed beacon → ignore */ }
  return new Response(null, { status: 204 });
};
