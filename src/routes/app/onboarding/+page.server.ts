import { swallow } from '$lib/server/swallow';
import { redirect, fail } from '@sveltejs/kit';
import { soleTenantId } from '$lib/server/tenancy';
import { decideOnboardingTarget } from '$lib/server/onboarding-target';
import { canEnter } from '$lib/server/access';
import type { Actions, PageServerLoad } from './$types';
import { ensureOrgForUser } from '$lib/server/org';
import { slugifyBrand, uniqueSlug } from '$lib/brand-slug';
import { materializeBrandHistory, type ScrapeTarget } from '$lib/server/scrapecreators';
import { rebuildBrandContext } from '$lib/server/brand-context';
import { competitiveDelta } from '$lib/server/research';
import { normalizePlan, stampWeekStarts, CADENCES } from '$lib/server/editorial-plan';
import { isPlanKey, normalizeCycle } from '$lib/plans';
import { isPlanGoEnabled } from '$lib/server/feature-flags';
import { canStartNewSlot } from '$lib/server/brand-limits';
import { seedSourcesForBrand } from '$lib/server/radar';
import { localeLanguageName } from '$lib/i18n/locale';
import { createAdminClient } from '$lib/server/supabase-admin';
import { logOnboardingError } from '$lib/server/onboarding-errors';
import { kickSocialHistoryWork } from '$lib/server/social-history-work';
import { tryRedeemReferral } from '$lib/server/referrals';
import { latestOnboardingStepJob } from '$lib/server/onboarding-steps';
import { seedOnboardingChat } from '$lib/server/onboarding-chat';
import { kickChatQueueWork } from '$lib/server/chat/queue';
import { insertBrandWithSlug } from '$lib/server/brand-create';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cookies } from '@sveltejs/kit';

/** Best-effort referral redeem after a brand insert. Never blocks onboarding. */
async function redeemReferralQuietly(
  cookies: Cookies,
  userId: string,
  brandId: string
): Promise<void> {
  try {
    await tryRedeemReferral({ cookies, refereeUserId: userId, refereeBrandId: brandId });
  } catch (e) {
    console.warn('[onboarding] referral redeem failed:', e instanceof Error ? e.message : e);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

function scheduleSocialHistory(platform: unknown, origin: string, brandId: string) {
  const kick = kickSocialHistoryWork(origin, brandId);
  const p = platform as Platform;
  if (p?.context?.waitUntil) p.context.waitUntil(kick);
  else void kick;
}

/**
 * Il nuovo atterraggio dell'onboarding: il thread di setup, dove il primo messaggio visibile è
 * l'URL che l'utente ha digitato e il vero incarico viaggia lato server (onboarding-chat.ts).
 * Se il seed fallisce si atterra sulla dashboard come prima — il create non deve mai bloccarsi
 * per colpa della chat.
 */
async function setupChatTarget(
  platform: unknown,
  origin: string,
  brand: { id: string; slug: string },
  userId: string,
  website: string | null,
  name: string,
  locale: string
): Promise<string> {
  const threadId = await seedOnboardingChat(createAdminClient(), {
    brandId: brand.id,
    userId,
    website,
    brandName: name,
    locale,
    origin
  });
  if (!threadId) return `/app/${brand.slug}`;
  // Parte subito, non al prossimo cron: stesso pattern waitUntil della social history.
  const kick = kickChatQueueWork(origin);
  const p = platform as Platform;
  if (p?.context?.waitUntil) p.context.waitUntil(kick);
  else void kick;
  return `/app/${brand.slug}/chat/${threadId}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJson<T>(raw: string, fallback: T): T {
  try {
    const v = raw ? JSON.parse(raw) : fallback;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseScrapeTargets(raw: string): ScrapeTarget[] {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((h: any) => ({
        platform: String(h?.platform ?? '').toLowerCase(),
        username: h?.username ? String(h.username).trim().replace(/^@/, '') : null,
        profileUrl: h?.profileUrl ? String(h.profileUrl).trim() : null
      }))
      .filter((h) => h.platform && (h.username || h.profileUrl));
  } catch {
    return [];
  }
}

async function requireAdmin(
  supabase: App.Locals['supabase'],
  safeGetSession: App.Locals['safeGetSession']
) {
  const { session, user } = await safeGetSession();
  if (!session || !user) throw redirect(303, '/');
  if (!(await canEnter(supabase))) throw redirect(303, '/waitlist');
  return user;
}

function parseProfile(data: FormData): Record<string, unknown> | null {
  const profileRaw = String(data.get('profile') ?? '');
  if (!profileRaw) return null;
  try {
    return JSON.parse(profileRaw);
  } catch {
    return null;
  }
}

function parsePlatforms(data: FormData): string[] {
  try {
    const parsed = JSON.parse(String(data.get('platforms') ?? '') || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function resolveBrandId(
  supabase: SupabaseClient,
  userId: string,
  draftId: string,
  clientBrandId = ''
): Promise<string> {
  if (clientBrandId) return clientBrandId;
  if (draftId) {
    const { data: draftRow } = await supabase
      .from('onboarding_drafts')
      .select('draft')
      .eq('id', draftId)
      .eq('user_id', userId)
      .maybeSingle();
    const fromDraft = ((draftRow?.draft as Record<string, unknown>)?.brandId as string) ?? null;
    if (fromDraft) return fromDraft;
  }
  const { randomUUID } = await import('node:crypto');
  return randomUUID();
}

async function persistBrandKit(
  supabase: SupabaseClient,
  brandId: string,
  profile: Record<string, unknown> | null,
  website: string | null,
  locale: App.Locals['locale'],
  opts: { seedRadar?: boolean } = {}
) {
  const seedRadar = opts.seedRadar !== false;
  if (profile) {
    await supabase.from('brand_kit').upsert(
      {
        brand_id: brandId,
        category: profile.category ?? null,
        site_type: profile.site_type ?? null,
        content_pillars: profile.content_pillars ?? null,
        about: profile.about ?? null,
        brand_style: profile.brand_style ?? null,
        target_audience: profile.target_audience ?? null,
        brand_colors: profile.brand_colors ?? null,
        theme_color: profile.theme_color ?? null,
        favicon_url: profile.favicon_url ?? null,
        logos: profile.logos ?? null,
        fonts: profile.fonts ?? null,
        ai_character: profile.ai_character ?? null,
        images: profile.images ?? null,
        source_url: (profile.url as string) ?? website
      },
      { onConflict: 'brand_id' }
    );

    const products = Array.isArray(profile.products) ? profile.products : [];
    if (products.length) {
      // Early create / continue: only seed products when the brand has none yet.
      const { count } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId);
      if (!count) {
        await supabase.from('products').insert(
          products.map((p: Record<string, unknown>) => ({
            brand_id: brandId,
            title: (p.name as string) ?? 'Product',
            description: (p.description as string) ?? null,
            kind: (p.productType as string) ?? (p.kind as string) ?? 'product',
            pricing: (p.pricing as string) ?? null,
            images: p.images ?? null
          }))
        );
      }
    }

    // Early create defers radar seeding to the social-history worker (own 300s budget).
    if (seedRadar) {
      try {
        const admin = createAdminClient();
        const { data: brandPlan } = await admin.from('brands').select('plan').eq('id', brandId).maybeSingle();
        await seedSourcesForBrand(
          admin,
          brandId,
          profile as never,
          localeLanguageName(locale),
          brandPlan?.plan ?? null
        );
      } catch (error) { swallow('analyze website', error); }
    }
  } else {
    await supabase.from('brand_kit').upsert({ brand_id: brandId, source_url: website }, { onConflict: 'brand_id' });
  }
}

async function persistHandlesAndContext(
  supabase: SupabaseClient,
  brandId: string,
  scrapeTargets: ScrapeTarget[],
  additionalContext: string,
  delta: string,
  profile: Record<string, unknown> | null,
  /** Early create skips inline scrape — social history runs in its own 300s worker. */
  opts: { syncHistory?: boolean } = {}
) {
  const syncHistory = opts.syncHistory !== false;

  if (scrapeTargets.length) {
    await supabase.from('brand_social_handles').upsert(
      scrapeTargets.map((t) => ({
        brand_id: brandId,
        platform: t.platform,
        username: t.username,
        profile_url: t.profileUrl
      })),
      { onConflict: 'brand_id,platform' }
    );
  }

  if (additionalContext) {
    await supabase.from('brand_documents').insert({
      brand_id: brandId,
      kind: 'note',
      title: 'Onboarding context',
      content_text: additionalContext
    });
  }

  if (!syncHistory) return;

  try {
    let historySynced = 0;
    if (scrapeTargets.length) {
      const res = await materializeBrandHistory(supabase, brandId, scrapeTargets);
      historySynced = res.synced;
    }
    if (historySynced > 0 || additionalContext || delta) {
      if (!profile) await supabase.from('brand_kit').upsert({ brand_id: brandId }, { onConflict: 'brand_id' });
      await rebuildBrandContext(supabase, brandId, undefined, delta);
    }
  } catch (error) { swallow('rebuild brand context', error); }
}

async function persistSecondHalf(
  supabase: SupabaseClient,
  brand: { id: string; timezone: string | null },
  data: FormData
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const planRaw = parseJson<any>(String(data.get('editorial_plan') ?? ''), null);
  let editorialPlanId: string | null = null;
  if (planRaw && typeof planRaw === 'object') {
    const plan = normalizePlan(planRaw, [...CADENCES]);
    const weeks = stampWeekStarts(plan.weeks, (brand.timezone as string) || 'Europe/Rome');
    if (weeks[0]) weeks[0].status = 'planned';
    const { data: planRow } = await supabase
      .from('editorial_plans')
      .insert({
        brand_id: brand.id,
        status: 'active',
        strategy: plan.strategy || null,
        voice: plan.voice,
        cadence: plan.cadence,
        platform_mix: plan.platform_mix,
        gtm: plan.gtm,
        weeks,
        source: 'onboarding',
        activated_at: new Date().toISOString()
      })
      .select('id')
      .single();
    editorialPlanId = (planRow?.id as string) ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const people = parseJson<any[]>(String(data.get('people') ?? ''), []);
  if (Array.isArray(people) && people.length) {
    const { count } = await supabase
      .from('people')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brand.id);
    if (!count) {
      await supabase.from('people').insert(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        people.slice(0, 8).map((p: any) => ({
          brand_id: brand.id,
          name: String(p?.name ?? '').trim() || 'Creator',
          role: String(p?.role ?? '').trim() || null,
          kind: 'real',
          images: Array.isArray(p?.images) ? p.images : [],
          // Carried from the wizard, never assumed here: a detected person arrives unattested and
          // stays unusable until the owner confirms consent in Studio → People.
          consent: p?.consent === true,
          consent_at: p?.consent === true ? new Date().toISOString() : null,
          consent_source: p?.consent === true ? 'owner_attested' : 'import_unattested'
        }))
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const competitors = parseJson<any[]>(String(data.get('competitors') ?? ''), []);
  if (Array.isArray(competitors) && competitors.length) {
    const { count } = await supabase
      .from('competitors')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brand.id);
    if (!count) {
      await supabase.from('competitors').insert(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        competitors.slice(0, 8).map((c: any) => ({
          brand_id: brand.id,
          name: String(c?.name ?? '').trim() || 'Competitor',
          website: c?.website ? String(c.website).trim() : null,
          kind: c?.kind === 'indirect' ? 'indirect' : 'direct',
          rationale: c?.rationale ? String(c.rationale) : null,
          handles: c?.handles ?? null,
          top_posts: c?.top_posts ?? null,
          benchmark: c?.benchmark ?? null,
          source: c?.source === 'user' ? 'user' : 'ai'
        }))
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategy = parseJson<any>(String(data.get('strategy') ?? ''), null);
  if (strategy && (strategy.report || strategy.benchmark || strategy.positioning)) {
    await supabase.from('brand_strategy').upsert(
      {
        brand_id: brand.id,
        report: strategy.report ?? null,
        benchmark: strategy.benchmark ?? null,
        positioning: strategy.positioning ?? null,
        citations: strategy.citations ?? null,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'brand_id' }
    );
  }

  let contentPrefs: Record<string, unknown> | null = null;
  const prefsRaw = String(data.get('prefs') ?? '');
  if (prefsRaw) {
    try {
      const p = JSON.parse(prefsRaw);
      if (p && typeof p === 'object' && Object.values(p).some(Boolean)) contentPrefs = p;
    } catch {
      contentPrefs = null;
    }
  }
  if (contentPrefs) {
    await supabase.from('brands').update({ content_prefs: contentPrefs }).eq('id', brand.id);
  }

  const postsRaw = String(data.get('posts') ?? '');
  let previewPosts: Record<string, unknown>[] = [];
  if (postsRaw) {
    try {
      previewPosts = JSON.parse(postsRaw);
    } catch {
      previewPosts = [];
    }
  }
  if (Array.isArray(previewPosts) && previewPosts.length) {
    const { data: plan } = await supabase
      .from('content_plans')
      .insert({
        brand_id: brand.id,
        title: 'First week',
        status: 'proposed',
        editorial_plan_id: editorialPlanId,
        editorial_week: editorialPlanId ? 0 : null
      })
      .select('id')
      .single();

    await supabase.from('posts').insert(
      previewPosts.slice(0, 12).map((p) => ({
        brand_id: brand.id,
        plan_id: plan?.id ?? null,
        platform: String(p.platform ?? '').toLowerCase() || null,
        platforms: Array.isArray(p.platforms) && (p.platforms as string[]).length > 1 ? p.platforms : null,
        format: (p.format as string) ?? null,
        content_type: p.media === 'text' ? 'text' : 'generated_image',
        source: 'plan',
        caption: (p.caption as string) ?? null,
        image_prompt: (p.image_prompt as string) ?? null,
        media_url: (p.imageUrl as string) ?? null,
        product_name: (p.product as string)?.trim() || null,
        pillar: (p.pillar as string)?.trim() || null,
        slot: [p.day, p.time].filter(Boolean).join(' ') || null,
        status: 'pending_user',
        alt_captions: Array.isArray(p.alt_captions) && p.alt_captions.length ? p.alt_captions : null,
        platform_captions: p.platform_captions && Object.keys(p.platform_captions).length ? p.platform_captions : null,
        first_comment: (p.first_comment as string)?.trim() || null,
        hook_variants: Array.isArray(p.hook_variants) && p.hook_variants.length ? p.hook_variants : null
      }))
    );
  }

  return strategy?.report ? competitiveDelta(strategy.report) : '';
}

export const config = { maxDuration: 300 };

export const load: PageServerLoad = async ({ url, locals: { supabase, safeGetSession } }) => {
  const user = await requireAdmin(supabase, safeGetSession);

  // Resume the optional second half (people → preview) for a brand created after site+socials analysis.
  const continueSlug = url.searchParams.get('continue');
  if (continueSlug) {
    const { data: brand } = await supabase
      .from('brands')
      .select(
        'id, name, slug, website, target_platforms, onboarding_completed_at, brand_kit(about, source_url, category, site_type, content_pillars, brand_style, target_audience, brand_colors, theme_color, favicon_url, logos, fonts, ai_character, images), brand_social_handles(platform, username, profile_url)'
      )
      .eq('slug', continueSlug)
      .maybeSingle();
    if (!brand) throw redirect(303, '/app');
    // Already finished the full wizard — nothing left to resume.
    if (brand.onboarding_completed_at) throw redirect(303, `/app/${brand.slug}`);

    const kitRaw = brand.brand_kit;
    const kit = (Array.isArray(kitRaw) ? kitRaw[0] : kitRaw) as Record<string, unknown> | null;
    const handlesRaw = brand.brand_social_handles;
    const handlesRows = Array.isArray(handlesRaw) ? handlesRaw : [];

    // Resume market study / plan from the durable research job when the user left mid-step.
    const researchJob = await latestOnboardingStepJob(
      supabase,
      user.id,
      brand.id as string,
      'research'
    );
    const research =
      researchJob &&
      (researchJob.status === 'pending' ||
        researchJob.status === 'running' ||
        researchJob.status === 'done')
        ? {
            id: researchJob.id,
            status: researchJob.status,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            result: (researchJob.result as Record<string, any> | null) ?? null,
            progress: researchJob.progress ?? {}
          }
        : null;

    return {
      draftId: null,
      draft: null,
      draftPhase: null,
      draftUpdatedAt: null,
      userEmail: user.email ?? null,
      continueBrand: {
        id: brand.id as string,
        name: brand.name as string,
        slug: brand.slug as string,
        website: (brand.website as string | null) ?? null,
        targetPlatforms: Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [],
        research,
        profile: kit
          ? {
              name: brand.name,
              about: kit.about ?? null,
              url: kit.source_url ?? brand.website ?? '',
              category: kit.category ?? null,
              site_type: kit.site_type ?? null,
              content_pillars: kit.content_pillars ?? null,
              brand_style: kit.brand_style ?? null,
              target_audience: kit.target_audience ?? null,
              brand_colors: kit.brand_colors ?? null,
              theme_color: kit.theme_color ?? null,
              favicon_url: kit.favicon_url ?? null,
              logos: kit.logos ?? null,
              fonts: kit.fonts ?? null,
              ai_character: kit.ai_character ?? null,
              images: kit.images ?? null
            }
          : { name: brand.name, about: '', url: brand.website ?? '' },
        handles: Object.fromEntries(
          handlesRows
            .map((h) => {
              const platform = String((h as { platform?: string }).platform ?? '').toLowerCase();
              const username = (h as { username?: string | null }).username;
              const profileUrl = (h as { profile_url?: string | null }).profile_url;
              const value = username || profileUrl || '';
              return platform && value ? [platform, value] : null;
            })
            .filter((x): x is [string, string] => !!x)
        ) as Record<string, string>
      }
    };
  }

  const draftId = url.searchParams.get('draft');
  if (!draftId) {
    if (!(await canStartNewSlot(supabase, user.id, { email: user.email }))) throw redirect(303, '/app');
    return {
      draftId: null,
      draft: null,
      draftPhase: null,
      draftUpdatedAt: null,
      continueBrand: null,
      userEmail: user.email ?? null
    };
  }
  const { data: draftRow } = await supabase
    .from('onboarding_drafts')
    .select('id, phase, draft, updated_at')
    .eq('id', draftId)
    .eq('user_id', user.id)
    .maybeSingle();
  return {
    draftId: (draftRow?.id as string | null) ?? null,
    draft: (draftRow?.draft as Record<string, unknown> | null) ?? null,
    draftPhase: (draftRow?.phase as string | null) ?? null,
    draftUpdatedAt: (draftRow?.updated_at as string | null) ?? null,
    continueBrand: null,
    userEmail: user.email ?? null
  };
};

export const actions: Actions = {
  // Required half: site + socials + analysis → create brand → dashboard. Strategy/plan/posts later.
  // Social history (ScrapeCreators + thumbnail archive + radar seed) runs in a SEPARATE worker
  // (/api/v1/onboarding/social-history/work, 300s) so create stays a fast DB+redirect path.
  create: async ({ request, url, platform, cookies, locals: { supabase, safeGetSession, locale } }) => {
    const user = await requireAdmin(supabase, safeGetSession);
    const data = await request.formData();
    const website = String(data.get('website') ?? '').trim() || null;
    const profile = parseProfile(data);
    const name = (String(data.get('name') ?? '').trim() || (profile?.name as string) || '').trim();
    if (!name) return fail(400, { error: 'Brand name is required', website });

    const draftId = String(data.get('draft_id') ?? '');
    if (!(await canStartNewSlot(supabase, user.id, { excludeDraftId: draftId || undefined, email: user.email }))) {
      await logOnboardingError(supabase, user.id, 'early_create', 'slotLimit', { website, name });
      return fail(403, { error: 'slotLimit', name, website });
    }

    const orgId = await ensureOrgForUser(supabase, user);
    if (!orgId) {
      await logOnboardingError(supabase, user.id, 'early_create', 'Could not create your workspace', {
        website,
        name
      });
      return fail(500, { error: 'Could not create your workspace', name, website });
    }

    const websiteNorm = website ?? (profile?.url as string) ?? null;
    // Recover from a prior attempt that inserted then timed out (client brandId may have drifted).
    if (websiteNorm) {
      const { data: bySite } = await supabase
        .from('brands')
        .select('id, slug, timezone')
        .eq('org_id', orgId)
        .eq('website', websiteNorm)
        .maybeSingle();
      if (bySite) {
        await persistBrandKit(supabase, bySite.id, profile, website, locale, { seedRadar: false });
        const scrapeTargets = parseScrapeTargets(String(data.get('handles') ?? ''));
        await persistHandlesAndContext(supabase, bySite.id, scrapeTargets, '', '', profile, {
          syncHistory: false
        });
        if (draftId) await supabase.from('onboarding_drafts').delete().eq('id', draftId).eq('user_id', user.id);
        scheduleSocialHistory(platform, url.origin, bySite.id);
        await redeemReferralQuietly(cookies, user.id, bySite.id);
        throw redirect(
          303,
          await setupChatTarget(platform, url.origin, bySite, user.id, websiteNorm, name, locale)
        );
      }
    }

    const targetPlatforms = parsePlatforms(data);

    // Con un tenant solo il brand esiste gia' (`npm run db:seed`) e il wizard lo RIEMPIE invece di
    // crearne un secondo: sito analizzato, persone, concorrenti, strategia, piano. Una riga appena
    // creata non ha niente di tutto questo, quindi l'onboarding serve eccome — cambia il bersaglio.
    const target = decideOnboardingTarget({
      soleTenantId: soleTenantId(),
      proposedId: await resolveBrandId(
        supabase,
        user.id,
        draftId,
        String(data.get('brand_id') ?? '').trim()
      ),
      proposedSlug: await (async () => {
        if (soleTenantId()) return '';
        const { data: existing } = await supabase.from('brands').select('slug').eq('org_id', orgId);
        return uniqueSlug(slugifyBrand(name, websiteNorm), (existing ?? []).map((b) => b.slug as string));
      })()
    });
    const brandId = target.brandId;
    const slug = target.kind === 'create' ? target.slug : '';

    // A prior attempt may have inserted the row then timed out before the redirect — reuse it.
    const { data: prior } = await supabase
      .from('brands')
      .select('id, slug, timezone')
      .eq('id', brandId)
      .maybeSingle();

    let brand = prior;

    // Il brand unico deve esistere: se non c'e', l'installazione e' incompleta e va detto, non
    // aggirato creandone uno che poi TENANT_BRAND_ID non punterebbe.
    if (target.kind === 'fill') {
      if (!brand) {
        await logOnboardingError(supabase, user.id, 'sole_tenant_missing', 'TENANT_BRAND_ID punta a un brand inesistente', { brandId });
        return fail(500, { error: `TENANT_BRAND_ID punta a un brand che non esiste (${brandId}). Esegui npm run db:seed.`, name, website });
      }
      // Lo slug NON si tocca: verrebbe dal nome appena scritto e cambierebbe l'URL sotto i piedi,
      // per distinguere il brand da nessun altro.
      await supabase
        .from('brands')
        .update({ name, website: websiteNorm, ...(targetPlatforms.length ? { target_platforms: targetPlatforms } : {}) })
        .eq('id', brand.id);
    }

    if (!brand) {
      const { data: inserted, error } = await insertBrandWithSlug(supabase, {
        id: brandId,
        org_id: orgId,
        created_by: user.id,
        // Left null until people → preview finishes (or the user never resumes — that's fine).
        onboarding_completed_at: null,
        name,
        website: websiteNorm,
        slug,
        target_platforms: targetPlatforms.length ? targetPlatforms : null
      });
      if (error || !inserted) {
        await logOnboardingError(
          supabase,
          user.id,
          'early_create',
          error ?? 'Could not create brand',
          { website, name, brandId, slug }
        );
        return fail(500, { error: error ?? 'Could not create brand', name, website });
      }
      brand = inserted;
    }

    // Kit + handles only — radar seed and ScrapeCreators run in the social-history worker.
    await persistBrandKit(supabase, brand.id, profile, website, locale, { seedRadar: false });

    const scrapeTargets = parseScrapeTargets(String(data.get('handles') ?? ''));
    await persistHandlesAndContext(supabase, brand.id, scrapeTargets, '', '', profile, {
      syncHistory: false
    });

    if (draftId) await supabase.from('onboarding_drafts').delete().eq('id', draftId).eq('user_id', user.id);

    scheduleSocialHistory(platform, url.origin, brand.id);
    await redeemReferralQuietly(cookies, user.id, brand.id);
    throw redirect(
      303,
      await setupChatTarget(platform, url.origin, brand, user.id, websiteNorm, name, locale)
    );
  },

  // Optional second half: enrich an existing brand (continue=) or legacy full submit.
  // MUST stay a named action: SvelteKit throws on any POST to a page that mixes `default` with
  // named actions, which took down BOTH this submit and `?/create` above.
  finish: async ({ request, cookies, locals: { supabase, safeGetSession, locale } }) => {
    const user = await requireAdmin(supabase, safeGetSession);
    const data = await request.formData();
    const website = String(data.get('website') ?? '').trim() || null;
    const profile = parseProfile(data);
    const name = (String(data.get('name') ?? '').trim() || (profile?.name as string) || '').trim();
    if (!name) return fail(400, { error: 'Brand name is required', website });

    const existingBrandId = String(data.get('brand_id') ?? '').trim();
    const draftId = String(data.get('draft_id') ?? '');

    // ── Continue path: brand already exists from the early create ──
    if (existingBrandId) {
      const { data: brand } = await supabase
        .from('brands')
        .select('id, slug, timezone, onboarding_completed_at')
        .eq('id', existingBrandId)
        .maybeSingle();
      if (!brand) return fail(404, { error: 'Brand not found', name, website });

      const delta = await persistSecondHalf(supabase, brand, data);
      const additionalContext = String(data.get('additional_context') ?? '').trim();
      const scrapeTargets = parseScrapeTargets(String(data.get('handles') ?? ''));
      // Context note + competitive delta → refresh AI context; handles usually already saved.
      if (additionalContext || delta) {
        await persistHandlesAndContext(supabase, brand.id, scrapeTargets, additionalContext, delta, profile);
      }

      await supabase
        .from('brands')
        .update({ onboarding_completed_at: new Date().toISOString() })
        .eq('id', brand.id);

      if (draftId) await supabase.from('onboarding_drafts').delete().eq('id', draftId).eq('user_id', user.id);
      await redeemReferralQuietly(cookies, user.id, brand.id);
      throw redirect(303, `/app/${brand.slug}`);
    }

    // ── Legacy full path (draft resumed through preview without early create) ──
    if (!(await canStartNewSlot(supabase, user.id, { excludeDraftId: draftId || undefined, email: user.email }))) {
      return fail(403, { error: 'slotLimit', name, website });
    }

    const orgId = await ensureOrgForUser(supabase, user);
    if (!orgId) return fail(500, { error: 'Could not create your workspace', name, website });

    const { data: existing } = await supabase.from('brands').select('slug').eq('org_id', orgId);
    const slug = uniqueSlug(
      slugifyBrand(name, website),
      (existing ?? []).map((b) => b.slug as string)
    );

    const targetPlatforms = parsePlatforms(data);
    let contentPrefs: Record<string, unknown> | null = null;
    const prefsRaw = String(data.get('prefs') ?? '');
    if (prefsRaw) {
      try {
        const p = JSON.parse(prefsRaw);
        if (p && typeof p === 'object' && Object.values(p).some(Boolean)) contentPrefs = p;
      } catch {
        contentPrefs = null;
      }
    }

    const brandId = await resolveBrandId(
      supabase,
      user.id,
      draftId,
      String(data.get('brand_id') ?? '').trim()
    );

    const { data: brand, error } = await insertBrandWithSlug(
      supabase,
      {
        id: brandId,
        org_id: orgId,
        created_by: user.id,
        onboarding_completed_at: new Date().toISOString(),
        name,
        website: website ?? (profile?.url as string) ?? null,
        slug,
        target_platforms: targetPlatforms.length ? targetPlatforms : null,
        content_prefs: contentPrefs
      },
      'id, timezone'
    );
    if (error || !brand) return fail(500, { error: error ?? 'Could not create brand', name, website });

    await persistBrandKit(supabase, brand.id, profile, website, locale);
    const delta = await persistSecondHalf(supabase, brand, data);
    const scrapeTargets = parseScrapeTargets(String(data.get('handles') ?? ''));
    const additionalContext = String(data.get('additional_context') ?? '').trim();
    await persistHandlesAndContext(supabase, brand.id, scrapeTargets, additionalContext, delta, profile);

    if (draftId) await supabase.from('onboarding_drafts').delete().eq('id', draftId).eq('user_id', user.id);

    // Prefer the dashboard; paywall stays action-level. Carry plan params if they came from pricing.
    const plan = String(data.get('plan') ?? '');
    const cycle = String(data.get('cycle') ?? '');
    const pay = new URLSearchParams();
    if (isPlanKey(plan) && (plan !== 'go' || isPlanGoEnabled())) {
      pay.set('plan', plan);
      pay.set('cycle', normalizeCycle(cycle));
    }
    await redeemReferralQuietly(cookies, user.id, brand.id);
    throw redirect(303, `/app/${slug}${pay.toString() ? `?${pay}` : ''}`);
  }
};
