import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import {
  kickVideoReviewWork,
  runVideoReviewTick,
  VIDEO_REVIEW_TIME_BUDGET_MS
} from '$lib/server/video-review-store';

export const config = { maxDuration: 300 };

// NON è più un cron. La riga `*/5` in vercel.json è stata rimossa insieme allo spegnimento del
// giudice automatico (AUTO_VIDEO_REVIEW_ENABLED in video-review.ts): niente si mette più in coda
// da solo, quindi un tick periodico non troverebbe altro che il vuoto. L'endpoint resta perché è
// anche il modo in cui una review CHIESTA A MANO viene drenata: Impostazioni › Media reviewer
// accoda con `manual: true` e poi chiama qui (kickVideoReviewWork). Rimettere la riga in
// vercel.json e AUTO_VIDEO_REVIEW=on riaccende tutto, senza toccare codice.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

async function drain(request: Request): Promise<void> {
  const admin = createAdminClient();
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand')?.trim() || undefined;
  const origin = url.origin;
  const result = await runVideoReviewTick(admin, {
    brandId,
    deadlineMs: Date.now() + VIDEO_REVIEW_TIME_BUDGET_MS
  });
  // Ci si richiama solo se qualcosa si è mosso davvero. `remaining > 0` da solo è sempre vero
  // quando la coda è bloccata (brand a crediti zero, riga rimessa in pending), e l'endpoint si
  // ri-postava addosso ogni 1-3s per sempre. Se nessuna riga è avanzata, la coda aspetta il cron.
  if (result.remaining > 0 && result.processed > 0) await kickVideoReviewWork(origin, brandId);
}

function run(request: Request, platform: Platform): Response {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const work = drain(request).catch((e) => {
    console.error('[video-review/work]', e instanceof Error ? e.message : e);
  });
  if (platform?.context?.waitUntil) platform.context.waitUntil(work);
  else void work;
  return json({ ok: true, started: true }, { status: 202 });
}

export const GET: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
export const POST: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
