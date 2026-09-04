import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { gateAiAction } from '$lib/server/cli-auth';
import { withBrandContext } from '$lib/server/ai-log';
import { postMediaTarget } from '$lib/server/post-media';
import { editCarouselSlide } from '$lib/agent/tools/post-editor-tools';

export const config = { maxDuration: 300 };

// POST { index, instruction?, prompt? } — re-render one carousel slide. Bills one render.
export const POST: RequestHandler = async ({ request, params }) => {
  const r = await postMediaTarget(request, params.slug, params.id);
  if (r.error) return r.error;

  const { index, instruction, prompt } = (await request.json().catch(() => ({}))) as {
    index?: number;
    instruction?: string;
    prompt?: string;
  };
  if (typeof index !== 'number') return json({ error: 'Missing index' }, { status: 400 });

  const gate = await gateAiAction(r.brand, r.apiKey);
  if (gate) return gate;

  return withBrandContext(r.brand.id, async () => {
    const res = await editCarouselSlide(r.t, {
      slide_index: index,
      instruction,
      new_prompt: prompt
    });
    return json(res, { status: res.error ? 400 : 200 });
  });
};
