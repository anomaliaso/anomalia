import type { RequestHandler } from './$types';

// Legacy onboarding_jobs processor — disabled. Strategy/content now run in-app (chat / Publish).
// Kept as a no-op so old cron schedules / bookmarks don't 404 or re-kick stalled jobs.

export const GET: RequestHandler = async () =>
  new Response(JSON.stringify({ ok: true, disabled: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

export const POST: RequestHandler = async () =>
  new Response(JSON.stringify({ ok: true, disabled: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
