import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { studioCompleteness } from '$lib/studio-completeness';
import { ruleToInstruction, type PlatformRule } from '$lib/server/operational-strategy';

// Strategia operativa — the brand's style manual: HOW it communicates, platform by platform.
// Stable rules, independent of GTM phases and editorial weeks (brief §5.4, prototyped by the
// cofounder): a structured VOICE FRAMEWORK (purpose, audience, tone, register, emotion,
// character, syntax, terminology) + a per-platform caption-rules table + banned words.
// 'auto' mode (recommended) shows the framework Anomalia DERIVED from the Studio (populated by the
// post-payment setup); 'manual' makes this page authoritative and injects the framework verbatim
// into every caption the copywriter writes.

async function requireBrand(supabase: SupabaseClient, slug: string) {
  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, slug, target_platforms, content_prefs')
    .eq('slug', slug)
    .maybeSingle();
  if (!brand) throw error(404, 'Brand not found');
  return brand;
}

// Same shared score the Studio banner and the GTM page show — "more data = sharper output".
async function studioPct(supabase: SupabaseClient, brandId: string): Promise<number> {
  const [{ data: kit }, products, history, documents] = await Promise.all([
    supabase
      .from('brand_kit')
      .select('about, target_audience, brand_style, ai_character, brand_colors, logos')
      .eq('brand_id', brandId)
      .maybeSingle(),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('social_post_history').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('brand_documents').select('id', { count: 'exact', head: true }).eq('brand_id', brandId)
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const character = (kit?.ai_character ?? {}) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasLogo = ((kit?.logos ?? []) as any[]).some((l) => l?.url && l?.type !== 'og-image');
  return studioCompleteness({
    products: products.count ?? 0,
    history: history.count ?? 0,
    documents: documents.count ?? 0,
    voice: !!(character.tone || character.speaking_style || kit?.brand_style),
    about: !!kit?.about,
    audience: !!kit?.target_audience,
    logo: hasLogo,
    colors: ((kit?.brand_colors ?? []) as string[]).length > 0
  }).pct;
}

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
  const brand = await requireBrand(supabase, params.brand);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prefs = (brand.content_prefs as any) ?? {};
  return {
    platforms: Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [],
    voiceMode: prefs.voiceMode === 'manual' ? 'manual' : 'auto',
    voiceFramework: prefs.voiceFramework ?? {},
    platformRules: (prefs.platformRules as Record<string, PlatformRule>) ?? {},
    avoid: Array.isArray(prefs.avoid) ? (prefs.avoid as string[]) : [],
    studioPct: await studioPct(supabase, brand.id)
  };
};

export const actions: Actions = {
  save: async ({ request, params, locals: { supabase } }) => {
    const brand = await requireBrand(supabase, params.brand);
    const fd = await request.formData();

    const mode = String(fd.get('mode') ?? '') === 'manual' ? 'manual' : 'auto';

    // Voice framework: structured fields, all optional.
    const str = (k: string, max = 400) => String(fd.get(k) ?? '').trim().slice(0, max);
    const register = Math.max(0, Math.min(100, Math.round(Number(fd.get('register')) || 50)));
    const voiceFramework = {
      purpose: str('purpose'),
      audience: str('audience'),
      tone: str('tone', 40),
      register,
      emotion: str('emotion', 200),
      character: str('character'),
      syntax: str('syntax', 40),
      terminology: str('terminology')
    };

    // Per-platform caption rules (structured) → also derived into platformInstructions strings
    // so the existing prompt pipeline (guidanceFor) applies them unchanged.
    let platformRules: Record<string, PlatformRule> = {};
    try {
      const parsed = JSON.parse(String(fd.get('platform_rules') ?? '{}'));
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed as Record<string, Partial<PlatformRule>>)) {
          const key = String(k).toLowerCase().trim();
          if (!key) continue;
          platformRules[key] = {
            tone: String(v?.tone ?? '').slice(0, 200),
            length: String(v?.length ?? '').slice(0, 200),
            emoji: String(v?.emoji ?? '').slice(0, 200),
            hashtags: String(v?.hashtags ?? '').slice(0, 200),
            structure: String(v?.structure ?? '').slice(0, 300)
          };
        }
      }
    } catch {
      platformRules = {};
    }
    const platformInstructions: Record<string, string> = {};
    for (const [k, r] of Object.entries(platformRules)) {
      const text = ruleToInstruction(r);
      if (text) platformInstructions[k] = text;
    }

    const avoid = String(fd.get('avoid') ?? '')
      .split(/[,;\n]/)
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 30);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = ((brand.content_prefs as any) ?? {}) as Record<string, unknown>;
    const { error: err } = await supabase
      .from('brands')
      .update({
        content_prefs: {
          ...existing,
          voiceMode: mode,
          voiceFramework,
          platformRules: Object.keys(platformRules).length ? platformRules : undefined,
          platformInstructions: Object.keys(platformInstructions).length ? platformInstructions : undefined,
          avoid: avoid.length ? avoid : undefined
        }
      })
      .eq('id', brand.id);
    if (err) return fail(500, { error: err.message });
    return { saved: true };
  }
};
