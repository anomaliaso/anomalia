import { json } from '@sveltejs/kit';
import type { RequestEvent, RequestHandler } from './$types';
import { postMediaTarget } from '$lib/server/post-media';
import { readPostState } from '$lib/agent/tools/post-editor-tools';
import { POST as order } from './order/+server';
import { POST as regenerate } from './regenerate/+server';
import { POST as slide } from './slide/+server';
import { POST as video } from './video/+server';

// GET — compact post state: what it is, and every carousel slide with its prompt.
export const GET: RequestHandler = async ({ request, params }) => {
  const r = await postMediaTarget(request, params.slug, params.id);
  if (r.error) return r.error;
  return json(await readPostState(r.t));
};

// Ogni azione ha la sua rotta. Questa resta per compatibilità: `action` sceglie a quale inoltrare,
// e nient'altro accade qui. Le rotte nuove sono la strada; questa è quello che chiamava prima.
const FORWARD: Record<string, (event: RequestEvent) => Promise<Response>> = {
  regenerate,
  slide,
  restructure: order,
  video
};

export const POST: RequestHandler = async (event) => {
  const { action } = (await event.request.clone().json().catch(() => ({}))) as { action?: string };
  const forward = FORWARD[String(action ?? '')];
  if (!forward) return json({ error: `Unknown action: ${action}` }, { status: 400 });

  return forward(event);
};
