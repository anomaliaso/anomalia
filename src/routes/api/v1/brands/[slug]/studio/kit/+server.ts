import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

const KIT_COLUMNS = ['about', 'category', 'target_audience', 'brand_style'] as const;

export const PUT: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = await request.json();
  const { language } = body;

  const kit = Object.fromEntries(
    KIT_COLUMNS.filter((column) => column in body).map((column) => [column, body[column] ?? null])
  );

  if (Object.keys(kit).length > 0) {
    const { error: kitError } = await supabase
      .from('brand_kit')
      .upsert({ brand_id: brand.id, ...kit }, { onConflict: 'brand_id' });

    if (kitError) return json({ error: kitError.message }, { status: 500 });
  }

  if (language !== undefined) {
    const { data: brandData } = await supabase
      .from('brands').select('content_prefs').eq('id', brand.id).maybeSingle();
    const prefs = (brandData?.content_prefs ?? {}) as Record<string, unknown>;
    prefs.language = language;
    await supabase.from('brands').update({ content_prefs: prefs }).eq('id', brand.id);
  }

  try {
    const { rebuildBrandContext } = await import('$lib/server/brand-context');
    await rebuildBrandContext(supabase, brand.id);
  } catch (error) { swallow('rebuild brand context', error); }

  return json({ ok: true });
};
