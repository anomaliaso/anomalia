import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { ranksTickAll } from '$lib/server/rank-tracker';

export const config = { maxDuration: 300 };

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const only = new URL(request.url).searchParams.get('brand');
  const result = await ranksTickAll(createAdminClient(), { brandSlug: only, maxBrands: only ? 1 : 10 });
  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
