import { GEMINI_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import { json } from '@sveltejs/kit';
import { stepCountIs, type ModelMessage } from 'ai';
import { harnessStreamText } from '$lib/server/harness';
import { env } from '$env/dynamic/private';
import { llmDefaultModel, llmLanguageModel } from '$lib/server/llm';
import { canEnter } from '$lib/server/access';
import { signKnowledgePaths } from '$lib/server/media-archive';
import { createPostEditorTools, loadEditorContext, loadGraphicEditorSystemSuffix } from '$lib/agent/tools/post-editor-tools';
import { loadMediaLibraryPromptSection } from '$lib/server/brand-media';
import { getOrCreatePostThread, saveMessages, loadHistory, loadHistoryForUI, assistantContentFromSteps } from '$lib/server/chat/persistence';
import { extractSdkUsage, logAiCall, withBrandContext } from '$lib/server/ai-log';
import { createChatLoopGuard, turnLoopNotice } from '$lib/server/chat/loop-guard';
import {
  chatMaxTurns,
  chatTokenBudget,
  chatTurnDeadline,
  turnTokenBudgetNotice,
  turnTruncatedNotice
} from '$lib/server/chat/turn-limits';
import { withStepDeadline } from '$lib/server/chat/step-deadline';
import type { RequestHandler } from './$types';

// Same wall as the main chat route — this is a real agent with the same tools underneath, and it
// was the last one left at 300s.
export const config = { maxDuration: 1800 };

// Small model on purpose: the per-post editor keeps a tiny context (just this post), so a
// cheap flash tier is plenty and keeps token spend low. Override with STUDIO_CHAT_MODEL.
function studioChatModel(): string {
  return env.STUDIO_CHAT_MODEL?.trim() || llmDefaultModel();
}

const flagOn = env.FEATURE_STUDIO === 'true';

const SYSTEM = `You are the inline editor assistant for a single social media post inside Anomalia.
You help the user rewrite and restyle THIS post through conversation — nothing else.

Rules:
- Always call read_post first if you don't already know the current state. read_post.media_review is the stored media score when this post has (or can have) a visual: overall /10, verdict (ship|fix|kill), judgment (why), next_test (the one change to try), issues[]. Use it before remaking or telling the user to approve. Honor fix/kill — apply next_test. Call review_video only when media_review.status is none/failed or the media changed since the last score.
- Pay attention to media_origin:
  · video — THIS POST IS A REEL. Remake spoken script / more natural delivery / remove on-screen subtitles or titles → make_video with script + ugc:true + prompt ("no on-screen text, no captions, full natural sentences"). Caption-only → set_text. Cover look → regenerate_image. NEVER call design_graphic, grep_source, replace_source, or write_source on a video: that deletes the mp4 and often leaves a blank canvas. "Scritte / sottotitoli / script da dire" on a reel are VIDEO problems, not a quote card.
  · typographic_graphic — HTML/CSS or React TSX still. The system prompt has META only (kind, version, chars) — not the file. Patch with grep_source → read_source (4000-char pages) → replace_source. write_source only if the structure must be rebuilt. High-level restyle without code → design_graphic. Need a photo (background, product, scene, texture)? Call read_media first. If a library image fits, use_library_image then replace_source <img src="https://...">. generate_image only when nothing uploaded fits (Nano Banana Pro, bills credits, returns image_url, does NOT change the post). Shortcut for one new photo + composer restyle: design_graphic generate_prompt. Do NOT call regenerate_image on a graphic (that would replace the whole canvas with a photo and lose the source). Never paste the full source into chat. If they actually want a VIDEO / UGC remake (even if a previous turn mistakenly turned this into a graphic), call make_video with script + ugc:true.
  · ai_generated — photo from the image model; edit with regenerate_image / edit_slide.
  · user_uploaded — Media library / user photo; keep it unless they ask to replace it.
  · none — follow the notes on the state object.
- For any wording change (caption, title, first comment), compose the new text yourself and call set_text. This is free — never regenerate an image just to change words. On a video, the spoken script is NOT the caption: write the line into make_video.script (and optionally set_text for the feed caption).
- YouTube custom cover: youtube_thumbnail_url is the 16:9 thumbnail sent to YouTube. Distinct from video_thumbnail_url (9:16 clip frame). To generate/pick/clear it, call youtube_thumbnail — never regenerate_image or make_video just for the YouTube copertina.
- Only change the visual when the user asks about it. Two different STILL tools, plus make_video for reels — picking the wrong one is the most common mistake here:
  · make_video — existing reel remakes, photo→video, spoken script, UGC, no subtitles. Keeps (or creates) a clip.
  · grep_source / read_source / replace_source — patch the graphic HTML/TSX in place. Prefer this over rewriting the file. After use_library_image or generate_image, put the returned https URL in <img src>.
  · write_source — full rewrite of the graphic source. Only when replace_source cannot express the change.
  · read_media / use_library_image — inspect uploaded brand assets and copy a fitting photo to a durable URL (no credits). Default before generate_image.
  · generate_image — mint Nano Banana Pro stills as https URLs when the library has nothing suitable. Does NOT change this post. Call N times, then replace_source. Not for swapping an ai_generated cover (use regenerate_image) and never on a reel.
  · design_graphic — STILL quote/stat/list/price cards via a natural-language brief (the composer rewrites the HTML). generate_prompt is a one-shot mint+embed. Never a substitute for remaking a reel. convert_from_video:true only if they explicitly asked to turn the reel into a static graphic.
  · regenerate_image / edit_slide — ONLY when media_origin is ai_generated (or a non-graphic carousel slide), or a video COVER look-change. These cost the brand credits. Carousel → edit_slide with the slide index (0 = cover).
- Carousels: read the slides (each has its own media_origin), edit them one at a time; use restructure_carousel to reorder or drop slides (no render). Pass slide_index on graphic source tools.
- Videos / reels: ALWAYS make_video to remake. Pass prompt to direct the clip freely. Seedance 2.5 via model="bytedance/seedance-2-5". Choose duration yourself. Never say there is no Seedance selector. media_review on read_post is the current score — use it. Call review_video only to refresh a missing/failed/stale score.
- If make_video fails, tell the user. Do not "recover" by calling design_graphic, write_source, or regenerate_image in a loop.
- Attached reference images (if any) are the user's assets for this turn — use them as the visual reference when regenerating AI photos.
- AGENTIC LOOP: you are allowed many tool steps in one turn. Read → change → read_post again → revise if needed until the result matches the ask. Do not stop after one half-done edit. Short user replies are fine; shallow tool use is not. Switching from make_video to design_graphic or write_source because the first call failed is not a revision — it is destroying the post.
- Keep replies short and concrete: say what you changed. Match the user's language.`;

// Editable fields the client preview mirrors — the tools mutate these on the post row, so
// after each turn the editor reloads them to reflect the applied changes.
const POST_STATE_COLS =
  'id, caption, title, first_comment, link_url, subreddit, image_prompt, image_prompts, media_url, media_urls, content_type, product_name, platforms, status, video_thumbnail_url, youtube_thumbnail_url';

// GET: load the post's editor conversation + current post state (no thread until first message).
export const GET: RequestHandler = async ({ params, locals: { supabase, safeGetSession } }) => {
  if (!flagOn) return json({ error: 'Not found' }, { status: 404 });
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
  const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
  if (!brand) return json({ error: 'Brand not found', messages: [] }, { status: 404 });
  const { data: post } = await supabase.from('posts').select(POST_STATE_COLS).eq('id', params.id).eq('brand_id', brand.id).maybeSingle();
  const { data: thread } = await supabase
    .from('chat_threads')
    .select('id')
    .eq('brand_id', brand.id)
    .eq('user_id', user.id)
    .eq('post_id', params.id)
    .maybeSingle();
  if (!thread) return json({ messages: [], post });
  const messages = await loadHistoryForUI(supabase, brand.id, user.id, thread.id);
  return json({ messages, thread_id: thread.id, post });
};

// POST: send a message. Resolves attached assets, runs the editor agent, streams + persists.
export const POST: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  if (!flagOn) return new Response('Not found', { status: 404 });
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const { data: brand } = await supabase
    .from('brands')
    .select('id, timezone, content_prefs')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) return new Response('Brand not found', { status: 404 });

  // Confirm the post exists and belongs to this brand (RLS also scopes it).
  const { data: post } = await supabase
    .from('posts')
    .select('id, media_urls, content_type, format')
    .eq('id', params.id)
    .eq('brand_id', brand.id)
    .maybeSingle();
  if (!post) return new Response('Post not found', { status: 404 });

  const body = await request.json();
  const userMessages = body.messages as ModelMessage[] | undefined;
  if (!userMessages?.length) return new Response('No messages', { status: 400 });
  const lastUserMsg = userMessages[userMessages.length - 1];

  // Resolve the assets attached to this message → signed/data URLs (same resolution the
  // regenerate endpoint uses). Uploaded data: URLs pass through; library picks are signed.
  const att = (body.attachments ?? {}) as { uploads?: unknown; brandImageIds?: unknown; postThumbIds?: unknown };
  const uploads = Array.isArray(att.uploads)
    ? (att.uploads as unknown[]).filter((s): s is string => typeof s === 'string' && s.startsWith('data:image/')).slice(0, 4)
    : [];
  const asIds = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((s): s is string => typeof s === 'string' && !!s).slice(0, 4) : []);
  const refUrls: string[] = [...uploads];
  const brandImageIds = asIds(att.brandImageIds);
  if (brandImageIds.length) {
    const { resolveBrandImageIds } = await import('$lib/server/brand-media');
    refUrls.push(...(await resolveBrandImageIds(supabase, brand.id, brandImageIds)));
  }
  const postThumbIds = asIds(att.postThumbIds);
  if (postThumbIds.length) {
    const { data } = await supabase.from('social_post_history').select('thumbnail_path, thumbnail_url').in('id', postThumbIds).eq('brand_id', brand.id);
    const paths = (data ?? []).map((h) => String(h.thumbnail_path ?? '')).filter(Boolean);
    const m = await signKnowledgePaths(supabase, paths);
    for (const h of data ?? []) {
      const u = (h.thumbnail_path ? m.get(String(h.thumbnail_path)) : null) ?? (h.thumbnail_url ? String(h.thumbnail_url) : null);
      if (u) refUrls.push(u);
    }
  }

  const ctx = await loadEditorContext(supabase, brand.id);

  const thread = await getOrCreatePostThread(supabase, brand.id, user.id, params.id);
  if (!thread) return new Response('Failed to open editor thread', { status: 500 });

  return withBrandContext(brand.id, async () => {
    const history = await loadHistory(supabase, brand.id, user.id, thread.id);
    await saveMessages(supabase, brand.id, user.id, [lastUserMsg], thread.id);

    // thread.id so a clip rendering out-of-band reports back into this conversation — the tools
    // promise the user they will, and without it nothing ever does.
    const tools = createPostEditorTools(supabase, brand.id, params.id, brand.timezone ?? 'Europe/Rome', user.id, ctx, refUrls, thread.id);
    const t0 = Date.now();
    // This route had a step count and a loop guard but no clock at all, so a slow tool ran until
    // the platform killed the function — no finish path, no salvaged reply.
    const deadline = chatTurnDeadline(t0);
    const loopGuard = createChatLoopGuard();
    // Stesso tetto sui token degli altri motori — vedi turn-limits.ts.
    const tokenBudget = chatTokenBudget();
    const locale = ((brand.content_prefs as { language?: string } | null)?.language ?? '').startsWith('en')
      ? 'en'
      : 'it';
    const isCarousel = Array.isArray(post.media_urls) && post.media_urls.length > 1;
    const [graphicSuffix, mediaSection] = await Promise.all([
      loadGraphicEditorSystemSuffix(supabase, params.id, { carousel: isCarousel }),
      loadMediaLibraryPromptSection(supabase, brand.id)
    ]);
    const system = [SYSTEM, graphicSuffix, mediaSection].filter(Boolean).join('\n\n');

    const result = harnessStreamText({
      brandId: brand.id,
      userId: user.id,
      threadId: thread.id,
      agent: 'chat_editor',
      mode: 'editor',
      model: studioChatModel(),
      provider: 'llm',
      surface: 'chat'
    }, {
      model: llmLanguageModel(studioChatModel()),
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      system,
      messages: [...history, lastUserMsg],
      tools: withStepDeadline(tools, {
        remainingMs: deadline.remainingMs,
        onExpired: ({ tool, waitedMs, reason }) =>
          console.error(`[Post Editor] step deadline postId=${params.id}, tool=${tool}, ${reason}, ${waitedMs}ms`)
      }),
      stopWhen: [stepCountIs(chatMaxTurns()), deadline.reached, loopGuard.reached, tokenBudget.reached],
      temperature: 0.3,
      onStepFinish: ({ toolCalls, text }) => {
        loopGuard.recordStep(
          toolCalls?.map((tc) => ({ toolName: tc.toolName, input: 'input' in tc ? tc.input : undefined })),
          text
        );
      },
      onFinish: async ({ text, steps, totalUsage }) => {
        logAiCall({
          label: 'post-editor-chat',
          provider: 'llm',
          model: studioChatModel(),
          ms: Date.now() - t0,
          ok: true,
          ...extractSdkUsage(totalUsage),
          brandId: brand.id,
          userId: user.id,
          threadId: thread.id,
          context: 'post-editor'
        });
        try {
          const content = assistantContentFromSteps(steps, text);
          // Say why it stopped. A turn cut off on the clock otherwise reads as a finished answer
          // that is quietly missing half the work. No continuation here: this editor is a single
          // post, so the user re-asking is the cheaper recovery than a background chain.
          if (tokenBudget.exceeded) {
            console.warn(
              `[Post Chat] token budget stop used=${tokenBudget.usedTokens}, budget=${tokenBudget.budget}`
            );
            content.push({
              type: 'text',
              text: turnTokenBudgetNotice(locale, tokenBudget.usedTokens, tokenBudget.budget)
            });
          } else if (loopGuard.stalled) content.push({ type: 'text', text: turnLoopNotice(locale) });
          else if (deadline.expired) content.push({ type: 'text', text: turnTruncatedNotice(locale, false) });
          if (content.length) await saveMessages(supabase, brand.id, user.id, [{ role: 'assistant', content } as unknown as ModelMessage], thread.id);
        } catch (e) {
          console.error('[post-editor onFinish]', e);
        }
      }
    });

    return result.toUIMessageStreamResponse({ sendReasoning: false });
  });
};
