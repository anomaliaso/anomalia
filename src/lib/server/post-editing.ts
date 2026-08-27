import { swallow } from '$lib/server/swallow';
import { fail } from '@sveltejs/kit';
import type { Actions } from '@sveltejs/kit';
import { publishApprovedPost, type ApprovablePost } from '$lib/server/publish';
import { deletePost, getPostStatus } from '$lib/server/zernio';
import { nextOccurrence, wallClockToUtc, startOfWeek } from '$lib/server/schedule';
import { learnFromCaptionEdit } from '$lib/server/brand-memory';
import { ALT_CAPTION_PLATFORMS, ensureShortNetworkCuts } from '$lib/platform-limits';

// Columns the shared post editor (caption + scheduling + status actions) needs.
// Intentionally omits video_task_id / video_resolution — those are publish-only (see
// upscaleApprovedClip) and must not break every post read when migration 0127 is pending.
// youtube_thumbnail_url requires migration 0171 applied first.
export const EDITOR_POST_COLS =
  'id, brand_id, platform, platforms, caption, platform_captions, title, link_url, subreddit, image_prompt, image_prompts, slot, media_url, media_urls, status, content_type, scheduled_for, published_url, external_post_id, product_name, revisions_count, pillar, format, plan_row_id, angle, needs_attention, attention_reason, source_url, source, video_thumbnail_url, youtube_thumbnail_url, updated_at';

// A picked time must be at least this far in the future (Zernio needs a future instant).
const MIN_LEAD_MS = 2 * 60 * 1000;
// Floor "now" to the start of the current minute first, because the time picker is minute-granular.
const earliestMs = () => Math.floor(Date.now() / 60000) * 60000 + MIN_LEAD_MS;

// YYYY-MM-DD of a UTC instant as seen in `tz` (Intl-only, no date lib).
export function dayKeyOf(iso: string, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
}

// Decorate raw post rows with the concrete instant (whenISO) + its day key in the brand tz.
export function decoratePosts<T extends { scheduled_for?: string | null; slot?: string | null }>(
  rows: T[],
  tz: string,
  now: Date
): Array<T & { whenISO: string; dayKey: string; weekOf: string; planRowId: string | null }> {
  return rows.map((p) => {
    const whenISO = (p.scheduled_for as string) || nextOccurrence(p.slot ?? null, tz, now);
    return {
      ...p,
      whenISO,
      dayKey: dayKeyOf(whenISO, tz),
      // Monday-of-week key (brand tz) — same util the calendar uses, so the projection groups alike.
      weekOf: startOfWeek(whenISO, tz),
      // Reference to the plan ROW (seed) that generated this post; null for fresh/legacy posts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      planRowId: ((p as any).plan_row_id as string | null) ?? null
    };
  });
}

// Per-day post counts so the reschedule calendar can show where posts already land.
export function buildBusyDays(posts: Array<{ dayKey: string }>): Record<string, number> {
  const busyDays: Record<string, number> = {};
  for (const p of posts) busyDays[p.dayKey] = (busyDays[p.dayKey] ?? 0) + 1;
  return busyDays;
}

// Build a patch from the editor's caption / slot / exact date+time fields. Returns null on a
// past time (so the action can reject it). With opts.ignoreSchedule the time fields are skipped
// entirely (used by "publish now", which doesn't care about the schedule and must never reject).
function editPatchFrom(
  data: FormData,
  tz: string,
  opts: { ignoreSchedule?: boolean } = {}
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const caption = data.get('caption');
  if (typeof caption === 'string') patch.caption = caption;
  const title = data.get('title');
  if (typeof title === 'string' && title.trim()) patch.title = title.trim();
  const linkUrl = data.get('link_url');
  if (typeof linkUrl === 'string') patch.link_url = linkUrl.trim() || null;
  const subreddit = data.get('subreddit');
  if (typeof subreddit === 'string' && subreddit.trim()) patch.subreddit = subreddit.trim();
  // The editor commits the version the user picked: media (empty → text-only/no image), its prompt,
  // and content_type. Sent on every edit; for un-regenerated posts these carry the original values.
  const media = data.get('media_url');
  if (typeof media === 'string') patch.media_url = media || null;
  const imagePrompt = data.get('image_prompt');
  if (typeof imagePrompt === 'string') patch.image_prompt = imagePrompt;
  const contentType = data.get('content_type');
  if (typeof contentType === 'string' && contentType) patch.content_type = contentType;
  // YouTube custom 16:9 cover — independent of video_thumbnail_url (the 9:16 clip frame).
  // Empty string clears it. Absent field leaves the stored value (non-YouTube saves).
  const ytThumb = data.get('youtube_thumbnail_url');
  if (typeof ytThumb === 'string') patch.youtube_thumbnail_url = ytThumb.trim() || null;
  // Cross-post target platforms — comma-joined list from the editor's picker. Empty → null (publish
  // only to the post's primary platform).
  const platforms = data.get('platforms');
  if (typeof platforms === 'string') {
    const list = platforms.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
    patch.platforms = list.length ? Array.from(new Set(list)) : null;
  }
  // Per-platform caption overrides — one field per short network (`caption_x`, `caption_threads`).
  // Blank clears that platform's cut (it falls back to the main caption); no keys left → null.
  const overrides: Record<string, string> = {};
  let sawOverride = false;
  for (const p of ALT_CAPTION_PLATFORMS) {
    const v = data.get(`caption_${p}`);
    if (typeof v !== 'string') continue;
    sawOverride = true;
    if (v.trim()) overrides[p] = v.trim();
  }
  if (sawOverride) patch.platform_captions = Object.keys(overrides).length ? overrides : null;

  // Fill missing short-network cuts when the form targets X/Threads. Expanding platforms without
  // writing overrides used to ship the full IG caption and fail publish on the char limit.
  if (typeof patch.caption === 'string' && Array.isArray(patch.platforms)) {
    const ensured = ensureShortNetworkCuts(
      patch.caption as string,
      patch.platforms as string[],
      (patch.platform_captions as Record<string, string> | null | undefined) ?? null
    );
    if (ensured) patch.platform_captions = ensured;
  }

  const slot = String(data.get('slot') ?? '').trim();
  if (slot) patch.slot = slot;
  if (opts.ignoreSchedule) return patch; // publish-now: keep content edits, drop the schedule
  const date = String(data.get('date') ?? '').trim();
  const time = String(data.get('time') ?? '').trim();
  if (date && time) {
    const iso = wallClockToUtc(date, time, tz);
    if (new Date(iso).getTime() < earliestMs()) return null; // too soon (< ~2 min)
    patch.scheduled_for = iso;
  }
  return patch;
}

// L'edit dell'owner insegna solo se è una RISCRITTURA, non un refuso: sotto questa similarità
// (Jaccard su token, come detectSceneCollapse) o con un delta minimo di lunghezza la coppia
// prima→dopo non porta gusto, solo rumore — e tre coppie-refuso scaccerebbero dal jsonb le tre
// riscritture vere che il writer deve assorbire. Pure + esportata per i test.
export function isMeaningfulCaptionEdit(before: string, after: string): boolean {
  const a = String(before ?? '').trim();
  const b = String(after ?? '').trim();
  if (!a || !b || a === b || b.length < 10) return false;
  if (Math.abs(a.length - b.length) > 60) return true; // taglio/allungamento netto: sempre gusto
  const tok = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean));
  const ta = tok(a);
  const tb = tok(b);
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter) < 0.9; // ≥0.9 = correzione di refusi/date, non stile
}

// La coppia prima→dopo finisce in content_prefs.captionEditPairs (jsonb esistente — mai una
// tabella nuova, le migration non girano al deploy), lo stesso loop di radar.editPairs ma per le
// caption dei post: executePlan e il produce agent la rileggono come esempio concreto
// (ownerEditPairsBlock). Best-effort: non deve mai far fallire il salvataggio dell'edit.
// ponytail: read-modify-write senza lock, come radar — gli edit manuali sono rari, un conflitto
// perde al massimo una coppia di learning, mai dati dell'utente.
async function captureCaptionEditPair(brandId: string, before: string, after: string): Promise<void> {
  if (!isMeaningfulCaptionEdit(before, after)) return;
  try {
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const admin = createAdminClient();
    const { data: b } = await admin.from('brands').select('content_prefs').eq('id', brandId).maybeSingle();
    const cp = (b?.content_prefs ?? {}) as Record<string, unknown>;
    const prev = Array.isArray(cp.captionEditPairs) ? cp.captionEditPairs : [];
    const pairs = [
      ...prev,
      { before: before.slice(0, 600), after: after.slice(0, 600), at: new Date().toISOString() }
    ].slice(-5); // ne bastano 5: il writer ne legge 3, e il jsonb non deve crescere per sempre
    await admin.from('brands').update({ content_prefs: { ...cp, captionEditPairs: pairs } }).eq('id', brandId);
  } catch (e) {
    console.warn('[post-editing] captionEditPairs capture failed:', e instanceof Error ? e.message : e);
  }
}

// Apply the editor's patch to a post — and when the patch CHANGES the caption of an AI-written
// post, learn from the user's diff (fire-and-forget): the edit is the purest voice signal the
// brand ever gives, and it feeds every future prompt via brand memory. Shared by every edit path
// (Approvals/Content actions and the CLI PATCH endpoint) so no edit is ever wasted as a signal.
export async function applyPostEdits(
  supabase: App.Locals['supabase'],
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  patch: Record<string, any>,
  opts?: { origin?: string }
) {
  const wantsCaptionLearn = typeof patch.caption === 'string' && patch.caption.trim();
  const wantsMedia = 'media_url' in patch || 'media_urls' in patch;
  let before: {
    brand_id: string;
    caption: string | null;
    source: string | null;
    media_url: string | null;
    media_urls: unknown;
  } | null = null;
  if (wantsCaptionLearn || wantsMedia) {
    const { data } = await supabase
      .from('posts')
      .select('brand_id, caption, source, media_url, media_urls')
      .eq('id', id)
      .maybeSingle();
    before = data;
  }
  if (
    wantsCaptionLearn &&
    before &&
    before.source === 'plan' &&
    String(before.caption ?? '').trim() &&
    String(before.caption).trim() !== patch.caption.trim()
  ) {
    void learnFromCaptionEdit(supabase, before.brand_id, before.caption as string, patch.caption).catch(swallow('learn caption edit'));
    // Due destinazioni per lo stesso segnale: brand_memory riceve la REGOLA astratta (sopra),
    // captionEditPairs conserva l'ESEMPIO concreto prima→dopo che i writer citano nel prompt.
    void captureCaptionEditPair(before.brand_id, String(before.caption), String(patch.caption)).catch(swallow('String failed'));
  }
  const result = await supabase.from('posts').update(patch).eq('id', id);
  if (!result.error && wantsMedia && before?.brand_id) {
    const { postMediaChanged, requestPostMediaReview } = await import('$lib/server/video-review-store');
    if (postMediaChanged(before, patch)) {
      await requestPostMediaReview(supabase, {
        brandId: before.brand_id,
        postId: id,
        origin: opts?.origin,
        force: true
      });
    }
  }
  return result;
}

async function brandTz(supabase: App.Locals['supabase'], slug: string | undefined): Promise<string> {
  const { data } = await supabase.from('brands').select('timezone').eq('slug', slug ?? '').maybeSingle();
  return data?.timezone ?? 'Europe/Rome';
}

// Cancel a post's currently-live Zernio schedule(s) so we can re-publish (or unschedule) it. Only
// SCHEDULED copies are deletable — Zernio refuses to delete already-published posts ("Published posts
// cannot be deleted"), and its 24h same-content+same-account dedupe blocks re-posting them anyway
// (that case surfaces as a `failed` publish with the reason, see publishApprovedPost).
export type ZernioCancellationFailure = { externalPostId: string; error: string };
export type ZernioCancellationResult = { undeleted: ZernioCancellationFailure[] };

const ZERNIO_DELETE_ATTEMPTS = 3;
const ZERNIO_DELETE_RETRY_MS = 250;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isZernioPostNotFound(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes('post_not_found') || /zernio\s+404\b/.test(message);
}

// A deleted post normally disappears (GET → 404), but Zernio also answers 200 with a terminal
// status for a copy it has already torn down. Reading that as "still live" would make every
// cancellation fail, so terminal statuses count as gone — same list publish.ts treats as dead.
const ZERNIO_GONE_STATUSES = new Set(['deleted', 'canceled', 'cancelled', 'removed', 'not_found']);

function isZernioGoneStatus(status: string): boolean {
  return ZERNIO_GONE_STATUSES.has(status.trim().toLowerCase());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function zernioCancellationError(result: ZernioCancellationResult): string | null {
  if (!result.undeleted.length) return null;
  const details = result.undeleted.map(({ externalPostId, error }) => `${externalPostId} (${error})`).join(', ');
  return `Could not cancel the live Zernio post(s): ${details}. Remove them manually before continuing.`;
}

async function cancelAndVerifyZernioPost(externalPostId: string): Promise<string | null> {
  let lastError = 'Zernio cancellation could not be confirmed';
  for (let attempt = 1; attempt <= ZERNIO_DELETE_ATTEMPTS; attempt++) {
    let deleteError: string | null = null;
    try {
      await deletePost(externalPostId);
    } catch (error) {
      deleteError = errorMessage(error);
      lastError = deleteError;
    }

    try {
      const remote = await getPostStatus(externalPostId);
      if (isZernioGoneStatus(remote.status)) return null;
      const stillLive = `Zernio post is still ${remote.status}`;
      lastError = deleteError ? `${deleteError}; ${stillLive}` : stillLive;
    } catch (error) {
      if (isZernioPostNotFound(error)) return null;
      lastError = `${lastError}; verification failed: ${errorMessage(error)}`;
    }

    if (attempt < ZERNIO_DELETE_ATTEMPTS) await sleep(ZERNIO_DELETE_RETRY_MS * attempt);
  }
  return lastError;
}

export async function cancelZernioForPost(
  supabase: App.Locals['supabase'],
  postId: string
): Promise<ZernioCancellationResult> {
  const { data: logs } = await supabase
    .from('publish_logs')
    .select('external_post_id')
    .eq('post_id', postId)
    .eq('status', 'scheduled')
    .not('external_post_id', 'is', null);
  // posts.external_post_id is the fallback when publish_logs lost the row, but only while the
  // post is still SCHEDULED: it survives a successful publish too, and Zernio refuses to delete a
  // published copy — including it unconditionally would make `repost` (offered on every published
  // post) fail forever instead of falling through to the 24h-dedupe path it is written against.
  const { data: post } = await supabase
    .from('posts')
    .select('status, external_post_id')
    .eq('id', postId)
    .maybeSingle();
  const postScheduledId = post?.status === 'scheduled' ? post.external_post_id : null;
  const undeleted: ZernioCancellationFailure[] = [];
  const externalPostIds = [
    ...new Set(
      [...(logs ?? []).map((l) => l.external_post_id), postScheduledId]
        .filter((id): id is string => Boolean(id))
    )
  ];
  for (const externalPostId of externalPostIds) {
    const error = await cancelAndVerifyZernioPost(externalPostId);
    if (error) undeleted.push({ externalPostId, error });
  }
  await supabase.from('publish_logs').update({ status: 'canceled' }).eq('post_id', postId).eq('status', 'scheduled');
  // Mark the ids we could NOT delete as revoked, so publishApprovedPost's 409 recovery refuses to
  // re-adopt them: within Zernio's 24h dedupe window a re-approve gets the same external id back,
  // and adopting it would silently resurrect the post the user just revoked.
  for (const failure of undeleted) {
    await supabase
      .from('publish_logs')
      .update({
        status: 'revoked',
        error: `Revoked by the user but the Zernio delete failed: ${failure.error} — this external post must not be re-adopted.`
      })
      .eq('post_id', postId)
      .eq('external_post_id', failure.externalPostId);
  }
  return { undeleted };
}

export async function requireZernioCancellation(
  supabase: App.Locals['supabase'],
  postId: string
): Promise<ZernioCancellationResult> {
  const result = await cancelZernioForPost(supabase, postId);
  const error = zernioCancellationError(result);
  if (error) throw new Error(error);
  return result;
}

// Esito condiviso di "elimina un post". Ogni superficie che cancella una riga di `posts`
// (reject dell'editor, calendario, piano, API) passa da qui.
export type PostDeletionResult =
  | { ok: true; wasScheduled: boolean }
  | { ok: false; status: 400 | 404 | 500 | 502; message: string };

// Cancellare la riga senza revocare Zernio lasciava la schedulazione VIVA: il post spariva
// dall'app e usciva lo stesso, senza più nessuna riga a raccontarlo — la classe
// dell'incidente scheduling di luglio 2026 (stessa chiusura di reject_post nella chat).
// La revoca viene PRIMA della delete, e se fallisce la riga NON viene toccata: meglio un
// post visibile e bloccato che una pubblicazione fantasma.
export async function deletePostCancellingZernio(
  supabase: App.Locals['supabase'],
  postId: string,
  brandId?: string
): Promise<PostDeletionResult> {
  let query = supabase.from('posts').select('id, brand_id, platform, status').eq('id', postId);
  if (brandId) query = query.eq('brand_id', brandId);
  const { data: post } = await query.maybeSingle();
  if (!post) return { ok: false, status: 404, message: 'Post not found' };
  if (post.status === 'published') {
    return {
      ok: false,
      status: 400,
      message: 'Post already published — deleting it cannot un-publish it. Nothing was deleted.'
    };
  }
  const wasScheduled = post.status === 'scheduled' || post.status === 'approved';
  if (wasScheduled) {
    try {
      await requireZernioCancellation(supabase, postId);
    } catch (e) {
      return {
        ok: false,
        status: 502,
        message: `Could not cancel the live schedule — the post was NOT deleted: ${e instanceof Error ? e.message : String(e)}`
      };
    }
    // La riga di audit si scrive solo DOPO la revoca riuscita: il calendario la scriveva
    // comunque, dichiarando nel log una cancellazione mai avvenuta.
    await supabase.from('publish_logs').insert({
      brand_id: post.brand_id,
      post_id: post.id,
      platform: post.platform,
      status: 'canceled',
      error: 'Post deleted by user — schedule canceled.'
    });
  }
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) return { ok: false, status: 500, message: error.message };
  return { ok: true, wasScheduled };
}

// The shared post-editor actions — used by both Approvals and Content. Spread into each page's
// `export const actions`. Both pages render the same <PostEditor> whose forms POST to these.
export const editorActions: Actions = {
  // Edit caption and/or schedule (exact day+time). RLS scopes by brand.
  updatePost: async ({ request, params, url, locals: { supabase } }) => {
    const data = await request.formData();
    const id = String(data.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing post' });

    const patch = editPatchFrom(data, await brandTz(supabase, params.brand));
    if (patch === null) return fail(400, { error: 'Pick a time at least 2 minutes from now.' });
    const { error } = await applyPostEdits(supabase, id, patch, { origin: url.origin });
    if (error) return fail(500, { error: error.message });
    return { saved: true };
  },

  // Reschedule an already-scheduled post: apply edits, cancel the live Zernio post, re-publish.
  reschedule: async ({ request, params, url, locals: { supabase } }) => {
    const data = await request.formData();
    const id = String(data.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing post' });

    const tz = await brandTz(supabase, params.brand);
    const patch = editPatchFrom(data, tz);
    if (patch === null) return fail(400, { error: 'Pick a time at least 2 minutes from now.' });
    const cancellation = await cancelZernioForPost(supabase, id);
    const cancellationError = zernioCancellationError(cancellation);
    if (cancellationError) return fail(502, { error: cancellationError });

    if (Object.keys(patch).length) await applyPostEdits(supabase, id, patch, { origin: url.origin });

    const { data: post } = await supabase.from('posts').select(EDITOR_POST_COLS).eq('id', id).maybeSingle();
    if (!post) return fail(404, { error: 'Post not found' });
    const res = await publishApprovedPost(supabase, post as ApprovablePost, tz);
    return { ok: true, noAccount: res.noAccount };
  },

  // Cancel a scheduled post → pull it from Zernio and return it to a draft for further editing.
  cancelSchedule: async ({ request, locals: { supabase } }) => {
    const data = await request.formData();
    const id = String(data.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing post' });
    const cancellation = await cancelZernioForPost(supabase, id);
    const cancellationError = zernioCancellationError(cancellation);
    if (cancellationError) return fail(502, { error: cancellationError });
    await supabase.from('posts').update({ status: 'pending_user', external_post_id: null, scheduled_for: null }).eq('id', id);
    return { saved: true };
  },

  // Something went wrong with a publish → log the user's note and repost immediately.
  repost: async ({ request, params, locals: { supabase } }) => {
    const data = await request.formData();
    const id = String(data.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing post' });
    const note = String(data.get('note') ?? '').trim();

    const tz = await brandTz(supabase, params.brand);
    const { data: post } = await supabase.from('posts').select(EDITOR_POST_COLS).eq('id', id).maybeSingle();
    if (!post) return fail(404, { error: 'Post not found' });

    if (note) {
      await supabase.from('publish_logs').insert({
        brand_id: post.brand_id,
        post_id: id,
        platform: post.platform,
        status: 'reported',
        error: note
      });
    }
    // Remove the live/scheduled Zernio copy first, else Zernio's 24h same-content dedupe 409s and
    // publishApprovedPost swallows it as "already out there" — the repost silently no-ops.
    const cancellation = await cancelZernioForPost(supabase, id);
    const cancellationError = zernioCancellationError(cancellation);
    if (cancellationError) return fail(502, { error: cancellationError });
    const res = await publishApprovedPost(supabase, post as ApprovablePost, tz, { now: true });
    return { ok: true, noAccount: res.noAccount, reposted: true };
  },

  // Reject a draft → delete it (the user chose not to publish this one).
  // Prima cancellava la riga e basta: su un post scheduled/approved la schedulazione Zernio
  // restava viva e il post usciva comunque (classe incidente scheduling luglio 2026).
  reject: async ({ request, locals: { supabase } }) => {
    const data = await request.formData();
    const id = String(data.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing post' });
    const res = await deletePostCancellingZernio(supabase, id);
    if (!res.ok) return fail(res.status, { error: res.message });
    return { rejected: true };
  },

  // Approve = apply edits, then send to Zernio scheduled at the chosen instant.
  approve: async ({ request, params, url, locals: { supabase } }) => {
    const data = await request.formData();
    const id = String(data.get('id') ?? '');
    if (!id) return {};

    const tz = await brandTz(supabase, params.brand);
    const patch = editPatchFrom(data, tz);
    if (patch === null) return fail(400, { error: 'Pick a time at least 2 minutes from now.' });
    if (Object.keys(patch).length) await applyPostEdits(supabase, id, patch, { origin: url.origin });

    const { data: post } = await supabase.from('posts').select(EDITOR_POST_COLS).eq('id', id).maybeSingle();
    if (!post || post.status !== 'pending_user') return {};

    const res = await publishApprovedPost(supabase, post as ApprovablePost, tz);
    return { ok: true, noAccount: res.noAccount };
  },

  // Publish immediately. Cancels any existing scheduled Zernio copy FIRST (so Zernio's 24h
  // same-content-same-account dedupe guard doesn't reject the new send), then publishes now.
  // Works from any editable state (pending / scheduled / failed) and applies pending edits.
  publishNow: async ({ request, params, url, locals: { supabase } }) => {
    const data = await request.formData();
    const id = String(data.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing post' });

    const tz = await brandTz(supabase, params.brand);
    const patch = editPatchFrom(data, tz, { ignoreSchedule: true }) ?? {};
    if (Object.keys(patch).length) await applyPostEdits(supabase, id, patch, { origin: url.origin });

    // Remove the live/scheduled Zernio post (and mark its logs canceled) before re-sending.
    const cancellation = await cancelZernioForPost(supabase, id);
    const cancellationError = zernioCancellationError(cancellation);
    if (cancellationError) return fail(502, { error: cancellationError });

    const { data: post } = await supabase.from('posts').select(EDITOR_POST_COLS).eq('id', id).maybeSingle();
    if (!post) return fail(404, { error: 'Post not found' });

    const res = await publishApprovedPost(supabase, post as ApprovablePost, tz, { now: true });
    return { ok: true, noAccount: res.noAccount };
  },

  requestReview: async ({ request, url, locals: { supabase } }) => {
    const data = await request.formData();
    const id = String(data.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing post' });
    const { data: post } = await supabase.from('posts').select('id, brand_id, media_url').eq('id', id).maybeSingle();
    if (!post) return fail(404, { error: 'Post not found' });
    const { requestPostMediaReview } = await import('$lib/server/video-review-store');
    const r = await requestPostMediaReview(supabase, {
      brandId: post.brand_id,
      postId: id,
      origin: url.origin,
      force: true
    });
    if (!r.queued && r.skippedRunning) return { reviewQueued: 0, skippedRunning: r.skippedRunning };
    if (!r.queued) return fail(400, { error: 'No reviewable media on this post.' });
    return { reviewQueued: r.queued, skippedRunning: r.skippedRunning };
  }
};
