import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { listBrandMedia } from '$lib/server/brand-media';
import { LIST_MEDIA } from '@anomalia/api-contracts';

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const parsed = LIST_MEDIA.input.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const media = await listBrandMedia(supabase, brand.id, parsed.data);
  return json({
    media: media.map((m) => ({
      id: m.id,
      kind: m.kind,
      mime: m.mime,
      width: m.width,
      height: m.height,
      title: m.title,
      description: m.description,
      tags: m.tags,
      signed_url: m.signed_url,
      created_at: m.created_at
    }))
  });
};
