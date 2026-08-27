import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { publishDueArticles } from '$lib/server/blog-generate';

// Blog publish cron: flip every article whose scheduled_for has passed to 'published'. Runs often
// (every few minutes) so scheduled posts go live near their chosen time. Same auth gate as the
// other ticks. ?brand=<brandId> scopes to one brand for manual runs.

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const only = new URL(request.url).searchParams.get('brand') ?? undefined;
  const published = await publishDueArticles(createAdminClient(), only);
  return new Response(JSON.stringify({ ok: true, published }), { headers: { 'content-type': 'application/json' } });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
