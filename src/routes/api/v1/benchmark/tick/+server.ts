import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { runBenchmarkTick } from '$lib/server/benchmark-store';

export const config = { maxDuration: 300 };

/**
 * Score newly committed posts. Runs to completion inline: scoring is pure and the batch is capped,
 * so a tick is a handful of queries — no need for the fire-and-forget + self-chain dance the AI
 * workers use.
 */
async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand')?.trim() || undefined;
  const sinceDays = Number(url.searchParams.get('days') ?? '') || undefined;

  try {
    const result = await runBenchmarkTick(createAdminClient(), { brandId, sinceDays });
    return json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[benchmark/tick]', message);
    return json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
