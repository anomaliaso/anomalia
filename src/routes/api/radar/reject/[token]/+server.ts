import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';

// One-click reject from the Radar digest email: deletes the proposed post (same semantics as the
// editor's "reject"). Single-use, expiring token; deleting a proposal is the worst it can do.
const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;"><h2>${title}</h2><p style="color:#555">${body}</p></body>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );

export const GET: RequestHandler = async ({ params }) => {
  const admin = createAdminClient();
  const { data: post } = await admin
    .from('posts')
    .select('id, status, approval_token_expires_at')
    .eq('approval_token', params.token)
    .maybeSingle();
  if (!post) return page('Link non valido', 'Questo link è già stato usato o non esiste.');
  if (post.approval_token_expires_at && new Date(post.approval_token_expires_at) < new Date()) {
    return page('Link scaduto', 'Gestisci il post dall’app.');
  }
  if (post.status !== 'pending_user') return page('Non più in bozza', 'Il post è già stato gestito dall’app.');
  await admin.from('posts').delete().eq('id', post.id);
  return page('Scartato', 'La proposta è stata eliminata.');
};
