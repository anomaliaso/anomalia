// Per-brand pricing tiers — the single source of truth for plan display + selection.
// Shared by the public /pricing page, onboarding and the activate paywall. The Stripe
// price ids that back these live server-side in $lib/server/stripe (PRICES); this module
// is display data only, so it's safe to import in the browser.

import { PLATFORM_IDS } from './platforms';

export type PlanKey = 'go' | 'starter' | 'pro';
export type Cycle = 'month' | 'year';
// Valuta di fatturazione. EUR di default; USD è la valuta parallela esplicita per chi sta fuori
// dall'eurozona, con prezzi Stripe in USD dedicati invece dell'Adaptive Pricing su un importo EUR.
export type Currency = 'eur' | 'usd';

// Features shown on a plan card, grouped under short category headers for scannability.
// Plain strings = included (check). `{ text, missing: true }` = not on this tier (minus).
export type FeatItem = string | { text: string; missing: true };
export type FeatGroup = { label: string; items: FeatItem[] };

export function featText(f: FeatItem): string {
  return typeof f === 'string' ? f : f.text;
}
export function featMissing(f: FeatItem): boolean {
  return typeof f === 'object' && f.missing === true;
}

// Stima marketing per "fino a ~N video HD" sulla card: 100 crediti = $1 di budget AI, e una clip
// HD a $0,38 costa 38 crediti. L'output reale varia con durata, risoluzione e altra spesa AI.
export const VIDEO_COST_USD_HD = 0.38;
/** Credits consumed by one typical HD clip (= $0.38 × 100). */
export const VIDEO_COST_CREDITS = VIDEO_COST_USD_HD * 100; // 38

/** Floor(plan credits ÷ cost-per-HD-video in credits). Uses the plan's real credit quota. */
export function videosFromCredits(credits: number): number {
  if (credits <= 0) return 0;
  return Math.floor(credits / VIDEO_COST_CREDITS);
}

/** Free-tier monthly credit grant (no Stripe plan). */
export const FREE_CREDITS = 400;

/*
 * NON reintrodurre `apiValueEur/Usd` (il "valore API" accanto ai crediti sul pricing): quei numeri
 * valevano quando Flash e Nano Banana Pro erano scontati. Dal 2026-08 ogni modello è fatturato al
 * 100% del listino, quindi 100 crediti valgono ESATTAMENTE $1 e i 2100 crediti del Go valgono $21,
 * non €50 — un dato vero che argomenta contro di noi sulla nostra stessa pagina prezzi. Nemmeno un
 * cambio di provider lo salva: solo il 54,8% della spesa passa da quei due modelli (misurato su
 * ai_calls, 30 giorni), quindi il tetto sarebbe $2,21 per 100 crediti.
 */

export type Plan = {
  key: PlanKey;
  name: string;
  m: number; // €/mo billed monthly
  a: number; // effective €/mo when billed annually (12× upfront)
  mUsd: number; // $/mo billed monthly
  aUsd: number; // effective $/mo when billed annually
  credits: number; // AI credits included per month (metering: 100 credits = $1 cost_usd)
  /**
   * English fallback tagline. UI copy is localized via `pricing.plans.{key}.tagline`
   * (PlanCards, chat upgrade) — keep in sync with `en.json`.
   */
  tagline: string;
  popular: boolean;
  /**
   * English fallback bullets (keep ≤6). UI copy is localized via
   * `pricing.plans.{key}.highlights` (pipe-separated) — keep in sync with `en.json`.
   */
  highlights: string[];
  /**
   * Longer grouped feature catalog (English). Not rendered on pricing cards today;
   * prefer i18n if/when surfaced in UI.
   */
  feats: FeatGroup[];
  /** Social channels offered — keys of PLATFORM_META. */
  platforms: string[];
  /**
   * How many of `platforms` the tier includes. DISPLAY ONLY — connect caps live in
   * `$lib/server/plans` ACCOUNT_LIMITS. Go is 0 (prepare & export, no Zernio).
   */
  socialsIncluded: number;
  /** AI assistants / search engines the brand is measured in — keys of AI_SURFACE_META. */
  aiSurfaces: string[];
  /**
   * Lead-finding surfaces. Keys of PLATFORM_META or AI_SURFACE_META (`google` / `bing`).
   * Go + Starter = Reddit + Google + Bing; Pro adds X/Threads/LinkedIn.
   */
  leadSources: string[];
  /** Rough daily lead volume for marketing copy (display only — niche-dependent). */
  leadsPerDay: { min: number; max: number };
  /** Monthly social-post quota (display) — must match `POST_QUOTAS` in `$lib/server/plans`. */
  postsPerMonth: number;
  /** Monthly blog-article hard ceiling — must match `BLOG_ARTICLES_PER_MONTH`. */
  articlesPerMonth: number;
  /** Default blog cadence (articles/week) for pricing — must match `BLOG_ARTICLES_PER_WEEK`. */
  articlesPerWeek: number;
  /**
   * Suggested comments + DMs per day (display only). A bit above leadsPerDay because some
   * leads get both a comment and a DM.
   */
  repliesPerDay: number;
  /**
   * Max custom Radar sources (`brand_news_sources` rows) this tier may keep.
   * Enforced server-side by `radarSourceLimit` — same numbers.
   */
  radarSources: number;
};

export const PLANS: Plan[] = [
  {
    key: 'go',
    name: 'Go',
    m: 25,
    a: 21,
    mUsd: 29,
    aUsd: 24,
    credits: 2100,
    tagline: 'You publish. We prepare.',
    popular: false,
    highlights: [
      'Strategy & editorial plan for your brand',
      'Posts ready to export — you publish',
      'SEO, GEO & blog hosting',
      'Leads on Reddit, Google & Bing',
      'Email support'
    ],
    platforms: ['instagram', 'tiktok', 'linkedin', 'x', 'facebook', 'threads', 'youtube', 'bluesky', 'reddit'],
    socialsIncluded: 0,
    aiSurfaces: ['chatgpt', 'claude', 'gemini', 'perplexity', 'copilot', 'grok', 'deepseek', 'google', 'bing'],
    leadSources: ['reddit', 'google', 'bing'],
    leadsPerDay: { min: 5, max: 10 },
    postsPerMonth: 15,
    articlesPerMonth: 15,
    articlesPerWeek: 3,
    repliesPerDay: 10,
    radarSources: 5,
    feats: [
      {
        label: 'Strategy & voice',
        items: [
          'A growth strategy & editorial plan, built for your brand',
          'Learns your voice, your offer and your brand',
          'AI chat with 256k tokens of context per conversation',
          { text: "Chat on the model's full context window (up to 1M tokens)", missing: true }
        ]
      },
      {
        label: 'Content',
        items: [
          'Plans posts for your socials — you copy & publish',
          'Caption + image + video export, ready to post in one tap',
          'Approve or tweak from your phone in seconds',
          { text: 'Auto-publish to connected social accounts', missing: true }
        ]
      },
      {
        label: 'SEO & blog',
        items: [
          'Grows website traffic with SEO & GEO analysis',
          'Blog hosting on Anomalia',
          'Custom domain for your blog',
          { text: 'CMS integrations (Webflow, Shopify, …)', missing: true },
          { text: 'Backlink network across Anomalia brands', missing: true }
        ]
      },
      {
        label: 'Leads & engagement',
        items: [
          'Finds leads on Reddit, Google & Bing (~5–10/day)',
          'Drafts comments & DMs — you review and send',
          'Up to 5 custom Radar sources'
        ]
      },
      {
        label: 'Ads',
        items: [
          { text: 'Meta Ads & Google Ads', missing: true }
        ]
      },
      {
        label: 'Platforms & support',
        items: [
          { text: 'Connected social accounts', missing: true },
          'Export-ready for Instagram, TikTok, LinkedIn, X & more',
          'Email support'
        ]
      }
    ]
  },
  {
    key: 'starter',
    name: 'Starter',
    m: 79,
    a: 66,
    mUsd: 89,
    aUsd: 74,
    credits: 5500,
    tagline: 'For one brand getting consistent.',
    popular: true,
    highlights: [
      'Autopublish to 2 social accounts',
      'Editorial plan on autopilot',
      'Blog articles built to rank',
      'Backlink network across Anomalia brands',
      'Meta & Google Ads — you approve spend',
      'Radar & leads (~10–20/day)'
    ],
    platforms: ['instagram', 'tiktok', 'linkedin', 'x', 'facebook', 'threads', 'youtube', 'bluesky', 'reddit'],
    socialsIncluded: 2,
    aiSurfaces: ['chatgpt', 'claude', 'gemini', 'perplexity', 'copilot', 'grok', 'deepseek', 'google', 'bing'],
    leadSources: ['reddit', 'google', 'bing'],
    leadsPerDay: { min: 10, max: 20 },
    postsPerMonth: 30,
    articlesPerMonth: 30,
    articlesPerWeek: 7,
    repliesPerDay: 20,
    radarSources: 10,
    feats: [
      {
        label: 'Strategy & voice',
        items: [
          'A growth strategy & editorial plan, built for your brand',
          'Learns your voice, your offer and your brand',
          "AI chat on the model's full context window (up to 1M tokens) — ~4x longer conversations before they compact"
        ]
      },
      {
        label: 'Content & posting',
        items: [
          'Plans and posts to your socials on autopilot',
          'Posts at peak times, optimized for each platform',
          'Approve or tweak from your phone in seconds',
          'Turns real-time news into fresh posts & articles'
        ]
      },
      {
        label: 'SEO & blog',
        items: [
          'Grows website traffic with SEO & GEO analysis',
          'Publishes blog articles built to rank on Google',
          'Backlink network across Anomalia brands'
        ]
      },
      {
        label: 'Leads & engagement',
        items: [
          'Finds leads on Reddit, Google & Bing (~10–20/day)',
          'Drafts comments & DMs — you review and send',
          'Up to 10 custom Radar sources'
        ]
      },
      {
        label: 'Ads',
        items: [
          'Boost winning posts on Meta Ads (Facebook & Instagram)',
          'Create Google Ads & Meta campaigns — you approve every euro of spend'
        ]
      },
      {
        label: 'Platforms & support',
        items: [
          '2 social channels of your choice — Instagram, TikTok, LinkedIn, X, Reddit & more',
          '2 connected social accounts',
          'Email support'
        ]
      }
    ]
  },
  {
    key: 'pro',
    name: 'Pro',
    m: 199,
    a: 166,
    mUsd: 225,
    aUsd: 188,
    credits: 12000,
    tagline: 'The full autonomous manager.',
    popular: false,
    highlights: [
      'Autopublish to 8 social accounts',
      'Higher capacity across posts, blog & leads',
      'Backlink network across Anomalia brands',
      'Up to 4K images / videos',
      'Leads on X, Threads & LinkedIn too (~30–60/day)',
      'Priority human support'
    ],
    platforms: ['instagram', 'tiktok', 'linkedin', 'x', 'facebook', 'threads', 'youtube', 'bluesky', 'reddit'],
    socialsIncluded: 8,
    aiSurfaces: ['chatgpt', 'claude', 'gemini', 'perplexity', 'copilot', 'grok', 'deepseek', 'google', 'bing'],
    leadSources: ['reddit', 'google', 'bing', 'x', 'threads', 'linkedin'],
    leadsPerDay: { min: 30, max: 60 },
    postsPerMonth: 90,
    articlesPerMonth: 90,
    articlesPerWeek: 21,
    repliesPerDay: 60,
    radarSources: 30,
    feats: [
      {
        label: 'Strategy & voice',
        items: [
          'A growth strategy & editorial plan, built for your brand',
          'Learns your voice, your offer and your brand',
          "AI chat on the model's full context window (up to 1M tokens) — ~4x longer conversations before they compact"
        ]
      },
      {
        label: 'Content & posting',
        items: [
          'Plans and posts to your socials on autopilot',
          'Posts at peak times, optimized for each platform',
          'Approve or tweak from your phone in seconds',
          'Turns real-time news into fresh posts & articles'
        ]
      },
      {
        label: 'SEO & blog',
        items: [
          'Grows website traffic with SEO & GEO analysis',
          'Publishes blog articles built to rank on Google',
          'Backlink network across Anomalia brands'
        ]
      },
      {
        label: 'Leads & engagement',
        items: [
          'Finds leads on Reddit, Google, Bing, X, Threads & LinkedIn (~30–60/day)',
          'Drafts comments & DMs — you review and send',
          'Up to 30 custom Radar sources'
        ]
      },
      {
        label: 'Ads',
        items: [
          'Boost winning posts on Meta Ads (Facebook & Instagram)',
          'Create Google Ads & Meta campaigns — you approve every euro of spend'
        ]
      },
      {
        label: 'Platforms & support',
        items: [
          '8 platforms — Instagram, TikTok, LinkedIn, X, Reddit & more',
          '8 connected social accounts',
          'Up to 4K images / videos',
          'Real human support, not a chatbot',
          'Priority support'
        ]
      }
    ]
  }
];

export function isPlanKey(x: string | null | undefined): x is PlanKey {
  return x === 'go' || x === 'starter' || x === 'pro';
}

/** Plans shown on pricing / activate. Go is gated by the Vercel `FEATURE_PLAN_GO` flag. */
export function visiblePlans(includeGo: boolean): Plan[] {
  return includeGo ? PLANS : PLANS.filter((p) => p.key !== 'go');
}

// Default to annual — the better-value cycle and what the paywall pre-selects.
export function normalizeCycle(x: string | null | undefined): Cycle {
  return x === 'month' ? 'month' : 'year';
}

// Pro is the default highlight when no (valid) plan is named.
export function planByKey(key: string | null | undefined): Plan {
  return PLANS.find((p) => p.key === key) ?? PLANS.find((p) => p.key === 'pro')!;
}
// I prezzi sopra sono in EUR. Con Stripe Adaptive Pricing, chi è FUORI dall'eurozona vede e paga
// nella propria valuta al checkout: questo flag (paese dall'edge Vercel) permette alla UI di dirlo.
// Paese sconosciuto (dev / header assente) → false.
const EUROZONE = new Set([
  'AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES'
]);

export function showsLocalCurrency(country: string | null | undefined): boolean {
  return !!country && !EUROZONE.has(country);
}

// Which billing currency a visitor gets. Non-eurozone → USD (dedicated parallel USD Stripe
// prices); eurozone + unknown (dev/no header) → EUR.
export function currencyForCountry(country: string | null | undefined): Currency {
  return showsLocalCurrency(country) ? 'usd' : 'eur';
}

export const CURRENCY_SYMBOL: Record<Currency, string> = { eur: '€', usd: '$' };

// Pick the monthly/annual display amount for a plan in the given currency.
export function monthlyPrice(plan: Plan, currency: Currency): number {
  return currency === 'usd' ? plan.mUsd : plan.m;
}
export function annualPrice(plan: Plan, currency: Currency): number {
  return currency === 'usd' ? plan.aUsd : plan.a;
}

// A brand is "paid" once it's on a real subscription tier; empty/absent plan = free trial.
// Shared by server gates and client UI (e.g. Connect → /activate for free brands).
// `scale` is a legacy/grandfathered paid tier (still active for a few brands).
// `go` is paid but has no Zernio / autopublish (prepare & export only).
export const PAID_PLAN_IDS = ['go', 'starter', 'pro', 'scale'] as const;

export function isPaidPlan(plan: string | null | undefined): boolean {
  return (PAID_PLAN_IDS as readonly string[]).includes(String(plan));
}

/**
 * Chat context ceiling for the tiers that don't get the model's full window (free + Go).
 * 256k tokens ≈ a very long working session; past it the thread auto-compacts as usual.
 */
export const CHAT_CONTEXT_CAP_TOKENS = 256_000;

/**
 * Finestra piena del modello in chat — Starter/Pro/scale. Free e Go restano a
 * CHAT_CONTEXT_CAP_TOKENS. La compattazione avviene su ogni piano: questo sposta la soglia, non
 * butta cronologia che l'utente può scorrere.
 */
export function hasFullChatContext(plan: string | null | undefined): boolean {
  return plan === 'starter' || plan === 'pro' || plan === 'scale';
}

/** Autopublish + Zernio social connects — Starter/Pro/scale only. Go is export-only. */
export function hasSocialPublishing(plan: string | null | undefined): boolean {
  return plan === 'starter' || plan === 'pro' || plan === 'scale';
}

/** CMS blog sync (Webflow / Shopify / Wix) — not on Go/free (hosting only). */
export function hasBlogIntegrations(plan: string | null | undefined): boolean {
  return plan === 'starter' || plan === 'pro' || plan === 'scale';
}

/** Custom blog domain (e.g. blog.brand.com) — any paid plan; not free. */
export function hasBlogCustomDomain(plan: string | null | undefined): boolean {
  return isPaidPlan(plan);
}

/**
 * Web hub (SEO, GEO, keywords, blog hosting, library) + Radar.
 * Free matches Go — unlocked for every brand. Autopublish / social connects / CMS sync /
 * custom domain stay on paid tiers via hasSocialPublishing / hasBlogIntegrations /
 * hasBlogCustomDomain.
 */
export function hasWebHub(_plan?: string | null): boolean {
  return true;
}

/** Lead finding (Radar social hunt + comment/DM drafts). Free matches Go. */
export function hasLeadFinding(_plan?: string | null): boolean {
  return true;
}

// Free / trial / canceled / paused brands must not connect (or keep) Zernio socials.
// Go is paid but deliberately has zero connected accounts (no Zernio spend).
export function canConnectSocials(
  plan: string | null | undefined,
  status: string | null | undefined
): boolean {
  return status === 'active' && hasSocialPublishing(plan);
}

// Radar / Leads source kinds. Free + Go + Starter: news + Reddit only. Pro (+ legacy scale): also
// Threads, X Communities, and LinkedIn (dynamic search + configurable sources).
export const RADAR_BASE_KINDS = ['gnews_query', 'rss', 'subreddit', 'reddit_query'] as const;
export const RADAR_PRO_LEAD_KINDS = ['threads_query', 'x_community', 'linkedin_query'] as const;
export type RadarSourceKind =
  | (typeof RADAR_BASE_KINDS)[number]
  | (typeof RADAR_PRO_LEAD_KINDS)[number];

/** True when the plan may hunt leads on X / Threads / LinkedIn (not just Reddit + Google News). */
export function hasProRadarLeads(plan: string | null | undefined): boolean {
  return plan === 'pro' || plan === 'scale';
}

/** 4K Motion video MP4 encode — Pro (and legacy scale) only. */
export function hasMotionVideo4k(plan: string | null | undefined): boolean {
  return plan === 'pro' || plan === 'scale';
}

/** Platforms the brand can toggle for Radar discovery (Settings → Radar). */
export const RADAR_PLATFORM_KEYS = [
  PLATFORM_IDS.gnews,
  PLATFORM_IDS.reddit,
  PLATFORM_IDS.threads,
  PLATFORM_IDS.x,
  PLATFORM_IDS.linkedin
] as const;

export type RadarPlatformKey = (typeof RADAR_PLATFORM_KEYS)[number];

/**
 * Conversation platforms where Radar may draft comment/DM leads.
 * Plan entitlement only — no Zernio/social connect required (Anomalia drafts; the human pastes).
 * Free + Go + Starter: Reddit. Pro (+ legacy scale): Reddit + Threads + X + LinkedIn.
 */
export function leadEngagePlatforms(plan: string | null | undefined): readonly string[] {
  if (!hasLeadFinding(plan)) return [];
  return hasProRadarLeads(plan) ? ['reddit', 'threads', 'x', 'linkedin'] : ['reddit'];
}

/** True when the plan may create/boost ads via Zernio (Starter and up; legacy Scale included). */
export function hasAds(plan: string | null | undefined): boolean {
  return plan === 'starter' || plan === 'pro' || plan === 'scale';
}

/**
 * Cross-brand Anomalia backlink network (+ external boost later).
 * Starter and up — not Free / Go (legacy Scale included).
 */
export function hasBacklinkNetwork(plan: string | null | undefined): boolean {
  return plan === 'starter' || plan === 'pro' || plan === 'scale';
}

export function radarAllowedKinds(plan: string | null | undefined): readonly RadarSourceKind[] {
  return hasProRadarLeads(plan)
    ? [...RADAR_BASE_KINDS, ...RADAR_PRO_LEAD_KINDS]
    : [...RADAR_BASE_KINDS];
}

export function isRadarKindAllowed(kind: string, plan: string | null | undefined): boolean {
  return (radarAllowedKinds(plan) as readonly string[]).includes(kind);
}

// Custom Radar sources (`brand_news_sources` rows) a brand may keep. Seeded onboarding inserts
// up to ~10 (5 Google News + 3 subreddits + 2 Reddit queries), so Starter must clear that floor.
// Derived from Plan.radarSources so pricing cards and the server gate cannot drift.
export const RADAR_SOURCE_LIMITS: Record<string, number> = {
  ...Object.fromEntries(PLANS.map((p) => [p.key, p.radarSources])),
  // Legacy alias — same ceiling as Pro.
  scale: 30
};

export function radarSourceLimit(plan: string | null | undefined): number {
  // Free / unknown → Go ceiling (free matches Go).
  return RADAR_SOURCE_LIMITS[plan ?? ''] ?? RADAR_SOURCE_LIMITS.go;
}
