import { json } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import { regeneratePost, loadBrandMoodImageUrls } from '$lib/server/content-preview';
import { signKnowledgePaths } from '$lib/server/media-archive';
import type { RequestHandler } from './$types';
// Regenerating re-renders an image (~tens of seconds), so allow headroom on serverless.
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

// A post may be regenerated from feedback at most this many times. Each revision is a Gemini
// call + a fresh image render (real COGS), so we bound it per post. The post counter itself is
// untouched (a revision refines an existing post, it doesn't create a new one).
const MAX_REVISIONS = 3;

// Regenerate a single post from the user's feedback: revise caption (+ image) and persist.
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const body = await request.json().catch(() => ({}));
  const id = String(body?.id ?? '');
  const feedback = String(body?.feedback ?? '').trim();
  if (!id || !feedback) return json({ error: 'Missing post or feedback' }, { status: 400 });

  // The editor sends the CURRENTLY-VIEWED version (caption/image_prompt/media_url) so iterative
  // feedback refines what the user is looking at — including an already-regenerated version — rather
  // than always restarting from the original DB row. Absent → fall back to the stored post below.
  const clientCaption = typeof body?.caption === 'string' ? body.caption : null;
  const clientImagePrompt = typeof body?.image_prompt === 'string' ? body.image_prompt : null;
  const clientMediaUrl = typeof body?.media_url === 'string' && body.media_url ? body.media_url : null;
  // Reddit-specific fields the editor may send along.
  const clientTitle = typeof body?.title === 'string' ? body.title : null;
  const clientLinkUrl = typeof body?.link_url === 'string' ? body.link_url : null;
  const clientSubreddit = typeof body?.subreddit === 'string' ? body.subreddit : null;
  // Reference images the user attached to this revision — base64 data: URLs. Cap to bound payload.
  const uploadedRefs = Array.isArray(body?.referenceImages)
    ? (body.referenceImages as unknown[]).filter((s): s is string => typeof s === 'string' && s.startsWith('data:image/')).slice(0, 4)
    : [];
  // References the user picked from their own library — sent as row IDs (never URLs), resolved to
  // signed URLs below so the client can't make the server fetch an arbitrary host.
  const asIds = (v: unknown) =>
    Array.isArray(v) ? (v as unknown[]).filter((s): s is string => typeof s === 'string' && !!s).slice(0, 4) : [];
  const brandImageIds = asIds(body?.brandImageIds);
  const postThumbIds = asIds(body?.postThumbIds);

  // RLS scopes the row to the caller's brand.
  const { data: post } = await supabase
    .from('posts')
    .select('id, brand_id, platform, caption, image_prompt, media_url, content_type, product_name, revisions_count')
    .eq('id', id)
    .maybeSingle();
  if (!post) return json({ error: 'Post not found' }, { status: 404 });

  // Per-post revision budget: refuse once the post has been revised MAX_REVISIONS times.
  const revisionsUsed = post.revisions_count ?? 0;
  if (revisionsUsed >= MAX_REVISIONS) {
    return json({ error: 'revision_limit', max: MAX_REVISIONS, revisionsLeft: 0 }, { status: 429 });
  }

  // Keep the regenerated image on-brand (visual_style) and faithful to the featured product,
  // and the caption in the brand's chosen language.
  const { data: kit } = await supabase
    .from('brand_kit')
    .select('visual_style, brand_colors, fonts')
    .eq('brand_id', post.brand_id)
    .maybeSingle();
  const { data: brandRow } = await supabase
    .from('brands')
    .select('content_prefs')
    .eq('id', post.brand_id)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prefs = (brandRow?.content_prefs as any) ?? {};
  const language = (prefs?.language as string) ?? null;
  const platformInstructions = (prefs?.platformInstructions as Record<string, string> | undefined) ?? null;
  const platformHashtags = (prefs?.platformHashtags as Record<string, string[]> | undefined) ?? null;
  let productImageUrls: string[] = [];
  if (post.product_name) {
    const { data: prod } = await supabase
      .from('products')
      .select('images')
      .eq('brand_id', post.brand_id)
      .eq('title', post.product_name)
      .maybeSingle();
    if (Array.isArray(prod?.images)) productImageUrls = prod.images.map(String).filter(Boolean);
  }

  // Use what the user currently sees as the basis for the revision, falling back to the stored row.
  const baseCaption = clientCaption ?? post.caption;
  const baseImagePrompt = clientImagePrompt ?? post.image_prompt;
  const baseMediaUrl = clientMediaUrl ?? post.media_url;

  // The brand's mood/reference shots (Studio → Knowledge → Images) anchor the re-render to the
  // brand's aesthetic, same as the batch generator. Skipped for text-only and link posts (no image).
  const textOnly = post.content_type === 'text' || post.content_type === 'link';
  const moodImageUrls = textOnly ? [] : await loadBrandMoodImageUrls(supabase, post.brand_id);

  // Resolve the user's library picks (brand images + own-post thumbs) to signed/CDN URLs, scoped to
  // this post's brand. Combined with the uploaded data: URLs; the whole set is capped to 4.
  const pickedRefUrls: string[] = [];
  if (!textOnly && brandImageIds.length) {
    const { resolveBrandImageIds } = await import('$lib/server/brand-media');
    pickedRefUrls.push(...(await resolveBrandImageIds(supabase, post.brand_id, brandImageIds)));
  }
  if (!textOnly && postThumbIds.length) {
    const { data } = await supabase.from('social_post_history')
      .select('thumbnail_path, thumbnail_url').in('id', postThumbIds).eq('brand_id', post.brand_id);
    const paths = (data ?? []).map((h) => String(h.thumbnail_path ?? '')).filter(Boolean);
    const m = await signKnowledgePaths(supabase, paths);
    for (const h of data ?? []) {
      const u = (h.thumbnail_path ? m.get(String(h.thumbnail_path)) : null) ?? (h.thumbnail_url ? String(h.thumbnail_url) : null);
      if (u) pickedRefUrls.push(u);
    }
  }
  const userReferenceImageUrls = textOnly ? [] : [...uploadedRefs, ...pickedRefUrls].slice(0, 4);
  const r = await regeneratePost({
    supabase,
    userId: user.id,
    brandId: post.brand_id,
    platform: post.platform,
    caption: baseCaption,
    imagePrompt: baseImagePrompt,
    feedback,
    textOnly,
    baseImageUrl: baseMediaUrl,
    visualStyle: kit?.visual_style ?? null,
    brandColors: Array.isArray(kit?.brand_colors) ? (kit.brand_colors as string[]) : null,
    // brand_kit.fonts is [{name, source}]; pass just the family names.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    brandFonts: Array.isArray(kit?.fonts) ? (kit.fonts as any[]).map((f) => f?.name).filter(Boolean) : null,
    productImageUrls,
    moodImageUrls,
    userReferenceImageUrls,
    language,
    platformInstructions,
    platformHashtags
  });

  // Non-destructive: we do NOT overwrite the post's content here. The new version is returned as a
  // preview; the editor keeps every version client-side and only the one the user picks is persisted
  // on Save/Approve. We just spend one revision (the LLM + render cost is paid regardless of choice).
  const revisionsCount = revisionsUsed + 1;

  // Persist every version to post_revisions so they survive a dialog reopen. On the FIRST
  // regeneration we snapshot the post's current content as version 0 (the original), then store
  // the new version. Subsequent regenerations only append the new version.
  if (revisionsUsed === 0) {
    await supabase.from('post_revisions').upsert(
      {
        post_id: post.id,
        version: 0,
        caption: post.caption,
        image_prompt: post.image_prompt,
        media_url: post.media_url,
        content_type: post.content_type
      },
      { onConflict: 'post_id,version' }
    );
  }
  const newVersion = {
    post_id: post.id,
    version: revisionsCount,
    caption: r.caption,
    image_prompt: r.imagePrompt,
    media_url: r.imageUrl ?? baseMediaUrl,
    content_type: r.imageUrl ? 'generated_image' : post.content_type,
    feedback,
    title: clientTitle,
    link_url: clientLinkUrl,
    subreddit: clientSubreddit
  };
  await supabase.from('post_revisions').upsert(newVersion, { onConflict: 'post_id,version' });

  await supabase
    .from('posts')
    .update({ revisions_count: revisionsCount })
    .eq('id', post.id)
    .eq('brand_id', post.brand_id);

  return json({
    ok: true,
    caption: r.caption,
    image_prompt: r.imagePrompt,
    // No new render (text-only, or render failed) → keep the version's current image.
    media_url: r.imageUrl ?? baseMediaUrl,
    content_type: r.imageUrl ? 'generated_image' : post.content_type,
    revisionsLeft: MAX_REVISIONS - revisionsCount,
    version: revisionsCount,
    title: clientTitle,
    link_url: clientLinkUrl,
    subreddit: clientSubreddit
  });
};

// Fetch all persisted revisions for a post, so the editor can rebuild its version stack when
// reopened (versions are otherwise ephemeral client-side state lost on navigation).
export const GET: RequestHandler = async ({ url, locals: { supabase, safeGetSession } }) => {
  const { session } = await safeGetSession();
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 });

  const id = url.searchParams.get('id') ?? '';
  if (!id) return json({ error: 'Missing id' }, { status: 400 });

  const { data: revisions } = await supabase
    .from('post_revisions')
    .select('version, caption, image_prompt, media_url, content_type, feedback, created_at')
    .eq('post_id', id)
    .order('version', { ascending: true });

  return json({ revisions: revisions ?? [] });
};
