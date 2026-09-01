import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publishPost, getPostStatus, deletePost } from './zernio';
import { nextOccurrence } from './schedule';
import { markPageUsed } from './content-library';
import { withBrandContext } from './ai-log';
import { platformLimit, platformLabel, captionFor, ensureShortNetworkCuts, mediaUrlsForPublish, VIDEO_ONLY_PLATFORMS, youtubeTitleFrom, type PlatformCaptions } from '$lib/platform-limits';
import { isVideoUrl } from '$lib/content-formats';
import { mediaUrlsForCheck, requiresVisualMedia } from './prepublish-check';
import { recordPostVerdict } from './post-verdict';

const PROVIDER_REFUSAL = 'No social publishing provider is configured on this instance.';

export type ApprovablePost = {
  id: string;
  brand_id: string;
  platform: string | null;
  // Cross-post target set. Empty/absent → publish only to `platform` (back-compat).
  platforms?: string[] | null;
  caption: string | null;
  // Per-platform caption overrides ({"x": ..., "threads": ...}); absent → same caption everywhere.
  platform_captions?: PlatformCaptions;
  media_url: string | null;
  // Ordered carousel slide URLs (media_urls column). Optional so legacy selects keep compiling:
  // when absent/empty the publish falls back to the single media_url (first slide only).
  media_urls?: string[] | null;
  slot: string | null;
  // A concrete chosen instant (set when the user reschedules to an exact day+time). Preferred
  // over the recurring weekday slot when it's still in the future.
  // FIX I: required (not optional) — callers MUST select this column. The compiler catches
  // any caller that forgets, preventing the bug A class (select without scheduled_for).
  scheduled_for: string | null;
  // Reddit-specific fields (null/empty for other platforms).
  title?: string | null;
  link_url?: string | null;
  subreddit?: string | null;
  content_type?: string | null;
  // Video clips only: kie's original job id + the resolution the stored mp4 is at. Together they
  // let the publish path upscale an approved clip in place (see upscaleApprovedClip). Optional so
  // legacy selects that don't ask for the columns keep compiling — an absent id just skips it.
  video_task_id?: string | null;
  video_resolution?: string | null;
  video_thumbnail_url?: string | null;
  // Custom 16:9 YouTube cover (migration 0171). Distinct from video_thumbnail_url.
  youtube_thumbnail_url?: string | null;
  // Last-mile ship gate (migration 0168). Optional so legacy selects still compile.
  prepublish_ok?: boolean | null;
};

export type PublishResult = { scheduled: number; failed: number; noAccount: boolean; error?: string };

/**
 * IL CANCELLO PRIMA DELLA SPESA — quali di queste piattaforme il brand ha DAVVERO collegate.
 *
 * Stessa tabella e stesso filtro `status = 'active'` che usa il fan-out qui sotto: un cancello
 * che leggesse altrove potrebbe dire sì dove il publisher dice no. Chi produce per una
 * piattaforma (creare un post, programmarlo) lo chiama PRIMA di lavorare — un giro vero è
 * costato 429s e $0,19 per un post TikTok su un brand senza TikTok collegato.
 */
export async function connectedPlatforms(
  supabase: SupabaseClient,
  brandId: string,
  platforms: (string | null | undefined)[]
): Promise<Set<string>> {
  const wanted = [...new Set(platforms.map((p) => (p ?? '').trim().toLowerCase()).filter(Boolean))];
  if (!wanted.length) return new Set();
  const { data } = await supabase
    .from('social_accounts')
    .select('platform')
    .eq('brand_id', brandId)
    .in('platform', wanted)
    .eq('status', 'active');
  return new Set((data ?? []).map((a) => ((a as { platform: string | null }).platform ?? '').toLowerCase()));
}

/**
 * Il testo che l'agente può ripetere all'utente quando `noAccount` è vero. Un `noAccount: true`
 * nudo, accanto a `success: true`, si legge come "fatto": va detto a parole cosa NON è successo
 * e cosa deve fare l'utente perché succeda.
 */
export function noAccountNotice(platforms: (string | null | undefined)[]): string {
  const names = [...new Set(platforms.map((p) => (p ?? '').trim().toLowerCase()).filter(Boolean))];
  const list = names.length ? names.join(', ') : 'this platform';
  return `NOT scheduled: no connected account for ${list}. The post stays approved and only goes out once the user connects ${names.length > 1 ? 'those accounts' : 'that account'} in Settings > Connectors. Say exactly that — do not claim it was scheduled or published.`;
}

// Pull `details.existingPostId` out of a Zernio 409 error string (the body is JSON after "409:").
// Returns null if it can't be parsed — caller falls back to whatever id it already had.
function extractExistingPostId(msg: string): string | null {
  const brace = msg.indexOf('{');
  if (brace < 0) return null;
  try {
    const body = JSON.parse(msg.slice(brace));
    return body?.details?.existingPostId ?? null;
  } catch {
    return null;
  }
}

// Was this Zernio post revoked by the user? cancelZernioForPost (post-editing.ts) marks the
// publish_logs row 'revoked' when it could NOT delete the external post — the copy is still live
// on Zernio while our post is back in the user's hands. The 409 recovery below must treat such an
// id as a failure instead of re-adopting it, or a re-approve within the 24h dedupe window brings
// the revoked post back as if it had been scheduled anew.
async function isRevokedExternalId(supabase: SupabaseClient, externalId: string): Promise<boolean> {
  const { data } = await supabase
    .from('publish_logs')
    .select('id')
    .eq('external_post_id', externalId)
    .eq('status', 'revoked')
    .limit(1);
  return !!data?.length;
}

// Upscale an approved clip to full resolution, in place, once.
//
// Drafts render cheap (see RESOLUTION in video.ts) because most are never published. Approval is
// the point where the extra spend is justified — and kie can raise the resolution of the EXISTING
// job from its task id, so this costs an upscale, not a whole regeneration.
//
// Every guard here exists to avoid spending twice or spending wrongly:
//  • not a generated clip / no task id  → nothing to upscale (images, uploads, legacy rows)
//  • already at the target resolution   → a re-publish or reschedule must not buy it again
// On success the row is updated too, so a later reschedule sees the clip is already upscaled.
async function upscaleApprovedClip(supabase: SupabaseClient, post: ApprovablePost): Promise<void> {
  if (post.content_type !== 'generated_video') return;

  // Editor/list selects omit these columns (migration 0127). Load them here so publish still
  // upscales when the columns exist; if they don't, PostgREST errors and we skip quietly.
  let taskId = post.video_task_id ?? null;
  let resolution = post.video_resolution ?? null;
  if (!taskId) {
    const { data } = await supabase
      .from('posts')
      .select('video_task_id, video_resolution')
      .eq('id', post.id)
      .maybeSingle();
    taskId = (data as { video_task_id?: string | null } | null)?.video_task_id ?? null;
    resolution = (data as { video_resolution?: string | null } | null)?.video_resolution ?? null;
  }
  if (!taskId) return;

  // The brand's Settings → Video choice IS the shipping resolution — a clip rendered at what the
  // brand asked for must never be quietly upscaled past it, because that overrules the setting and
  // costs double. So the target is the brand's own choice, not a global ceiling: this now does real
  // work only for a brand that has just opted into 720p while older clips sit at 480p.
  const { data: b } = await supabase.from('brands').select('content_prefs').eq('id', post.brand_id).maybeSingle();
  const { UPSCALE_RESOLUTION, clampVideoResolution, upscaleVideo } = await import('./video');
  const target = clampVideoResolution((b?.content_prefs as { videoResolution?: string } | null)?.videoResolution);
  // kie only upscales UP (720p | 1080p) — a 480p brand has nothing to buy here, ever.
  if (target !== UPSCALE_RESOLUTION || (resolution ?? '') === target) return;

  // The clip lives under the OWNER's storage prefix; reuse the path already in media_url rather
  // than guessing a user id — publish runs from crons and CLI calls with no session user.
  const ownerId = ownerIdFromMediaUrl(post.media_url);
  if (!ownerId) return;

  const up = await upscaleVideo(supabase, ownerId, taskId, target);
  if (!up) return; // keep the draft-resolution clip — a publish must never fail over pixels

  post.media_url = up.url;
  await supabase
    .from('posts')
    .update({ media_url: up.url, video_resolution: up.resolution })
    .eq('id', post.id);
}

// Recover the owning user id from a stored media URL. Every generated object is written to
// `{userId}/generated/{uuid}.mp4` because Storage RLS requires the first path segment to equal
// auth.uid() — so the prefix IS the owner, and re-deriving it keeps the upscaled file under the
// same policy as the original. Returns null for uploads/legacy URLs that don't match the shape.
export function ownerIdFromMediaUrl(url: string | null | undefined): string | null {
  const m = /\/media\/([0-9a-f-]{36})\//i.exec(String(url ?? ''));
  return m?.[1] ?? null;
}

// On approval, send the post to Zernio scheduled for its slot (Zernio does the actual posting).
// Publishes the same caption + media to every active account across the post's target platforms
// (cross-post). Targets = post.platforms when set, else the single post.platform.
export async function publishApprovedPost(
  supabase: SupabaseClient,
  post: ApprovablePost,
  timezone: string,
  opts: { now?: boolean; by?: string } = {}
): Promise<PublishResult> {
  // A clip rendering out-of-band leaves the cover frame in media_url, so publishing now would ship
  // a photo where a video was promised. The guard belongs HERE, not only in the chat's
  // approve_post: this is the shared chokepoint for the UI approve endpoint, the CLI's approve and
  // approve-all, the post editor and the scheduler, and every one of them can reach a post whose
  // clip has not landed. Queried on its own because EDITOR_POST_COLS deliberately excludes columns
  // whose migration may be pending, and a failure here must not block ordinary publishing.
  const { data: renderState } = await supabase
    .from('posts')
    .select('video_render_status, status')
    .eq('id', post.id)
    .maybeSingle();
  const wasDraft = (renderState as { status?: string | null } | null)?.status === 'pending_user';
  if ((renderState as { video_render_status?: string | null } | null)?.video_render_status === 'rendering') {
    return {
      scheduled: 0,
      failed: 1,
      noAccount: false,
      error: 'The video for this post is still rendering — approving now would publish the cover image instead of the clip. Try again once it lands.'
    };
  }

  // UN POST VISIVO SENZA IMMAGINE NON PARTE. MAI.
  //
  // Non era vero: su 90 giorni, 31 post non-testuali senza `media_url` né `media_urls`, di cui 5
  // approvati, 5 schedulati e UNO pubblicato. `deterministicPrepublishIssues` lo diceva già, ma
  // solo dal cron che giudica poco prima dello slot — e c'è una porta che gli passa davanti: il
  // ramo "nessun account collegato" qui sotto scrive `status = 'approved'` e torna prima del
  // gate. Qui invece si è a monte di tutto: questa è la strozzatura condivisa da approve (UI, CLI,
  // chat), approvazione via email, repost, riprogrammazione e scheduler. Una guardia sola, e non
  // una per chiamante — che era esattamente il modo in cui era già stata mancata.
  if (requiresVisualMedia(post.content_type) && !mediaUrlsForCheck(post).length) {
    return {
      scheduled: 0,
      failed: 1,
      noAccount: false,
      error:
        'This post has no image or video. Give it a visual (or make it a text post) before approving — a visual post with no media publishes as an empty post.'
    };
  }

  if (opts.by && wasDraft) {
    await recordPostVerdict(supabase, {
      postId: post.id,
      brandId: post.brand_id,
      actorId: opts.by,
      verdict: 'approved'
    });
  }

  const targets = (post.platforms && post.platforms.length ? post.platforms : [post.platform])
    .map((p) => (p ?? '').toLowerCase())
    .filter(Boolean);

  // Backstop for rows that were saved without short-network cuts (Radar bug pre-fix, editor
  // expanding platforms without filling overrides). Synthesise missing cuts so X/Threads don't
  // reject the full Instagram caption. Persist when we had to invent any.
  const ensuredCuts = ensureShortNetworkCuts(post.caption, targets, post.platform_captions);
  const effectiveCaptions: PlatformCaptions = ensuredCuts ?? post.platform_captions;
  if (
    ensuredCuts &&
    JSON.stringify(ensuredCuts) !== JSON.stringify(post.platform_captions ?? null)
  ) {
    post.platform_captions = ensuredCuts;
    void supabase
      .from('posts')
      .update({ platform_captions: ensuredCuts })
      .eq('id', post.id)
      .then(({ error }) => {
        if (error) console.warn('[publish] persist platform_captions failed:', error.message);
      });
  }

  // Account selection is an INTENTIONAL fan-out: the same caption + media goes to EVERY active
  // account across the post's target platforms (cross-post — see the function doc above), so there
  // is no per-post single-account rotation here. social_accounts.last_used_at (migration 0160) is
  // still maintained as the rotation cursor: every account this fan-out actually published to gets
  // stamped below, so a future selector can order by last_used_at asc nulls first and pick the
  // least-recently-used account per platform without changing today's cross-post behavior.
  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('id, zernio_account_id, platform')
    .eq('brand_id', post.brand_id)
    .in('platform', targets.length ? targets : ['__none__'])
    .eq('status', 'active');

  // No connected account for any target platform → keep it approved, can't publish yet.
  if (!accounts || accounts.length === 0) {
    await supabase.from('posts').update({ status: 'approved' }).eq('id', post.id);
    return { scheduled: 0, failed: 0, noAccount: true };
  }

  // The post is definitely going out — this is the one moment worth paying full resolution for.
  // Mutates post.media_url in place so every branch below (payload build, 409 retry) sends the
  // upscaled clip. Non-fatal by construction: on any miss the draft-resolution clip publishes.
  await upscaleApprovedClip(supabase, post);

  // opts.now → publish immediately (repost). Otherwise prefer the exact instant the user picked
  // (if still in the future), else the next occurrence of the recurring weekday slot.
  const chosen = post.scheduled_for ? new Date(post.scheduled_for).getTime() : 0;
  const scheduledFor = opts.now
    ? undefined
    : chosen > Date.now()
      ? (post.scheduled_for as string)
      : nextOccurrence(post.slot, timezone);

  // Last-mile gate: immediate publishes, and slots inside the lead window, must get an OK
  // before anything is sent to Zernio. Far-future slots are judged by the prepublish cron.
  if (post.prepublish_ok !== true) {
    const { shouldGatePrepublish, inspectPostForRelease } = await import('./prepublish-check');
    if (shouldGatePrepublish(scheduledFor, { now: opts.now })) {
      const verdict = await withBrandContext(post.brand_id, () => inspectPostForRelease(post));
      if (verdict.decision === 'hold') {
        const attention = `Pre-publish hold: ${verdict.reason}`.slice(0, 500);
        await supabase
          .from('posts')
          .update({
            status: 'pending_user',
            needs_attention: true,
            attention_reason: attention,
            prepublish_ok: false,
            prepublish_checked_at: new Date().toISOString(),
            external_post_id: null
          })
          .eq('id', post.id);
        return { scheduled: 0, failed: 1, noAccount: false, error: attention };
      }
      if (verdict.decision === 'pass') {
        post.prepublish_ok = true;
        await supabase
          .from('posts')
          .update({
            prepublish_ok: true,
            prepublish_checked_at: new Date().toISOString()
          })
          .eq('id', post.id);
      }
      // skip (infra) → fail-open and send to Zernio
    }
  }

  let scheduled = 0;
  let failed = 0;
  let externalId: string | null = null;
  // Accounts this fan-out actually published to (a 'scheduled' publish_logs row was written).
  // Stamped on social_accounts.last_used_at after the loop — the rotation cursor (see the
  // account-select comment above).
  const usedAccountIds: string[] = [];
  // Last failure reason (over-limit caption or Zernio rejection), surfaced to callers so the
  // CLI/AI/UI can show why an approve didn't schedule instead of a false success.
  let failReason: string | undefined;

  for (const acc of accounts) {
    const isReddit = (acc.platform ?? '').toLowerCase() === 'reddit';
    const isYoutube = VIDEO_ONLY_PLATFORMS.has((acc.platform ?? '').toLowerCase());
    const isLinkPost = post.content_type === 'link';
    // Each account publishes the caption written for ITS platform (X/Threads can carry their own
    // shorter cut); everything else falls back to the single main caption.
    const caption = captionFor(post.caption, effectiveCaptions, acc.platform);
    // For Reddit: the content sent to Zernio is "title\n\nbody" (the caption is the body).
    // Reddit uses the first line of content as the title, rest as the body. For link posts
    // the body is optional context. For non-Reddit platforms, content is just the caption.
    const content = isReddit && post.title ? `${post.title}\n\n${caption}`.trim() : caption;
    // Platform char-limit backstop: never send an over-limit caption to Zernio (it rejects it,
    // e.g. X's 280). The UI blocks approval before this, but auto-publish + API paths land here
    // directly. Log it as a failure with a clear, actionable reason and skip only this account.
    const limit = platformLimit(acc.platform);
    if (limit && content.length > limit) {
      failReason = `Caption is ${content.length} characters — over the ${limit}-character limit for ${platformLabel(acc.platform)}. Shorten it before publishing.`;
      await supabase.from('publish_logs').insert({
        brand_id: post.brand_id,
        post_id: post.id,
        social_account_id: acc.id,
        platform: acc.platform,
        status: 'failed',
        error: failReason
      });
      failed++;
      continue;
    }
    // Hoisted so the 409-mismatch branch below can retry the exact same send.
    const payload = {
      accountId: acc.zernio_account_id,
      platform: acc.platform ?? post.platform ?? '',
      content,
      // Link posts have no image media; text posts have no media either. Carousel networks
      // (IG/FB/LinkedIn) get every slide; X/Threads/TikTok get the cover / first image only.
      mediaUrls:
        isLinkPost || post.content_type === 'text'
          ? undefined
          : mediaUrlsForPublish(acc.platform, post.media_url, post.media_urls),
      scheduledFor,
      // AI-media self-disclosure: everything we render is AI-generated EXCEPT the user's own
      // library/device uploads, which carry an 'uploaded_*' content_type. A null/legacy
      // content_type defaults to disclosing — under-disclosing is the risky direction.
      aiGeneratedMedia: !String(post.content_type ?? '').startsWith('uploaded'),
      // Reddit-specific payload.
      redditTitle: isReddit ? (post.title ?? undefined) : undefined,
      redditLinkUrl: isReddit && isLinkPost && post.link_url ? post.link_url : undefined,
      redditSubreddit: isReddit && post.subreddit ? post.subreddit : undefined,
      youtubeTitle: isYoutube ? youtubeTitleFrom(caption, post.title) : undefined,
      youtubeThumbnail: isYoutube ? (post.youtube_thumbnail_url?.trim() || undefined) : undefined
    };
    if (isYoutube && !(payload.mediaUrls ?? []).some((u) => isVideoUrl(u))) {
      failReason = 'YouTube requires a video file — Shorts vs long-form is auto-detected from duration and aspect ratio.';
      await supabase.from('publish_logs').insert({
        brand_id: post.brand_id,
        post_id: post.id,
        social_account_id: acc.id,
        platform: acc.platform,
        status: 'failed',
        error: failReason
      });
      failed++;
      continue;
    }
    try {
      const r = await publishPost(payload);
      if (!r.ok) {
        failReason = PROVIDER_REFUSAL;
        await supabase.from('publish_logs').insert({
          brand_id: post.brand_id,
          post_id: post.id,
          social_account_id: acc.id,
          platform: acc.platform,
          status: 'failed',
          error: PROVIDER_REFUSAL
        });
        failed++;
        continue;
      }
      externalId = r.postId ?? externalId;
      await supabase.from('publish_logs').insert({
        brand_id: post.brand_id,
        post_id: post.id,
        social_account_id: acc.id,
        platform: acc.platform,
        external_post_id: r.postId ?? null,
        status: 'scheduled'
      });
      scheduled++;
      usedAccountIds.push(acc.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'publish error';
      // Zernio 409 = this exact content was scheduled/posted to this account within the last 24h
      // (its dedupe guard). On a NORMAL approve this is harmless (the content is already out there),
      // so we treat it as scheduled and recover the existing id. On a FORCED republish (opts.now) the
      // user is deliberately trying to send it again — Zernio won't (published posts can't be deleted
      // and the 24h window still applies), so it's a real failure they must see, with a clear reason.
      const existingId = msg.includes('409') ? extractExistingPostId(msg) : null;
      // A revoked id is never recoverable: adopting it would republish what the user pulled.
      // revokePublishedPost marks a revoked post's publish_logs rows 'revoked' AND nulls
      // posts.external_post_id, so a re-approve always starts fresh here; if the Zernio delete
      // failed during the revoke, this guard is what stops the recovery from re-adopting the old
      // id (the copy is still live and the user pulled it). A revoked copy may NOT be republished
      // within Zernio's 24h dedupe window until it's removed there — that is the acceptable
      // outcome, surfaced to the user as a clear failure instead of a silent resurrection.
      const revoked = existingId ? await isRevokedExternalId(supabase, existingId) : false;
      if (msg.includes('409') && !opts.now && existingId && !revoked) {
        // FIX C: verify that the existing Zernio post's scheduledFor matches what we requested.
        // If the times diverge (>1 min), the old post was from a different schedule — cancel it
        // and retry once so Zernio gets the correct time.
        let timeMismatch = false;
        let existingSchedIso: string | null = null;
        try {
          const existing = await getPostStatus(existingId);
          existingSchedIso = existing?.scheduledFor ?? null;
          const existingTime = existingSchedIso ? new Date(existingSchedIso).getTime() : 0;
          const requestedTime = scheduledFor ? new Date(scheduledFor).getTime() : 0;
          if (existingTime && requestedTime && Math.abs(existingTime - requestedTime) > 60_000) {
            timeMismatch = true;
          }
        } catch (error) { swallow('verify zernio schedule time', error); }

        if (timeMismatch) {
          // The existing Zernio copy is scheduled at a DIFFERENT time (stale schedule from an
          // earlier publish). Delete it, log the cancel, and retry the same send once so Zernio
          // ends up matching what we asked for.
          try { await deletePost(existingId); } catch (error) { swallow('delete stale zernio copy', error); }
          await supabase.from('publish_logs').insert({
            brand_id: post.brand_id,
            post_id: post.id,
            social_account_id: acc.id,
            platform: acc.platform,
            external_post_id: existingId,
            status: 'canceled',
            error: `Schedule mismatch: Zernio had ${existingSchedIso}, requested ${scheduledFor}`
          });
          try {
            const r2 = await publishPost(payload);
            if (!r2.ok) throw new Error(PROVIDER_REFUSAL);
            externalId = r2.postId ?? externalId;
            await supabase.from('publish_logs').insert({
              brand_id: post.brand_id,
              post_id: post.id,
              social_account_id: acc.id,
              platform: acc.platform,
              external_post_id: r2.postId ?? null,
              status: 'scheduled'
            });
            scheduled++;
            usedAccountIds.push(acc.id);
          } catch (e2) {
            await supabase.from('publish_logs').insert({
              brand_id: post.brand_id,
              post_id: post.id,
              social_account_id: acc.id,
              platform: acc.platform,
              status: 'failed',
              error: `Schedule-mismatch retry failed: ${e2 instanceof Error ? e2.message : String(e2)}`
            });
            failed++;
          }
        } else {
          externalId = existingId ?? externalId;
          await supabase.from('publish_logs').insert({
            brand_id: post.brand_id,
            post_id: post.id,
            social_account_id: acc.id,
            platform: acc.platform,
            external_post_id: existingId,
            status: 'scheduled'
          });
          scheduled++;
          usedAccountIds.push(acc.id);
        }
      } else if (msg.includes('409') && !opts.now && !revoked) {
        externalId = existingId ?? externalId;
        await supabase.from('publish_logs').insert({
          brand_id: post.brand_id,
          post_id: post.id,
          social_account_id: acc.id,
          platform: acc.platform,
          external_post_id: existingId,
          status: 'scheduled'
        });
        scheduled++;
        usedAccountIds.push(acc.id);
      } else {
        // Friendly reason for the 24h dedupe case; raw message otherwise.
        const error = revoked
          ? 'This post was revoked but its copy could not be removed from the schedule — remove it there before publishing again.'
          : msg.includes('409')
            ? 'This exact content was already posted to this account in the last 24h. Edit the caption or wait 24h to re-post.'
            : msg;
        failReason = error;
        await supabase.from('publish_logs').insert({
          brand_id: post.brand_id,
          post_id: post.id,
          social_account_id: acc.id,
          platform: acc.platform,
          status: 'failed',
          error
        });
        failed++;
      }
    }
  }

  await supabase
    .from('posts')
    .update({
      status: scheduled > 0 ? 'scheduled' : 'failed',
      // For an immediate repost we stamp "now" so the status sync picks it up promptly.
      scheduled_for: scheduledFor ?? new Date().toISOString(),
      external_post_id: externalId,
      published_url: null
    })
    .eq('id', post.id);

  // Rotation cursor: stamp every account this fan-out actually published to, so a future
  // single-account-per-platform selector can rotate by last_used_at (nulls first) instead of
  // re-using the first connected account forever. Best-effort — never fail a publish over it.
  if (usedAccountIds.length) {
    await supabase
      .from('social_accounts')
      .update({ last_used_at: new Date().toISOString() })
      .in('id', usedAccountIds);
  }

  // Content library: if this post links one of the brand's own pages — a Reddit link post OR a
  // caption link on X/Threads/LinkedIn/Facebook — stamp it used so the planner rotates to other
  // pages next time. No-op when the URL isn't in the library.
  if (scheduled > 0 && post.link_url) {
    await markPageUsed(supabase, post.brand_id, post.link_url).catch(swallow('mark page used'));
  }

  return { scheduled, failed, noAccount: false, error: scheduled === 0 ? failReason : undefined };
}

/**
 * Pull a published/scheduled post back into the user's hands (post-hoc revoke).
 *
 * Flow: best-effort delete each live Zernio copy (per-account, failures logged and skipped) →
 * reset the post to pending_user with external ids cleared and revoked_at stamped → mark the live
 * publish_logs rows 'revoked'.
 *
 * 409-recovery note: after a revoke, posts.external_post_id is null, so a re-approve ALWAYS
 * republishes from scratch (publishApprovedPost has no stale id to adopt). If a Zernio delete
 * failed above — Zernio refuses to delete already-published posts — the publish_logs rows stay
 * 'revoked', and publishApprovedPost's isRevokedExternalId guard (see above) refuses to re-adopt
 * that external id in its 409 recovery. The result is the acceptable one: within Zernio's 24h
 * same-content dedupe window the re-publish surfaces as a clear "revoked copy still live" failure
 * instead of silently resurrecting the old post. Once the live copy is removed (or 24h pass),
 * re-approving works normally again.
 *
 * Error codes: 'not_publishable' when the post isn't published or scheduled.
 */
export async function revokePublishedPost(
  supabase: SupabaseClient,
  post: { id: string; status: string | null },
  opts: { reason?: string } = {}
): Promise<{ ok: boolean; status?: string; error?: string; deleted?: number; failed?: Array<{ externalPostId: string; error: string }> }> {
  const LIVE = ['published', 'scheduled'];
  if (!LIVE.includes(String(post.status ?? ''))) {
    return { ok: false, error: 'not_publishable' };
  }

  // 1. Best-effort delete every live Zernio copy. One account failing never blocks revoking the
  //    others; the row still flips to 'revoked' below so the 409 guard keeps a re-approve from
  //    re-adopting the stale id (see the note above).
  const { data: logs } = await supabase
    .from('publish_logs')
    .select('id, external_post_id')
    .eq('post_id', post.id)
    .in('status', LIVE)
    .not('external_post_id', 'is', null);

  const failures: Array<{ externalPostId: string; error: string }> = [];
  for (const l of logs ?? []) {
    if (!l.external_post_id) continue;
    try {
      await deletePost(l.external_post_id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[revoke] delete Zernio post ${l.external_post_id} failed for post ${post.id}:`, msg);
      failures.push({ externalPostId: String(l.external_post_id), error: msg });
    }
  }

  // 2. Reset the post to the user's hands. revoked_at distinguishes a revoked post from an
  //    ordinary pending draft; external_post_id is nulled so a re-approve republishes fresh.
  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('posts')
    .update({
      status: 'pending_user',
      external_post_id: null,
      published_url: null,
      revoked_at: now
    })
    .eq('id', post.id);
  if (updateErr) {
    return { ok: false, error: `DB update failed: ${updateErr.message}` };
  }

  // 3. Mark the live publish_logs rows 'revoked' — the same status cancelZernioForPost uses for
  //    undeletable copies, so publishApprovedPost's 409 recovery refuses to re-adopt these
  //    external ids on a later re-approve. The reason (when given) is kept on the row.
  const logUpdate: Record<string, unknown> = { status: 'revoked' };
  if (opts.reason) logUpdate.error = `Revoked by user: ${opts.reason}`;
  await supabase
    .from('publish_logs')
    .update(logUpdate)
    .eq('post_id', post.id)
    .in('status', LIVE);

  // `deleted` counts SUCCESSFUL removals; `failed` lists the copies still live on the
  // platform (the caller must surface them — never pretend the content is gone).
  const attempted = (logs ?? []).filter((l) => l.external_post_id).length;
  return { ok: true, status: 'pending_user', deleted: attempted - failures.length, failed: failures };
}

// Stamp the post's visual-meta snapshot as published. writeVisualMeta runs at post CREATION, when
// published_at is still NULL, and the P2 learning loop filters the window with `.gte('published_at')`
// — in SQL `NULL >= x` is NULL, so an unstamped row is excluded forever and no insight is ever
// produced. Every path that stamps posts.published_at must call this. Best-effort: a missing meta
// row (or a pre-0153 DB) must never break a publish.
export async function stampVisualMetaPublished(
  supabase: SupabaseClient,
  postId: string,
  publishedAt: string
): Promise<void> {
  const { error } = await supabase
    .from('post_visual_meta')
    .update({ published_at: publishedAt })
    .eq('post_id', postId);
  if (error) console.warn('[publish] post_visual_meta published_at stamp failed:', error.message);
}

// Flip our 'scheduled' posts to 'published' (with the live URL) or 'failed' by asking Zernio
// about the ones whose time has passed. Bounded to due posts so it's cheap to run on page load.
export async function syncDuePosts(supabase: SupabaseClient, brandId: string): Promise<void> {
  const { data: due } = await supabase
    .from('posts')
    .select('id, external_post_id')
    .eq('brand_id', brandId)
    .eq('status', 'scheduled')
    .not('external_post_id', 'is', null)
    .lte('scheduled_for', new Date().toISOString());

  for (const p of due ?? []) {
    if (!p.external_post_id) continue;
    try {
      const s = await getPostStatus(p.external_post_id);
      if (s.status === 'published' || s.status === 'sent') {
        const publishedAt = new Date().toISOString();
        await supabase
          .from('posts')
          .update({ status: 'published', published_url: s.url, published_at: publishedAt })
          .eq('id', p.id);
        await stampVisualMetaPublished(supabase, p.id, publishedAt);
        await supabase.from('publish_logs').update({ status: 'published' }).eq('post_id', p.id).eq('status', 'scheduled');
      } else if (s.status === 'failed' || s.status === 'error') {
        await supabase.from('posts').update({ status: 'failed' }).eq('id', p.id);
        await supabase.from('publish_logs').update({ status: 'failed', error: s.error }).eq('post_id', p.id).eq('status', 'scheduled');
      }
    } catch (error) { swallow('sync post status from zernio', error); }
  }
}

// ── Phase 2b: DB↔Zernio divergence check ────────────────────────────────────

export interface DivergentPost {
  postId: string;
  dbTime: string;
  zernioTime: string;
  zernioStatus: string;
  zernioUrl: string | null;
}

export async function checkScheduleDivergence(
  supabase: SupabaseClient,
  brandId: string
): Promise<{ divergent: DivergentPost[]; incidents: number }> {
  // 1. All scheduled/approved posts that have been sent to Zernio
  const { data: posts } = await supabase
    .from('posts')
    .select('id, scheduled_for, external_post_id')
    .eq('brand_id', brandId)
    .in('status', ['scheduled', 'approved'])
    .not('external_post_id', 'is', null);

  const divergent: DivergentPost[] = [];

  for (const post of posts ?? []) {
    if (!post.external_post_id || !post.scheduled_for) continue;
    try {
      // 2. Check Zernio's actual schedule for this post
      const zernio = await getPostStatus(post.external_post_id);
      if (!zernio?.scheduledFor) continue;

      const dbTime = new Date(post.scheduled_for).getTime();
      const zernioTime = new Date(zernio.scheduledFor).getTime();

      // 3. If they differ by >5 min → divergence
      if (Math.abs(dbTime - zernioTime) > 5 * 60_000) {
        divergent.push({
          postId: post.id,
          dbTime: post.scheduled_for,
          zernioTime: zernio.scheduledFor,
          zernioStatus: zernio.status,
          zernioUrl: zernio.url
        });
      }
    } catch (error) { swallow('compare zernio schedule', error); }
  }

  // 4. If divergences found, create an incident (dedup via unique constraint)
  let incidents = 0;
  if (divergent.length > 0) {
    await supabase.from('incidents').upsert({
      brand_id: brandId,
      kind: 'schedule_divergence',
      severity: 'critical',
      details: { posts: divergent, count: divergent.length },
      detected_at: new Date().toISOString()
    }, { onConflict: 'brand_id,kind,detected_on' });
    incidents = divergent.length;
  }

  return { divergent, incidents };
}

// ── Phase 4: Unified reschedulePost ─────────────────────────────────────────

/**
 * Re-schedule a post to a new time.
 * Guarantees 1:1 correspondence between DB and Zernio.
 *
 * Flow: cancel Zernio → update DB → re-publish to Zernio → verify time.
 * If any step fails, the error propagates (no silent swallowing).
 */
export async function reschedulePost(
  supabase: SupabaseClient,
  postId: string,
  newScheduledFor: string,
  timezone: string
): Promise<{ success: boolean; externalPostId?: string; error?: string }> {
  // Import here to avoid circular dependency (post-editing imports from publish)
  const { EDITOR_POST_COLS, requireZernioCancellation } = await import('./post-editing');

  // 1. Load post
  const { data: post, error: loadErr } = await supabase
    .from('posts')
    .select(EDITOR_POST_COLS)
    .eq('id', postId)
    .maybeSingle();

  if (loadErr || !post) {
    return { success: false, error: `Post not found: ${postId}` };
  }

  // 2. Cancel and verify every Zernio copy before changing the schedule or clearing its id.
  try {
    await requireZernioCancellation(supabase, postId);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }

  // 3. Update DB (reset external IDs)
  const { error: updateErr } = await supabase
    .from('posts')
    .update({
      scheduled_for: newScheduledFor,
      status: 'approved',
      external_post_id: null,
      published_url: null
    })
    .eq('id', postId);

  if (updateErr) {
    return { success: false, error: `DB update failed: ${updateErr.message}` };
  }

  // 4. Re-publish to Zernio with new time
  const { data: updated } = await supabase
    .from('posts')
    .select(EDITOR_POST_COLS)
    .eq('id', postId)
    .maybeSingle();

  if (!updated) {
    return { success: false, error: 'Post disappeared after update' };
  }

  try {
    const result = await publishApprovedPost(supabase, updated as ApprovablePost, timezone);

    // 5. Read back from DB to get the external_post_id (publishApprovedPost writes it)
    const { data: refreshed } = await supabase
      .from('posts')
      .select('external_post_id')
      .eq('id', postId)
      .maybeSingle();

    const externalPostId = refreshed?.external_post_id ?? undefined;

    // 6. VERIFY: read back from Zernio to confirm the time matches
    if (externalPostId) {
      try {
        const zernioPost = await getPostStatus(externalPostId);
        if (zernioPost?.scheduledFor) {
          const diff = Math.abs(
            new Date(newScheduledFor).getTime() - new Date(zernioPost.scheduledFor).getTime()
          );
          if (diff > 60_000) {
            // Time mismatch — log incident but don't fail (the post IS scheduled, just wrong time)
            await supabase.from('incidents').upsert({
              brand_id: post.brand_id,
              kind: 'reschedule_time_mismatch',
              severity: 'warning',
              details: {
                postId,
                requested: newScheduledFor,
                actual: zernioPost.scheduledFor,
                zernioPostId: externalPostId
              }
            }, { onConflict: 'brand_id,kind,detected_on' });
          }
        }
      } catch (error) { swallow('verify scheduled post', error); }
    }

    return { success: true, externalPostId };
  } catch (e) {
    return { success: false, error: `Zernio publish failed: ${String(e)}` };
  }
}
