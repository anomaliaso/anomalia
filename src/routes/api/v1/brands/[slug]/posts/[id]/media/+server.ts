import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';
import { withBrandContext } from '$lib/server/ai-log';
import {
  loadEditorContext, readPostState, regeneratePostImage, editCarouselSlide, restructureCarouselSlides,
  renderPostVideo, isAspectRatio, type EditorTarget
} from '$lib/server/chat/post-editor-tools';

// Image refinement + carousel slide renders — same budget the web editor gets.
export const config = { maxDuration: 300 };

async function target(request: Request, slug: string, id: string) {
  const { supabase, user, apiKey, error } = await authenticate(request);
  if (error) return { error };
  const { brand, error: brandError } = await loadBrandForUser(supabase, slug, apiKey);
  if (brandError) return { error: brandError };

  const ctx = await loadEditorContext(supabase, brand.id);
  const t: EditorTarget = {
    supabase, brandId: brand.id, postId: id,
    tz: (brand.timezone as string) ?? 'Europe/Rome',
    userId: user.id, ctx, refUrls: []
  };
  return { t, brand, apiKey };
}

// GET — compact post state: what it is, and every carousel slide with its prompt.
export const GET: RequestHandler = async ({ request, params }) => {
  const r = await target(request, params.slug, params.id);
  if (r.error) return r.error;
  return json(await readPostState(r.t));
};

// POST { action: 'regenerate' | 'slide' | 'restructure', … }
export const POST: RequestHandler = async ({ request, params }) => {
  const r = await target(request, params.slug, params.id);
  if (r.error) return r.error;

  const body = await request.json().catch(() => ({})) as {
    action?: string; instruction?: string; prompt?: string; index?: number; order?: number[];
    duration?: number; script?: string; aspectRatio?: string;
  };

  // Reordering slides renders nothing — don't charge it or gate it behind credits.
  if (body.action === 'restructure') {
    if (!Array.isArray(body.order) || !body.order.length) return json({ error: 'Missing order' }, { status: 400 });
    const res = await restructureCarouselSlides(r.t, { order: body.order });
    return json(res, { status: res.error ? 400 : 200 });
  }

  const gate = await gateAiAction(r.brand, r.apiKey);
  if (gate) return gate;

  return withBrandContext(r.brand.id, async () => {
    if (body.action === 'regenerate') {
      if (!body.instruction && !body.prompt) return json({ error: 'Missing instruction or prompt' }, { status: 400 });
      const res = await regeneratePostImage(r.t, { instruction: body.instruction ?? 'Refine this image.', new_prompt: body.prompt });
      return json(res, { status: res.error ? 400 : 200 });
    }

    if (body.action === 'slide') {
      if (typeof body.index !== 'number') return json({ error: 'Missing index' }, { status: 400 });
      const res = await editCarouselSlide(r.t, { slide_index: body.index, instruction: body.instruction, new_prompt: body.prompt });
      return json(res, { status: res.error ? 400 : 200 });
    }

    if (body.action === 'video') {
      if (body.aspectRatio !== undefined && !isAspectRatio(body.aspectRatio)) {
        return json({ error: 'Invalid aspectRatio. Use 9:16, 1:1, 16:9, 4:3, 3:4 or 21:9.' }, { status: 400 });
      }
      const res = await renderPostVideo(r.t, {
        duration: body.duration, script: body.script,
        instructions: body.instruction, aspectRatio: body.aspectRatio
      });
      return json(res, { status: res.error ? 400 : 200 });
    }

    return json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  });
};
