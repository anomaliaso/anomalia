import type { RequestHandler } from './$types';
import { indexnowKey } from '$lib/server/indexing';

// IndexNow verification file: https://<any-host>/<key>.txt must return the key as plain text.
// Served on every hostname routed to this app, so subpath blogs (anomalia.so) AND custom-domain
// blogs (_site) can both be verified with the same key.
export const GET: RequestHandler = ({ params }) => {
  const key = indexnowKey();
  if (!key || params.key !== key) return new Response('Not found', { status: 404 });
  return new Response(key, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' }
  });
};
