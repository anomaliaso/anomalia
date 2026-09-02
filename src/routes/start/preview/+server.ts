import type { RequestHandler } from './$types';
import { isGuestPreviewEnabled } from '$lib/server/feature-flags';
import { assertPublicUrl, guardTool } from '$lib/server/tool-guard';
import { runBrandAnalysis } from '$lib/server/brand-analysis';
import { planPreviewPosts, renderPreviewImages } from '$lib/server/content-preview/weekly-planner';
import { createAdminClient } from '$lib/server/supabase-admin';
import { NANO_BANANA_2_LITE } from '$lib/server/gemini';
import { localeLanguageName } from '$lib/i18n/locale';

/**
 * THE FIRST POST, BEFORE THE ACCOUNT.
 *
 * The visitor types a website on the homepage and gets ONE finished post — caption and image —
 * without signing up. Signing up is what saves it and gets more, and `guestPostRow` adopts this
 * exact post afterwards: the person finds again what convinced them, never a regenerated variant.
 *
 * ONE post, not three: three multiply by three the chance one is bad, and one bad post confirms
 * the "AI slop" prior the visitor already arrived with.
 *
 * Why a single streaming request and not the durable job path the wizard uses: `plan_posts` and
 * `preview_images` live on `onboarding_step_jobs`, whose `user_id` is NOT NULL and whose queue is
 * drained by a cron. An anonymous visitor has no user, and a new cron was ruled out. So the work
 * happens inline, inside the platform's 300s, with the same NDJSON + keepalive shape that
 * `/app/onboarding/analyze` already uses.
 *
 * This is the only unauthenticated endpoint that spends real money, and no credit gate stands
 * behind it — `renderPostImage` gates on a brand context a guest does not have. The three guards
 * at the top (kill switch, per-IP cap, resolve-then-check SSRF) ARE the spending limit, in that
 * order: refuse before counting, count before generating.
 *
 * Known gap, deliberately not widened here: runBrandAnalysis still fetches internally behind
 * brand-analysis.ts's pattern-only isUrlSafe (:788), which fetchPage (:813) applies at :815 and
 * re-checks on each redirect hop at :846 — all string comparisons, so a hostname resolving to a
 * private address passes. Fine while every caller was authenticated; now that an anonymous one
 * exists, it is real debt, tracked in the PR rather than widened here.
 */
export const config = { maxDuration: 300 };

const GUEST_PREVIEW_TOOL = 'guest-preview';
const GUEST_PREVIEW_PLATFORM = 'instagram';
const GUEST_PREVIEW_POST_COUNT = 1;
const KEEPALIVE_MS = 10_000;

export const POST: RequestHandler = async ({ request, getClientAddress, locals: { locale } }) => {
  if (!isGuestPreviewEnabled()) return new Response('Not found', { status: 404 });

  const guard = await guardTool(GUEST_PREVIEW_TOOL, getClientAddress());
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  let url = String(body?.url ?? '').trim();
  if (!url) return new Response('URL required', { status: 400 });
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  // Same hostname rule as /app/onboarding/analyze: a business name typed instead of an address
  // must fail as a clean 400 here, not as an obscure fetch error later in the stream.
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return new Response('Invalid URL', { status: 400 });
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) return new Response('Invalid URL', { status: 400 });

  // The guard that makes an open endpoint stop being a request forger — and it has to be the
  // RESOLVING one. brand-analysis's isUrlSafe compares hostname patterns, which is enough for a
  // URL we already trust (a brand's own site) but blind to a perfectly public hostname whose DNS
  // record points at 127.0.0.1. This caller is an anonymous stranger, so it gets the same
  // resolve-then-check the public /api/tools endpoints get.
  try {
    await assertPublicUrl(new URL(url));
  } catch {
    return new Response('Invalid URL', { status: 400 });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      const ping = setInterval(() => {
        try {
          send({ type: 'ping' });
        } catch {
          clearInterval(ping);
        }
      }, KEEPALIVE_MS);

      try {
        const profile = await runBrandAnalysis(
          url,
          (step, message) => send({ type: 'progress', step, message }),
          undefined,
          localeLanguageName(locale)
        );
        send({ type: 'brand', data: { name: profile?.name ?? '', url: profile?.url ?? url } });

        // No supabase and no brandId: invokeWeekPlannerAgent bails on the missing brandId and
        // draftWeekSeeds plans from the freshly analysed profile alone.
        const posts = await planPreviewPosts(
          profile,
          { platforms: [GUEST_PREVIEW_PLATFORM], maxVideos: 0, maxCarousels: 0 },
          GUEST_PREVIEW_POST_COUNT
        );
        const post = posts[0];
        if (!post) throw new Error('no post planned');

        // The whole brand anchoring of renderPreviewImages is what keeps this post off the slop
        // pile — logo, palette, visual style, QC critic. Only the model is forced down.
        await renderPreviewImages(profile, [post], {
          supabase: createAdminClient(),
          userId: `guest/${crypto.randomUUID()}`,
          imageModel: NANO_BANANA_2_LITE,
          onProgress: (step, message) => send({ type: 'progress', step, message }),
          onPost: () => {}
        });

        send({
          type: 'result',
          data: {
            website: (profile?.url as string) ?? url,
            brandName: profile?.name ?? '',
            post: {
              platform: String(post.platform ?? GUEST_PREVIEW_PLATFORM),
              format: String(post.format ?? ''),
              caption: String(post.caption ?? ''),
              imageUrl: String(post.imageUrl ?? ''),
              imagePrompt: String(post.image_prompt ?? '')
            }
          }
        });
      } catch (e) {
        send({ type: 'error', message: e instanceof Error ? e.message : 'preview failed' });
      } finally {
        clearInterval(ping);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' }
  });
};
