import type { SupabaseClient } from '@supabase/supabase-js';
import { studioCompleteness } from '$lib/studio-completeness';

// The core activation funnel, in order. The day-2/day-3 nurture email points at the FIRST
// unfinished step so the nudge always matches where the brand actually is.
export type Stage =
  | 'studio'
  | 'strategy'
  | 'plan'
  | 'generate'
  | 'approve'
  | 'connect'
  | 'publish'
  | 'done';

export type BrandStage = { stage: Stage; nextPath: string };

// ponytail: approximate signals (existence checks + the shared studio score), NOT the pixel-exact
// checklist gating in +layout.server.ts. A slightly-off nurture nudge is low-risk and not worth
// duplicating that whole computation; upgrade to the exact logic only if the drip mis-targets.
export async function brandStage(
  admin: SupabaseClient,
  brand: { id: string; slug: string }
): Promise<BrandStage> {
  const base = `/app/${brand.slug}`;
  const eq = (table: string, extra: (q: any) => any = (q) => q) =>
    extra(admin.from(table).select('id', { count: 'exact', head: true }).eq('brand_id', brand.id));

  const [kitRes, products, history, documents, gtm, plan, pending, approved, live, socials] =
    await Promise.all([
      admin
        .from('brand_kit')
        .select('about, target_audience, brand_colors, brand_style, ai_character, logos')
        .eq('brand_id', brand.id)
        .maybeSingle(),
      eq('products'),
      eq('social_post_history'),
      eq('brand_documents'),
      eq('gtm_plans', (q) => q.eq('status', 'active')),
      eq('editorial_plans', (q) => q.eq('status', 'active')),
      eq('posts', (q) => q.eq('status', 'pending_user')),
      eq('posts', (q) => q.eq('status', 'approved')),
      eq('posts', (q) => q.in('status', ['published', 'scheduled'])),
      eq('social_accounts', (q) => q.eq('status', 'active'))
    ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kit = (kitRes.data as any) ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const character = (kit.ai_character ?? {}) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasLogo = ((kit.logos ?? []) as any[]).some((l) => l?.url && l?.type !== 'og-image');
  const studioPct = studioCompleteness({
    products: products.count ?? 0,
    history: history.count ?? 0,
    documents: documents.count ?? 0,
    voice: !!(character.tone || character.speaking_style || kit.brand_style),
    about: !!kit.about,
    audience: !!kit.target_audience,
    logo: hasLogo,
    colors: Array.isArray(kit.brand_colors) && kit.brand_colors.length > 0
  }).pct;

  const posts = (pending.count ?? 0) + (approved.count ?? 0) + (live.count ?? 0);
  const stage: Stage =
    studioPct < 80
      ? 'studio'
      : (gtm.count ?? 0) === 0
        ? 'strategy'
        : (plan.count ?? 0) === 0
          ? 'plan'
          : posts === 0
            ? 'generate'
            : (approved.count ?? 0) + (live.count ?? 0) === 0
              ? 'approve'
              : (socials.count ?? 0) === 0
                ? 'connect'
                : (live.count ?? 0) === 0
                  ? 'publish'
                  : 'done';

  const path: Record<Stage, string> = {
    studio: `${base}/settings/brand`,
    strategy: `${base}/gtm`,
    plan: `${base}/plan`,
    generate: `${base}/plan`,
    approve: `${base}/calendar`,
    connect: `${base}/activate`,
    publish: `${base}/activate`,
    done: base
  };
  return { stage, nextPath: path[stage] };
}
