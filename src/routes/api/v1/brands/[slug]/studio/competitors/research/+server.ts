import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  // AI-spending action — requires a paid plan with credits (same standard as /seo, /geo, /web).
  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  // Load brand profile for research
  const [brandRes, kitRes, productsRes] = await Promise.all([
    supabase.from('brands').select('name, website, content_prefs').eq('id', brand.id).maybeSingle(),
    supabase.from('brand_kit').select('category, about, target_audience, ai_context').eq('brand_id', brand.id).maybeSingle(),
    supabase.from('products').select('title, description').eq('brand_id', brand.id),
  ]);

  const brandData = brandRes.data;
  const kit = kitRes.data;
  const products = productsRes.data ?? [];

  const profile = {
    name: brandData?.name ?? brand.name,
    website: brandData?.website ?? null,
    category: kit?.category ?? null,
    about: kit?.about ?? null,
    target_audience: kit?.target_audience ?? null,
    ai_context: kit?.ai_context ?? null,
    language: (brandData?.content_prefs as Record<string, unknown>)?.language ?? 'en',
    products: products.map(p => p.title),
  };

  // Load existing competitors for dedup
  const { data: existing } = await supabase
    .from('competitors').select('name, website').eq('brand_id', brand.id);

  const existingNames = new Set((existing ?? []).map(c => c.name.toLowerCase()));
  const existingHosts = new Set(
    (existing ?? [])
      .map(c => { try { return new URL(c.website ?? '').hostname.replace(/^www\./, ''); } catch { return null; } })
      .filter(Boolean)
  );

  try {
    const { discoverCompetitors } = await import('$lib/server/research');

    const { competitors: discovered } = await discoverCompetitors(profile, 'italiano');

    // Deduplicate and insert
    let added = 0;
    for (const comp of discovered) {
      const nameLower = comp.name.toLowerCase();
      if (existingNames.has(nameLower)) continue;

      let host: string | null = null;
      try { host = new URL(comp.website ?? '').hostname.replace(/^www\./, ''); } catch {}
      if (host && existingHosts.has(host)) continue;

      await supabase.from('competitors').insert({
        brand_id: brand.id,
        name: comp.name,
        website: comp.website ?? null,
        kind: comp.kind ?? 'direct',
        rationale: comp.rationale ?? null,
        source: 'ai',
      });

      existingNames.add(nameLower);
      if (host) existingHosts.add(host);
      added++;
    }

    return json({ ok: true, found: discovered.length, added });
  } catch (e) {
    return json({ error: `Research failed: ${String(e)}` }, { status: 500 });
  }
};
