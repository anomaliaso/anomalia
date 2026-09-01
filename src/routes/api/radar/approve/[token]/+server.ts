import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { publishApprovedPost, type ApprovablePost } from '$lib/server/publish';
import { EDITOR_POST_COLS } from '$lib/server/post-editing';
import { brandOwnerId } from '$lib/server/post-verdict';

// One-click approve from the Radar digest email. The token is single-use and expiring — it can
// ONLY approve this one post (never edit, never reach anything else), so a leaked link's blast
// radius is one publication the owner was emailed about anyway.
const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;"><h2>${title}</h2><p style="color:#555">${body}</p></body>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );

export const GET: RequestHandler = async ({ params }) => {
  const admin = createAdminClient();
  const { data: post } = await admin
    .from('posts')
    .select(`${EDITOR_POST_COLS}, approval_token_expires_at`)
    .eq('approval_token', params.token)
    .maybeSingle();
  if (!post) return page('Link non valido', 'Questo link è già stato usato o non esiste.');
  if (post.approval_token_expires_at && new Date(post.approval_token_expires_at) < new Date()) {
    return page('Link scaduto', 'Approva il post dall’app.');
  }

  // Invalidate the token FIRST (single use), then publish/schedule via the normal approval path.
  await admin.from('posts').update({ approval_token: null, approval_token_expires_at: null }).eq('id', post.id);
  const { data: brand } = await admin.from('brands').select('timezone').eq('id', post.brand_id).maybeSingle();
  const owner = await brandOwnerId(admin, post.brand_id as string);
  try {
    const res = await publishApprovedPost(admin, post as unknown as ApprovablePost, brand?.timezone ?? 'Europe/Rome', {
      by: owner ?? undefined
    });
    if (res.noAccount) return page('Approvato ✓', 'Nessun account social collegato: il post resta in coda, collega un account per pubblicarlo.');
    return page('Approvato ✓', 'Il post è stato messo in pubblicazione.');
  } catch {
    return page('Approvato, ma…', 'La pubblicazione ha avuto un problema: gestisci il post dall’app.');
  }
};
