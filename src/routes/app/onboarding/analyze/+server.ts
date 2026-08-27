import type { RequestHandler } from './$types';
import { canEnter } from '$lib/server/access';
import { runBrandAnalysis } from '$lib/server/brand-analysis';
import { logOnboardingError } from '$lib/server/onboarding-errors';
import { localeLanguageName } from '$lib/i18n/locale';

export const config = { maxDuration: 300 };

// Streams NDJSON: { type:'progress', step, message } … then { type:'result', data: BrandProfile }
// (or { type:'error', message }). Reuses dalnulla's brand analysis (incl. Shopify product import).
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession, locale } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });

  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const body = await request.json().catch(() => ({}));
  let url = String(body?.url ?? '').trim();
  if (!url) return new Response('URL required', { status: 400 });
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  // Users sometimes type a business name ("Giovanni Brancale Consulente…") instead of an
  // address. Reject anything that isn't a plausible hostname here so it fails as a clean 400
  // rather than blowing up later as a "Could not fetch URL" error in the analysis stream.
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return new Response('Invalid URL', { status: 400 });
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) return new Response('Invalid URL', { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      // Keepalive: a single LLM/image step can run silent for 30s+, and mobile browsers/proxies
      // drop an idle streaming connection (surfaces to the client as a bare "Load failed"). A ping
      // every 10s keeps it warm; the client ignores 'ping'. Stops itself if the client disconnects.
      const ping = setInterval(() => {
        try { send({ type: 'ping' }); } catch { clearInterval(ping); }
      }, 10000);
      // Track the furthest sub-stage reached so a failure can say WHERE the analysis died.
      let lastStep = 'start';
      try {
        const profile = await runBrandAnalysis(
          url,
          (step, message) => {
            lastStep = step;
            send({ type: 'progress', step, message });
          },
          undefined,
          localeLanguageName(locale)
        );
        send({ type: 'result', data: profile });
      } catch (e) {
        await logOnboardingError(supabase, user.id, 'analyze', e, { url, lastStep });
        send({ type: 'error', message: e instanceof Error ? e.message : 'Analysis failed' });
      } finally {
        clearInterval(ping);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' }
  });
};
