import type { SupabaseClient } from '@supabase/supabase-js';

export const POST_VERDICTS = ['approved', 'edited', 'discarded'] as const;

export type PostVerdict = (typeof POST_VERDICTS)[number];

export type PostVerdictInput = {
  postId: string;
  brandId: string;
  actorId: string;
  verdict: PostVerdict;
  captionBefore?: string | null;
  captionAfter?: string | null;
};

const CAPTION_KEPT_CHARS = 2200;

function trimmedCaption(caption: string | null | undefined): string | null {
  const text = String(caption ?? '');
  return text ? text.slice(0, CAPTION_KEPT_CHARS) : null;
}

export async function recordPostVerdicts(
  client: Pick<SupabaseClient, 'from'>,
  inputs: PostVerdictInput[]
): Promise<void> {
  if (!inputs.length) return;

  try {
    const { error } = await client.from('post_verdicts').insert(
      inputs.map((input) => ({
        post_id: input.postId,
        brand_id: input.brandId,
        user_id: input.actorId,
        verdict: input.verdict,
        caption_before: trimmedCaption(input.captionBefore),
        caption_after: trimmedCaption(input.captionAfter)
      }))
    );
    if (error) console.warn('[post-verdict] not recorded:', error.message);
  } catch (e) {
    console.warn('[post-verdict] not recorded:', e instanceof Error ? e.message : e);
  }
}

export async function recordPostVerdict(
  client: Pick<SupabaseClient, 'from'>,
  input: PostVerdictInput
): Promise<void> {
  return recordPostVerdicts(client, [input]);
}

export async function brandOwnerId(
  client: Pick<SupabaseClient, 'from'>,
  brandId: string
): Promise<string | null> {
  const { data: brand } = await client.from('brands').select('org_id').eq('id', brandId).maybeSingle();
  const orgId = (brand as { org_id?: string } | null)?.org_id;
  if (!orgId) return null;
  const { data: org } = await client.from('organizations').select('owner_id').eq('id', orgId).maybeSingle();
  return (org as { owner_id?: string } | null)?.owner_id ?? null;
}
