import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';

// Anonymous per-article view beacon from the public blog (navigator.sendBeacon). No cookies,
// no personal data — just bumps a per-day counter (article_views), so no consent gate needed.
// Always 204: a failed count must never surface to the reader.
// ponytail: no bot/rate filtering — add a UA check or per-IP throttle if counts look inflated.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { id } = await request.json();
    if (typeof id === 'string' && UUID.test(id)) {
      await createAdminClient().rpc('bump_article_view', { aid: id });
    }
  } catch { /* malformed beacon → ignore */ }
  return new Response(null, { status: 204 });
};
