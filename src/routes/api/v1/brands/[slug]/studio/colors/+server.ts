import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

export const PUT: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const { colors } = await request.json();
  if (!Array.isArray(colors) || colors.length > 8) {
    return json({ error: 'colors must be an array of max 8 hex strings' }, { status: 400 });
  }

  // Validate hex format
  for (const c of colors) {
    if (typeof c !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) {
      return json({ error: `Invalid color: ${c}` }, { status: 400 });
    }
  }

  const { error: updateError } = await supabase
    .from('brand_kit')
    .upsert({ brand_id: brand.id, brand_colors: colors }, { onConflict: 'brand_id' });

  if (updateError) return json({ error: updateError.message }, { status: 500 });
  return json({ ok: true, colors });
};
