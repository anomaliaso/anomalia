import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { listBrandMedia } from '$lib/server/brand-media';
import { importBrandMediaFromUrl } from '$lib/server/media-import';
import { IMPORT_MEDIA_URL, LIST_MEDIA, statusForFailure } from '@anomalia/api-contracts';

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

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = IMPORT_MEDIA_URL.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const result = await importBrandMediaFromUrl(supabase, {
    brandId: brand.id,
    userId: user.id,
    url: parsed.data.url,
    title: parsed.data.title
  });

  if (!result.ok) {
    return json({ error: result.error }, { status: statusForFailure(IMPORT_MEDIA_URL, result.error) });
  }

  return json({ ok: true, ...result.media });
};
