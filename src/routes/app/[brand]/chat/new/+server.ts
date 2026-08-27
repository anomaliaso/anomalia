import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Deep-link into chat without creating an empty thread.
 * Forwards optional `message` / `agent` to Overview — ChatColumn sends (and creates) on first message.
 */
export const GET: RequestHandler = async ({ params, url, locals: { safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const qs = new URLSearchParams();
  const message = url.searchParams.get('message')?.trim();
  const agent = url.searchParams.get('agent')?.trim();
  if (message) qs.set('message', message);
  if (agent) qs.set('agent', agent);

  const q = qs.toString();
  throw redirect(303, `/app/${params.brand}${q ? `?${q}` : ''}`);
};
