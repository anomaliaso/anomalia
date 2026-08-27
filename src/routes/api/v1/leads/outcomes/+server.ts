import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { runOutcomeChecks, CHECK_AFTER_HOURS, MAX_CHECKS_PER_RUN } from '$lib/server/lead-outcomes';

// Esiti dei lead — torna a guardare i commenti segnati come "fatto" e registra com'è andata.
//
// Cron giornaliero: un commento si assesta in 48 ore, quindi controllare più spesso costa crediti e
// non aggiunge informazione. Nessuna AI qui dentro: è una rilettura e un confronto di testo.

export const config = { maxDuration: 300 };

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const limit = Math.max(1, Math.min(100, Number(new URL(request.url).searchParams.get('limit')) || MAX_CHECKS_PER_RUN));
  const out = await runOutcomeChecks(createAdminClient(), limit);

  return new Response(JSON.stringify({ ok: true, ...out, checkAfterHours: CHECK_AFTER_HOURS }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
