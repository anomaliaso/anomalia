import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { gateAiAction } from '$lib/server/cli-auth';
import { withBrandContext } from '$lib/server/ai-log';
import { postMediaTarget } from '$lib/server/post-media';
import { regeneratePostImage } from '$lib/agent/tools/post-editor-tools';

export const config = { maxDuration: 300 };

// POST { instruction?, prompt? } — refine the single cover image. Bills one render.
export const POST: RequestHandler = async ({ request, params }) => {
  const r = await postMediaTarget(request, params.slug, params.id);
  if (r.error) return r.error;

  const { instruction, prompt } = (await request.json().catch(() => ({}))) as {
    instruction?: string;
    prompt?: string;
  };
  if (!instruction && !prompt) {
    return json({ error: 'Missing instruction or prompt' }, { status: 400 });
  }

  const gate = await gateAiAction(r.brand, r.apiKey);
  if (gate) return gate;

  return withBrandContext(r.brand.id, async () => {
    const res = await regeneratePostImage(r.t, {
      instruction: instruction ?? 'Refine this image.',
      new_prompt: prompt
    });
    return json(res, { status: res.error ? 400 : 200 });
  });
};
