import { swallow } from '$lib/server/swallow';
import { error, redirect } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import { studioCompleteness } from '$lib/studio-completeness';
import { getOnboardingState } from '$lib/server/onboarding';
import { computeBrandWarnings } from '$lib/warnings';
import { agentNoticeToWarning, listAgentNotices } from '$lib/server/brand-warnings';
import { radarPrefsOf } from '$lib/server/radar';
import { remaining } from '$lib/server/usage';
import { countCalendarConflicts } from '$lib/server/schedule';
import { canConnectSocials } from '$lib/plans';
import { env } from '$env/dynamic/private';
import { isAdsPreviewUser } from '$lib/server/internal-users';
import { LAST_BRAND_COOKIE, LAST_BRAND_COOKIE_MAX_AGE } from '$lib/shell-prefs';
import { createAdminClient } from '$lib/server/supabase-admin';
import { gscConfigured, loadGscReady } from '$lib/server/gsc';
import {
  getBrandDeferred,
  setBrandDeferred
} from '$lib/server/nav-cache';
import { resolveTenant } from '$lib/server/tenant';
import type { LayoutServerLoad } from './$types';
import { chatModelChoices } from '$lib/server/chat-models';

// Flag globali da env (Vercel, nessun rebuild con $env/dynamic).
// `ads` è ORTOGONALE a hasAds(plan): il piano dice CHI può usarlo, il flag se esiste. Default OFF.
// `connectors` default ON — la pagina è già spedita, quindi FEATURE_CONNECTORS=false è un
// interruttore di spegnimento, non un opt-in. Gli altri default OFF.
const FLAGS = {
  studio: env.FEATURE_STUDIO === 'true',
  designStudio: env.FEATURE_DESIGN_STUDIO === 'true',
  ads: env.FEATURE_ADS === 'true',
  connectors: env.FEATURE_CONNECTORS !== 'false',
  navTeam: env.FEATURE_NAV_TEAM === 'true',
  // `groupChats`: stesso interruttore che il server legge in `$lib/server/chat/room.ts`. Il client
  // lo riceve solo per mostrare o nascondere il modo di CREARE una stanza: la verità resta di là.
  groupChats: env.GROUP_CHATS === 'true'
};

// `phases` è o l'oggetto doppio { horizon_90d, horizon_6m } o un array legacy a orizzonte singolo.
// Rispecchia il parse di gtm.ts/gtmRowToPlan, che resta la fonte di verità.
function gtmPhasesHaveContent(phases: unknown): boolean {
  if (Array.isArray(phases)) return phases.length > 0;
  if (phases && typeof phases === 'object') {
    const o = phases as Record<string, unknown>;
    return (Array.isArray(o.horizon_90d) && o.horizon_90d.length > 0) || (Array.isArray(o.horizon_6m) && o.horizon_6m.length > 0);
  }
  return false;
}

export const load: LayoutServerLoad = async ({ url, params, cookies, locals: { supabase, safeGetSession } }) => {
  // La home del brand era la chat: tolta quella, il guscio non ha più niente da mostrare lì e il
  // workbench È la home. Il rimando sta QUI e non in un +page.server.ts perché quello correva in
  // parallelo a questo load: chiudeva la risposta prima che la riga sotto scrivesse il cookie
  // dell'ultimo brand, e SvelteKit rifiutava con «cookies.set after the response has been
  // generated». Qui il rimando parte prima di ogni attesa, quindi non c'è corsa da perdere.
  if (decodeURIComponent(url.pathname).replace(/\/$/, '') === `/app/${params.brand}`) {
    redirect(302, `/app/${encodeURIComponent(params.brand)}/workbench`);
  }

  // Le pagine fanno `await parent()`: questa sezione bloccante È tutto il ritardo fra una pagina
  // e l'altra, oltre alle query della pagina stessa.
  const cookieSessionP = supabase.auth.getSession();
  const authP = safeGetSession();
  const enterP = canEnter(supabase);

  const {
    data: { session: cookieSession }
  } = await cookieSessionP;
  let userId = cookieSession?.user?.id ?? null;
  if (!userId) {
    const { session } = await authP;
    if (!session) throw redirect(303, '/login');
    userId = session.user.id;
  }

  const shellP = resolveTenant(supabase, userId, params.brand);

  const [{ session, user }, allowed, shell] = await Promise.all([authP, enterP, shellP]);
  if (!session) throw redirect(303, '/login');
  if (!allowed) throw redirect(303, '/waitlist');

  const brand = shell.brand as any;
  const brandRows = shell.peers;

  if (!brand) throw error(404, 'Brand not found');

  if (cookies.get(LAST_BRAND_COOKIE) !== brand.slug) {
    cookies.set(LAST_BRAND_COOKIE, brand.slug, {
      path: '/',
      maxAge: LAST_BRAND_COOKIE_MAX_AGE,
      sameSite: 'lax',
      httpOnly: false
    });
  }

  const kit = Array.isArray(brand.brand_kit) ? brand.brand_kit[0] : brand.brand_kit;
  const logos = (kit?.logos as Array<{ url?: string }> | null) ?? null;
  const logoUrl = logos?.find((l) => l?.url)?.url ?? kit?.favicon_url ?? null;

  const switcherBrands = (brandRows ?? []).map((b) => {
    const k = Array.isArray(b.brand_kit) ? b.brand_kit[0] : b.brand_kit;
    const ls = (k?.logos as Array<{ url?: string }> | null) ?? null;
    const url = ls?.find((l) => l?.url)?.url ?? k?.favicon_url ?? null;
    return {
      id: b.id as string,
      name: b.name as string,
      slug: b.slug as string,
      status: (b.status as string) ?? 'trial',
      logoUrl: url as string | null
    };
  });

  // Il paywall è a livello di AZIONE, non di navigazione: un brand non attivato può girare tutta
  // la dashboard in sola lettura. Pubblicazione e scheduling restano bloccati altrove.

  let onboarding = getOnboardingState((brand as { onboarding_state?: unknown }).onboarding_state);
  if (brand.setup_completed_at && onboarding.status === 'in_progress') {
    onboarding = { ...onboarding, status: 'completed' };
  }

  const setupNeeded = brand.status === 'active' && !brand.setup_completed_at;

  // Il narrowing di TS su `brand`/`user` non entra nella closure qui sotto: si catturano i valori
  // già validati, così loadDeferred non deve ricontrollarli.
  const brandRow = brand;
  const userRow = user!;

  // Da qui in giù è decorazione (badge, avvisi, quota, identità): niente di tutto ciò decide un
  // redirect o blocca il guscio, quindi arriva in streaming dietro una promessa sola invece di
  // far aspettare ~20 query a ogni navigazione.
  async function loadDeferred() {
    const [
      { count: pendingCount },
      { count: leadsPendingCount },
      { data: gtmPlans },
      { data: editPlans },
      { data: linkedContentPlans },
      { count: productCount },
      { count: historyCount },
      { count: documentCount },
      { data: connectedAccts },
      { data: strategyRow },
      { data: generatedPosts },
      { count: failedPostCount },
      { count: attentionPostCount },
      { count: radarReviewCount },
      { count: peopleCount },
      { count: competitorCount },
      { count: proposedGtmCount },
      { count: proposedEditCount },
      { count: geoAuditCount },
      { data: gscConn },
      budget,
      { data: profile },
      gscReady,
      { data: kitExtras }
    ] = await Promise.all([
      supabase.from('posts').select('id', { count: 'exact', head: true }).eq('brand_id', brandRow.id).eq('status', 'pending_user'),
      supabase.from('brand_news_items').select('id', { count: 'exact', head: true }).eq('brand_id', brandRow.id).eq('status', 'suggested').not('suggestion', 'is', null),
      // Si leggono i campi di CONTENUTO, non solo l'esistenza della riga: un piano vuoto non deve
      // far passare la checklist.
      supabase.from('gtm_plans').select('id, phases').eq('brand_id', brandRow.id).eq('status', 'active'),
      supabase.from('editorial_plans').select('id, weeks, strategy').eq('brand_id', brandRow.id).eq('status', 'active'),
      supabase.from('content_plans').select('id').eq('brand_id', brandRow.id).not('editorial_plan_id', 'is', null).limit(1),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('brand_id', brandRow.id),
      supabase.from('social_post_history').select('id', { count: 'exact', head: true }).eq('brand_id', brandRow.id),
      supabase.from('brand_documents').select('id', { count: 'exact', head: true }).eq('brand_id', brandRow.id),
      supabase.from('social_accounts').select('platform, status').eq('brand_id', brandRow.id),
      supabase.from('brand_strategy').select('report').eq('brand_id', brandRow.id).maybeSingle(),
      supabase.from('posts').select('platform, status, scheduled_for, slot').eq('brand_id', brandRow.id).in('status', ['pending_user', 'approved', 'scheduled']),
      supabase.from('posts').select('id', { count: 'exact', head: true }).eq('brand_id', brandRow.id).eq('status', 'failed'),
      supabase.from('posts').select('id', { count: 'exact', head: true }).eq('brand_id', brandRow.id).eq('needs_attention', true).neq('status', 'published'),
      supabase.from('posts').select('id', { count: 'exact', head: true }).eq('brand_id', brandRow.id).eq('source', 'radar').eq('needs_attention', true).neq('status', 'published'),
      supabase.from('people').select('id', { count: 'exact', head: true }).eq('brand_id', brandRow.id),
      supabase.from('competitors').select('id', { count: 'exact', head: true }).eq('brand_id', brandRow.id),
      supabase.from('gtm_plans').select('id', { count: 'exact', head: true }).eq('brand_id', brandRow.id).eq('status', 'proposed'),
      supabase.from('editorial_plans').select('id', { count: 'exact', head: true }).eq('brand_id', brandRow.id).eq('status', 'proposed'),
      supabase.from('brand_geo_audits').select('id', { count: 'exact', head: true }).eq('brand_id', brandRow.id),
      supabase
        .from('brand_gsc_connections')
        .select('site_url, active')
        .eq('brand_id', brandRow.id)
        .maybeSingle(),
      remaining(supabase, brandRow.id, brandRow.plan, brandRow.timezone, brandRow as any),
      supabase.from('profiles').select('full_name, email, avatar_url').eq('id', userRow.id).maybeSingle(),
      // "GSC fatto" = pronto (sincronizzato + dati), oppure OAuth non configurato su questo ambiente.
      gscConfigured()
        ? Promise.resolve()
            .then(() => loadGscReady(createAdminClient(), brandRow.id))
            .then(({ ready }) => ready as boolean | null)
            .catch((error) => { swallow('then failed', error); return null; })
        : Promise.resolve(true as boolean | null),
      supabase
        .from('brand_kit')
        .select('about, target_audience, brand_style, ai_character, brand_colors, visual_style')
        .eq('brand_id', brandRow.id)
        .maybeSingle()
    ]);

    const connectedPlatforms = [...new Set((connectedAccts ?? []).filter((a) => a.status === 'active').map((a) => String(a.platform ?? '').toLowerCase()).filter(Boolean))];
    // Account che esistono ma non funzionano più: "da ricollegare", non "mai collegato".
    const brokenPlatforms = [...new Set((connectedAccts ?? []).filter((a) => ['expired', 'error', 'disconnected'].includes(String(a.status ?? ''))).map((a) => String(a.platform ?? '').toLowerCase()).filter(Boolean))].filter((p) => !connectedPlatforms.includes(p));
    const hasGeoAudit = (geoAuditCount ?? 0) > 0;
    const gscConnected = gscReady ?? !!(gscConn?.active && gscConn?.site_url);
    const contentPlatforms = [...new Set((generatedPosts ?? []).map((p) => String(p.platform ?? '').toLowerCase()).filter(Boolean))];
    const contentCount = (generatedPosts ?? []).length;
    const calendarConflicts = countCalendarConflicts((generatedPosts ?? []) as { scheduled_for: string | null; status: string; slot: string | null }[], brandRow.timezone);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const planStrategy = ((editPlans ?? [])[0] as any)?.strategy ?? null;
    const editorialPlanPlatforms: string[] | null = Array.isArray(planStrategy?.platform_mix)
      ? planStrategy.platform_mix.map((m: { platform?: string }) => String(m?.platform ?? '')).filter(Boolean)
      : null;
    const radarEnabled = radarPrefsOf(brandRow.content_prefs).enabled === true;
    const socialAccountCount = (connectedAccts ?? []).length;
    // Rispecchia MAX_CONSECUTIVE_FAILURES di scheduler.ts.
    const AUTOPILOT_MAX_FAILURES = 3;
    const autopilotFailureCount = (brandRow as { autopilot_failure_count?: number }).autopilot_failure_count ?? 0;
    const hasProposedPlan = (proposedGtmCount ?? 0) > 0 || (proposedEditCount ?? 0) > 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategyReport = (strategyRow?.report as any) ?? null;
    const strategyPlatforms: string[] | null = Array.isArray(strategyReport?.platformGuidance)
      ? strategyReport.platformGuidance.map((g: { platform?: string }) => String(g?.platform ?? '')).filter(Boolean)
      : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prefs = (brandRow.content_prefs as any) ?? {};
    // Un piano conta solo se esiste E ha contenuto. Le fasi stanno nella colonna jsonb `phases`:
    // si legge quella, non le colonne deprecate phases_90d/phases_6m che solo alcuni percorsi di
    // scrittura hanno mai riempito.
    const hasGtmContent = (gtmPlans ?? []).some((p) => gtmPhasesHaveContent((p as { phases?: unknown }).phases));
    const hasLinkedPlans = (linkedContentPlans ?? []).length > 0;
    const hasEditContent = hasLinkedPlans && (editPlans ?? []).some(
      (p: { weeks?: unknown[] | null }) => Array.isArray(p.weeks) && p.weeks.length > 0
    );
    const strategySetup = {
      gtm: hasGtmContent,
      plan: hasEditContent,
      ops:
        (prefs.platformInstructions && Object.keys(prefs.platformInstructions).length > 0) ||
        (Array.isArray(prefs.avoid) && prefs.avoid.length > 0)
    };

    // Stesso punteggio che usa la pagina Studio, o i due numeri non coinciderebbero.
    const kitFull = { ...(kit ?? {}), ...(kitExtras ?? {}) } as any;
    const character = (kitFull.ai_character ?? {}) as any;
    const hasLogo = ((kitFull.logos ?? []) as any[]).some((l: { url?: string; type?: string }) => l?.url && l?.type !== 'og-image');
    const studioPct = studioCompleteness({
      products: productCount ?? 0,
      history: historyCount ?? 0,
      documents: documentCount ?? 0,
      voice: !!(character.tone || character.speaking_style || kitFull.brand_style),
      about: !!kitFull.about,
      audience: !!kitFull.target_audience,
      logo: hasLogo,
      colors: Array.isArray(kitFull.brand_colors) && (kitFull.brand_colors as unknown[]).length > 0
    }).pct;

    const warnings = computeBrandWarnings({
      base: `/app/${brandRow.slug}`,
      canConnectSocials: canConnectSocials(brandRow.plan, brandRow.status),
      targetPlatforms: Array.isArray(brandRow.target_platforms) ? (brandRow.target_platforms as string[]) : [],
      connectedPlatforms,
      brokenPlatforms,
      autopilotFailureCount,
      autopilotMaxFailures: AUTOPILOT_MAX_FAILURES,
      hasProposedPlan,
      strategyPlatforms,
      editorialPlanPlatforms,
      contentPlatforms,
      contentCount,
      failedPostCount: failedPostCount ?? 0,
      attentionPostCount: attentionPostCount ?? 0,
      postsRemaining: budget.posts,
      postsQuota: budget.postsQuota,
      hasStrategy: strategySetup.gtm,
      hasEditorialPlan: strategySetup.plan,
      onboardingCompleted: !!(brandRow as { onboarding_completed_at?: string | null }).onboarding_completed_at,
      pendingCount: pendingCount ?? 0,
      hasLogo,
      hasVisualStyle: !!(kitFull?.visual_style as string | null | undefined)?.trim(),
      hasHashtags: !!prefs.platformHashtags && Object.keys(prefs.platformHashtags).length > 0,
      peopleCount: peopleCount ?? 0,
      competitorCount: competitorCount ?? 0,
      calendarConflicts,
      blogEnabled: (brandRow.blog_config as { enabled?: boolean } | null)?.enabled === true,
      hasGeoAudit
    });

    // Le notifiche scritte dagli AGENTI entrano nella stessa campanella. `incidents` è
    // service-role, quindi admin: la membership l'ha già verificata canEnter qui sopra.
    try {
      const notices = await listAgentNotices(createAdminClient(), brandRow.id);
      for (const n of notices) warnings.unshift(agentNoticeToWarning(n, `/app/${brandRow.slug}`));
    } catch (error) { swallow('list agent notices', error); }

    const email = profile?.email ?? userRow.email ?? null;
    const userName =
      profile?.full_name?.trim() || (email ? email.split('@')[0] : null) || 'User';
    const meta = (userRow.user_metadata ?? {}) as Record<string, unknown>;
    const rawAvatar = meta.avatar_url ?? meta.picture ?? meta.avatar;
    const oauthAvatar =
      typeof rawAvatar === 'string' && /^https?:\/\//.test(rawAvatar) ? rawAvatar : null;
    const profileAvatar =
      typeof profile?.avatar_url === 'string' && profile.avatar_url ? profile.avatar_url : null;
    const userAvatarUrl = profileAvatar || oauthAvatar;

    const activePlan = (editPlans ?? [])[0] ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editorialPlanWeeks = activePlan ? (Array.isArray((activePlan as any).weeks) ? (activePlan as any).weeks.map((w: { theme?: string }, i: number) => ({ index: i, theme: w.theme ?? undefined })) : []) : [];

    return {
      pendingCount: pendingCount ?? 0,
      leadsPendingCount: leadsPendingCount ?? 0,
      radarReviewCount: radarReviewCount ?? 0,
      socialAccountCount: socialAccountCount ?? 0,
      postsRemaining: budget.posts,
      postsQuota: budget.postsQuota,
      credits: {
        used: budget.credits.used,
        quota: budget.credits.quota,
        remaining: budget.credits.remaining,
        percent: budget.credits.percent,
        periodEnd: budget.credits.periodEnd.toISOString()
      },
      userName,
      userEmail: email,
      userAvatarUrl,
      // La presence si indicizza su questo: due schede della stessa persona sono un compagno solo.
      userId: userRow.id,
      strategySetup,
      studioPct,
      editorialPlanWeeks,
      warnings,
      radarEnabled,
      hasGeoAudit,
      gscConnected
    };
  }

  return {
    brand,
    brandId: brand.id,
    // Il menu dei modelli della chat: elenco vivo del gateway, non una lista scritta a mano che
    // invecchia. È in cache di processo, quindi non è una chiamata di rete per navigazione.
    chatModels: await chatModelChoices().catch(() => []),
    logoUrl,
    switcherBrands,
    onboarding,
    setupNeeded,
    setupStep: (brand.setup_step as number) ?? 0,
    flags: {
      ...FLAGS,
      // Dogfood: nav e rotte Ads anche con FEATURE_ADS spento globalmente.
      ads: FLAGS.ads || isAdsPreviewUser(user?.email)
    },
    // Non atteso di proposito: SvelteKit lo manda in streaming dietro i campi bloccanti sopra.
    deferred: (() => {
      // L'argomento di tipo conta: senza, getBrandDeferred torna `unknown`, il check di
      // verità lo restringe a `{}` e l'unione col tipo vero collassa a `Promise<{}>`.
      const cached = getBrandDeferred<Awaited<ReturnType<typeof loadDeferred>>>(userId, params.brand);
      if (cached) return Promise.resolve(cached);
      return loadDeferred().then((extras) => {
        setBrandDeferred(userId, params.brand, extras);
        return extras;
      });
    })()
  };
};
