import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { MEDIA_SHORT_CODE_RE, MEDIA_UUID_RE } from '$lib/media-url';

const BUCKET = 'brand-knowledge';
const SIGN_TTL_SECONDS = 60 * 60 * 2;

// Public permanent link for a library asset: /a/<code> → 302 to a freshly signed storage URL.
// It exists because the signed URL itself cannot be handed out — ~600 chars that expire in 2h and
// truncate inside an agent's output (observed: InvalidJWT "signature verification failed").
//
// Public by decision: the code is the only credential, which is why it is 8 chars of a 32-symbol
// alphabet rather than something shorter. No session, no cookies, no auth — a shared link works
// for whoever holds it, and revoking one means deleting the asset.
//
// The uuid form is accepted too: the media tools have always returned `id`, so an agent can
// reasonably assemble /a/<uuid> on its own, and refusing it would break a link for nothing.
export const GET: RequestHandler = async ({ params }) => {
  const id = params.id ?? '';
  const column = MEDIA_SHORT_CODE_RE.test(id) ? 'short_code' : MEDIA_UUID_RE.test(id) ? 'id' : null;
  if (!column) return new Response('Not found', { status: 404 });

  const admin = createAdminClient();
  const { data: media } = await admin
    .from('brand_media')
    .select('storage_path')
    .eq(column, id)
    .maybeSingle();
  if (!media?.storage_path) return new Response('Not found', { status: 404 });

  const { data: signed } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(media.storage_path, SIGN_TTL_SECONDS);
  if (!signed?.signedUrl) return new Response('Not found', { status: 404 });

  // no-store, not a short max-age: the target dies in 2h and this redirect is permanent. A cached
  // 302 would outlive the token it points at and serve a dead link — the failure would show up
  // hours later, on someone else's browser, with nothing in our logs.
  return new Response(null, {
    status: 302,
    headers: { Location: signed.signedUrl, 'Cache-Control': 'no-store' }
  });
};
