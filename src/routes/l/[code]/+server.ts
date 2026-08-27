import { swallow } from '$lib/server/swallow';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { SHORT_CODE_RE, bumpLinkClick } from '$lib/server/post-links';

// Public short-code redirect for post CTAs: /l/<code> → 302 to the link's target (UTM tags are
// already baked into target_url by enrichCtaWithUtm at persist time). Public, no auth, no
// cookies, no session — the only write is the atomic clicks_redirect bump via the
// security-definer RPC (service role). Invalid code → 404; a failed count never breaks the
// redirect.
// ponytail: clicks_redirect is NOISY by design — platform unfurl crawlers prefetch caption
// links — so it's reported separately from clicks_landing (the beacon on the target page).
export const GET: RequestHandler = async ({ params }) => {
  const code = params.code;
  if (!code || !SHORT_CODE_RE.test(code)) {
    return new Response('Not found', { status: 404 });
  }

  const admin = createAdminClient();
  const { data: link } = await admin
    .from('post_links')
    .select('target_url')
    .eq('code', code)
    .maybeSingle();

  // Only http(s) targets are redirectable — a malformed/foreign scheme row (hand-edited or
  // legacy data) must not become an open redirect.
  if (!link?.target_url || !/^https?:\/\//i.test(link.target_url)) {
    return new Response('Not found', { status: 404 });
  }

  await bumpLinkClick(admin, code, 'redirect').catch(swallow('bump link click'));

  return new Response(null, {
    status: 302,
    headers: {
      Location: link.target_url,
      'Cache-Control': 'no-store'
    }
  });
};
