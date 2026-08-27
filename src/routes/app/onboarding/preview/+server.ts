import { swallow } from '$lib/server/swallow';
import type { RequestHandler } from './$types';
import { canEnter } from '$lib/server/access';
import { generatePreview } from '$lib/server/content-preview';
import { scrapeForOnboarding, type ScrapeTarget } from '$lib/server/scrapecreators';
import { genaiClient, synthesizeBrandContext, synthesizeVisualStyle } from '$lib/server/brand-context';
import { withBrandContext } from '$lib/server/ai-log';

// Generating six preview posts (each an image via Nano Banana Pro) in one streamed request runs
// long; give it room beyond the platform default so Vercel doesn't kill the stream mid-flight.
export const config = { maxDuration: 300 };

// Parse the per-platform handles the user entered at the socials step into scrape targets.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseHandles(raw: any): ScrapeTarget[] {
  if (!Array.isArray(raw)) return [];
  return raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((h: any) => ({
      platform: String(h?.platform ?? '').toLowerCase(),
      username: h?.username ? String(h.username).trim().replace(/^@/, '') : null,
      profileUrl: h?.profileUrl ? String(h.profileUrl).trim() : null
    }))
    .filter((h) => h.platform && (h.username || h.profileUrl));
}

// Streams NDJSON: { type:'progress' } … { type:'post', data } per generated post … { type:'done' }.
// Images only (Nano Banana Pro); video is skipped. No persistence — onboarding wow preview.
// If the user gave social handles, we scrape their past posts first (cached by handle) and feed
// the synthesised voice + visual style into the plan so the 6 posts match their existing content.
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });

  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const body = await request.json().catch(() => ({}));
  const brandId = typeof body?.brandId === 'string' ? body.brandId : null;
  if (!brandId) return new Response('Missing brandId', { status: 400 });

  return withBrandContext(brandId, async () => {
    const profile = body?.profile ?? body;
  const platforms: string[] = Array.isArray(body?.platforms) ? body.platforms : [];
  const prefs = body?.prefs && typeof body.prefs === 'object' ? body.prefs : {};
  const handles = parseHandles(body?.handles);
  const additionalContext = typeof body?.additionalContext === 'string' ? body.additionalContext.trim() : '';
  // Optional people captured during onboarding (name/role + signed photo URLs) — let the planner
  // run a couple of person-led posts so the first batch isn't all faceless product shots.
  if (Array.isArray(body?.people) && body.people.length) profile.people = body.people;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      // Keepalive: planning + image generation run silent for 30s+ at a time, and mobile
      // browsers/proxies drop an idle streaming connection (the client then throws "Load failed").
      // A ping every 10s keeps it warm; the client ignores 'ping'. Stops if the client disconnects.
      const ping = setInterval(() => {
        try { send({ type: 'ping' }); } catch { clearInterval(ping); }
      }, 10000);
      try {
        // Best-effort: learn voice + visual style from the user's real past posts before planning.
        if (handles.length) {
          try {
            send({ type: 'progress', step: 'reading', message: 'Reading your past posts…' });
            const { posts } = await scrapeForOnboarding(handles);
            if (posts.length) {
              const ai = genaiClient();
              const [ctx, style] = await Promise.all([
                synthesizeBrandContext(ai, {
                  name: profile?.name ?? '',
                  kit: { about: profile?.about, category: profile?.category, target_audience: profile?.target_audience },
                  documents: [],
                  posts: posts.map((p) => ({ content: p.content, platform: p.platform, metrics: p.metrics }))
                }),
                synthesizeVisualStyle(ai, posts.map((p) => p.thumbnailUrl).filter((u): u is string => !!u))
              ]);
              if (ctx) profile.ai_context = ctx;
              if (style) profile.visual_style = style;
            }
          } catch (error) { swallow('fold social history', error); }
        }

        // Fold the user's free-text context into what the planner sees (also helps it infer
        // the right language when none was explicitly chosen).
        if (additionalContext) {
          profile.ai_context = [profile.ai_context, `ADDITIONAL CONTEXT FROM USER:\n${additionalContext}`]
            .filter(Boolean)
            .join('\n\n');
        }

        await generatePreview(profile, {
          supabase,
          userId: user.id,
          platforms,
          prefs,
          // Onboarding is a free wow-preview we never charge for, so keep it cheap: allow at
          // most one video-format post regardless of plan. The hard-clamp downgrades the rest.
          maxVideos: 1,
          onProgress: (step, message) => send({ type: 'progress', step, message }),
          onPost: (post) => send({ type: 'post', data: post })
        }, 6);
        send({ type: 'done' });
      } catch (e) {
        send({ type: 'error', message: e instanceof Error ? e.message : 'Preview failed' });
      } finally {
        clearInterval(ping);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' }
  });
  });
};
