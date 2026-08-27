import type { SupabaseClient } from '@supabase/supabase-js';
import { studioCompleteness } from '$lib/studio-completeness';
import { radarPrefsOf } from '$lib/server/radar';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type SetupChecklistItem = { key: string; done: boolean; href: string };
export type SetupChecklist = { items: SetupChecklistItem[]; doneCount: number; total: number };

// The brand-setup todo list — the SAME six items the sidebar OnboardingChecklist shows, so the
// chat and the sidebar progress never disagree. `key` maps to i18n `app.checklist.items.<key>` on the client.
export async function buildSetupChecklist(supabase: SupabaseClient, brandId: string): Promise<SetupChecklist> {
  const [{ data: brand }, { data: kit }, { count: products }, { count: history }, { count: documents }, { data: gtm }, { data: plan }, { count: geo }] =
    await Promise.all([
      supabase.from('brands').select('slug, content_prefs, blog_config').eq('id', brandId).maybeSingle(),
      supabase.from('brand_kit').select('about, target_audience, brand_style, ai_character, logos, brand_colors').eq('brand_id', brandId).maybeSingle(),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
      supabase.from('social_post_history').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
      supabase.from('brand_documents').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
      supabase.from('gtm_plans').select('id').eq('brand_id', brandId).eq('status', 'active').maybeSingle(),
      supabase.from('editorial_plans').select('id').eq('brand_id', brandId).eq('status', 'active').maybeSingle(),
      supabase.from('brand_geo_audits').select('id', { count: 'exact', head: true }).eq('brand_id', brandId)
    ]);

  const slug = brand?.slug ?? '';
  const character = (kit?.ai_character ?? {}) as AnyRec;
  const hasLogo = ((kit?.logos ?? []) as AnyRec[]).some((l) => l?.url && l?.type !== 'og-image');
  const studioPct = studioCompleteness({
    products: products ?? 0,
    history: history ?? 0,
    documents: documents ?? 0,
    voice: !!(character.tone || character.speaking_style || kit?.brand_style),
    about: !!kit?.about,
    audience: !!kit?.target_audience,
    logo: hasLogo,
    colors: Array.isArray(kit?.brand_colors) && (kit!.brand_colors as unknown[]).length > 0
  }).pct;
  const radarEnabled = radarPrefsOf(brand?.content_prefs).enabled === true;
  const blogEnabled = (brand?.blog_config as { enabled?: boolean } | null)?.enabled === true;

  const items: SetupChecklistItem[] = [
    { key: 'studio', done: studioPct >= 80, href: `/app/${slug}/settings/brand` },
    { key: 'strategy', done: !!gtm, href: `/app/${slug}/gtm` },
    { key: 'plan', done: !!plan, href: `/app/${slug}/plan` },
    { key: 'blog', done: blogEnabled, href: `/app/${slug}/site` },
    { key: 'radar', done: radarEnabled, href: `/app/${slug}/radar` },
    { key: 'seo', done: (geo ?? 0) > 0, href: `/app/${slug}/seo` }
  ];
  return { items, doneCount: items.filter((i) => i.done).length, total: items.length };
}
