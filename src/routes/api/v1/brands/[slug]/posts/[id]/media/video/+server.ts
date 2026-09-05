import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { gateAiAction } from '$lib/server/cli-auth';
import { withBrandContext } from '$lib/server/ai-log';
import { postMediaTarget } from '$lib/server/post-media';
import { isAspectRatio, renderPostVideo } from '$lib/agent/tools/post-editor-tools';

export const config = { maxDuration: 300 };

// POST { duration?, script?, instruction?, aspectRatio? } — animate the cover into a clip.
export const POST: RequestHandler = async ({ request, params }) => {
  const r = await postMediaTarget(request, params.slug, params.id);
  if (r.error) return r.error;

  const { duration, script, instruction, aspectRatio } = (await request
    .json()
    .catch(() => ({}))) as {
    duration?: number;
    script?: string;
    instruction?: string;
    aspectRatio?: string;
  };
  if (aspectRatio !== undefined && !isAspectRatio(aspectRatio)) {
    return json(
      { error: 'Invalid aspectRatio. Use 9:16, 1:1, 16:9, 4:3, 3:4 or 21:9.' },
      { status: 400 }
    );
  }

  const gate = await gateAiAction(r.brand, r.apiKey);
  if (gate) return gate;

  return withBrandContext(r.brand.id, async () => {
    const res = await renderPostVideo(r.t, {
      duration,
      script,
      instructions: instruction,
      aspectRatio
    });
    return json(res, { status: res.error ? 400 : 200 });
  });
};
