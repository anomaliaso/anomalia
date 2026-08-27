import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signPaths, type PersonImage } from '$lib/server/people';

/**
 * Brand kit / products / people / competitors (+ signed thumbs) for Studio pages.
 * Streams behind a promise so the settings/studio shell isn't blocked on 9 queries.
 */
export async function loadStudioDeferred(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  brandId: string
) {
  const [
    { data: kit },
    { data: products },
    { data: documents },
    { data: historyRows },
    { data: competitors },
    { data: brandRow },
    { data: accts },
    { data: peopleRows }
  ] = await Promise.all([
    supabase
      .from('brand_kit')
      .select(
        'category, about, brand_style, target_audience, brand_colors, theme_color, favicon_url, fonts, logos, ai_character, ai_context, ai_context_updated_at, visual_style, visual_style_locked, graphic_style'
      )
      .eq('brand_id', brandId)
      .maybeSingle(),
    supabase
      .from('products')
      .select('id, title, pricing, images, featured')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: true }),
    supabase
      .from('brand_documents')
      .select('id, kind, title, content_text, file_url, file_name, mime_type, created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false }),
    supabase
      .from('social_post_history')
      .select(
        'id, platform, content, thumbnail_url, thumbnail_path, platform_post_url, metrics, published_at'
      )
      .eq('brand_id', brandId)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(60),
    supabase
      .from('competitors')
      .select('id, name, website, kind, rationale, source, created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: true }),
    supabase.from('brands').select('content_prefs, target_platforms').eq('id', brandId).maybeSingle(),
    supabase.from('social_accounts').select('platform').eq('brand_id', brandId).eq('status', 'active'),
    supabase
      .from('people')
      .select('id, name, role, kind, description, images, consent, created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: true })
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prefs = (brandRow?.content_prefs as any) ?? {};
  const language = (prefs?.language as string) ?? '';
  const platformInstructions = (prefs?.platformInstructions as Record<string, string>) ?? {};
  const platformHashtags = (prefs?.platformHashtags as Record<string, string[]>) ?? {};
  const voiceExamples = (prefs?.voiceExamples as string[]) ?? [];
  const targetPlatforms: string[] = Array.isArray(brandRow?.target_platforms)
    ? (brandRow.target_platforms as string[])
    : [];

  const connectedPlatforms = [
    ...new Set(
      (accts ?? [])
        .map((a) => {
          const k = String(a.platform ?? '')
            .toLowerCase()
            .trim();
          return k === 'twitter' ? 'x' : k;
        })
        .filter(Boolean)
    )
  ];

  const firstPeoplePaths = (peopleRows ?? [])
    .map((p) => ((p.images ?? []) as PersonImage[])[0]?.path)
    .filter((p): p is string => !!p);

  const moodDocs = (documents ?? []).filter((d) => d.kind === 'image');
  const moodPaths = moodDocs.map((d) => String(d.file_url ?? '')).filter(Boolean);
  const historyPaths = (historyRows ?? []).map((h) => String(h.thumbnail_path ?? '')).filter(Boolean);
  const allSigned = await signPaths(supabase, [
    ...historyPaths,
    ...firstPeoplePaths,
    ...moodPaths
  ]).catch((error) => { swallow('signPaths failed', error); return new Map<string, string>(); });

  const history = (historyRows ?? []).map((h) => ({
    ...h,
    thumbnail_url: allSigned.get(String(h.thumbnail_path ?? '')) ?? h.thumbnail_url
  }));

  const people = (peopleRows ?? []).map((p) => {
    const imgs = (p.images ?? []) as PersonImage[];
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      kind: p.kind,
      description: p.description,
      consent: p.consent,
      imageCount: imgs.length,
      thumb: imgs[0]?.path ? (allSigned.get(imgs[0].path) ?? null) : null
    };
  });

  const moodImages = moodDocs.map((d) => ({
    id: d.id,
    title: d.title,
    url: allSigned.get(String(d.file_url ?? '')) ?? null
  }));

  return {
    kit,
    products: products ?? [],
    documents: documents ?? [],
    history: history ?? [],
    moodImages,
    language,
    platformInstructions,
    platformHashtags,
    voiceExamples,
    targetPlatforms,
    connectedPlatforms,
    people,
    competitors: competitors ?? []
  };
}
