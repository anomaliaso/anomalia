import { isPaidPlan, PLAN_WEEKS, RADAR_SOURCE_LIMITS } from '$lib/plans';
import { isPlanGoEnabled } from '$lib/server/feature-flags';

// Free / absent plan matches Go quotas for blog + radar (capabilities parity, not credits).

// Connected-account caps per plan (the Zernio cost lever). All plans get every
// platform; the limit is on how many accounts a brand can connect.
// Go = 0: prepare & export only — no Zernio billing (~$7/account).
export const ACCOUNT_LIMITS: Record<string, number> = {
  go: 0,
  starter: 2,
  pro: 8,
  // Legacy grandfathered tier — keep existing caps generous so scale brands aren't locked out.
  scale: 8
};

export function accountLimit(plan: string | null | undefined): number {
  // Free / trial brands cannot connect Zernio accounts at all.
  if (!isPaidPlan(plan)) return 0;
  return ACCOUNT_LIMITS[plan ?? ''] ?? 0;
}

/**
 * Un piano PAGATO che per progetto non collega account: oggi solo Go, venduto come
 * "You publish. We prepare." — 15 post al mese, "posts ready to export — you publish".
 *
 * Serve a distinguere due situazioni che `accountLimit === 0` confonde, e che vogliono risposte
 * opposte dai gate dell'autopilot:
 *   • starter/pro/scale con zero account → paga per pubblicare e non ha dove: si ferma la
 *     produzione e gli si dice di collegare un account;
 *   • **go** con zero account → è lo stato normale del suo piano, e fermarsi qui significa non
 *     consegnargli mai i post che ha comprato.
 * Il free/trial resta fuori di proposito (`isPaidPlan` false): lì non c'è una promessa pagata da
 * mantenere e la produzione a vuoto è solo costo.
 *
 * Derivato da ACCOUNT_LIMITS invece che dall'elenco dei piani: un tier futuro venduto come
 * "prepara ed esporta" eredita il comportamento giusto senza che nessuno se ne ricordi.
 */
export function isExportOnlyPlan(plan: string | null | undefined): boolean {
  return isPaidPlan(plan) && accountLimit(plan) === 0;
}

// Measured unit costs, from ai_calls over 45 days — NOT estimates. Re-measure before moving any
// quota below; every number here is what the providers actually charged.
//   static image  $0.184  renderImage 0.1446 + critiqueImage 0.0144 + batch overhead 0.025
//   video (13s)   $0.41   cover + clip + captions + overhead (measured mix; UGC covers now use
//                         Nano Banana Pro — re-measure after a few live batches if cover spend rises)
//   text / link   $0.04   copy + batch overhead only
//   carousel x5   $0.82   five renders + QC — the priciest format we make, double a video
//
// UGC covers use Nano Banana Pro (same as stills). The MASTER UGC look — pores, candid light,
// imperfect presence — is enforced in the prompt, not by downgrading the model.
export const UNIT_COST_USD = { video: 0.41, image: 0.184, text: 0.04, carousel5: 0.82 } as const;

// The editorial mix we are steering every plan toward: video-first, carousels dropped, and the
// remainder split between stills and near-free text/link posts. The share is what makes the
// budget work — text/link posts cost a tenth of a still, so they pay for the clips.
export const VIDEO_SHARE = 0.4;
const MIX_COST_USD = VIDEO_SHARE * UNIT_COST_USD.video + 0.3 * UNIT_COST_USD.image + 0.3 * UNIT_COST_USD.text; // $0.227

// Monthly post quota per plan — a HARD cap (no usage billing, no add-ons). Hitting it
// means "upgrade for more". More connected accounts never raises this; only the plan does.
//
// Sized so the video-first mix fits the SAME credit envelope as before: post production is ~33% of
// a plan's credits in practice (measured across 34 active brands). Credits grow with plan price;
// quotas stay gated by mixCostUsd ≤ 33% of creditQuota (see plans.test.ts).
//
// This deliberately trades COUNT for FORMAT: Starter goes video-first instead of stills-heavy,
// Pro likewise — at equal or lower spend relative to the credit envelope.
export const POST_QUOTAS: Record<string, number> = {
  // Clean marketing ladder: Starter = 2× Go, Pro = 3× Starter.
  go: 15,
  starter: 30,
  pro: 90
};

export function postQuota(plan: string | null | undefined): number {
  return POST_QUOTAS[plan ?? ''] ?? POST_QUOTAS.go;
}

// Internal-only video guardrail, DERIVED from the quota rather than hardcoded a second time — a
// separate table drifts the moment someone edits one of them. Never surfaced to the user: the AI
// planner just falls back to image/text once the cap is reached.
//
// The old caps (2 and 8) were set against a claimed "~25x an image, ~$2.5/clip". A 15s clip on
// grok 1.5 at 720p actually costs $0.338 — about 2x a still, not 25x — so the guardrail was
// defending a price that no longer exists and capping video at 3% of a brand's output.
export function videoCap(plan: string | null | undefined): number {
  return Math.round(postQuota(plan) * VIDEO_SHARE);
}

/** What one month of the target mix costs a plan, in USD. Exported for the budget test. */
export function mixCostUsd(plan: string | null | undefined): number {
  return postQuota(plan) * MIX_COST_USD;
}

// Map a brand's cadence ('3/week' | '5/week' | 'daily') to how many posts one generation run
// produces. Shared by the recurring scheduler and the manual generate endpoint so both paths
// size a batch the same way. Unknown/absent → a full week.
export function countForFrequency(frequency?: string | null): number {
  if (frequency === '3/week') return 3;
  if (frequency === '5/week') return 5;
  if (frequency === 'daily') return 7;
  return 7;
}

// Default blog cadence (articles/week) when blog_config.articlesPerWeek is unset — an explicit
// value set by the user always wins (clamped by blogArticlesPerWeekMax).
// Go ~3/week, Starter daily, Pro 3× Starter (~21/week).
export const BLOG_ARTICLES_PER_WEEK: Record<string, number> = {
  go: 3,
  starter: 7,
  pro: 21
};

export function blogArticlesPerWeek(plan: string | null | undefined): number {
  return BLOG_ARTICLES_PER_WEEK[plan ?? ''] ?? BLOG_ARTICLES_PER_WEEK.go;
}

/** Max articles/week the user may set in blog settings — derived from the monthly ceiling. */
export function blogArticlesPerWeekMax(plan: string | null | undefined): number {
  return Math.max(1, Math.ceil(blogArticlesPerMonth(plan) / 4));
}

// HARD ceiling on AI-generated articles per calendar month. Distinct from BLOG_ARTICLES_PER_WEEK,
// which is the *cadence* (how the month is spread): the cadence can be raised by the user in blog
// settings up to blogArticlesPerWeekMax, this cannot. It bounds the batch entry points (month plan
// + autopilot drip); generating ONE article from a typed topic stays available past the cap.
//
// Ladder: Go 15 / Starter 30 (2× Go) / Pro 90 (3× Starter).
export const BLOG_ARTICLES_PER_MONTH: Record<string, number> = {
  go: 15,
  starter: 30,
  pro: 90,
  scale: 90
};

export function blogArticlesPerMonth(plan: string | null | undefined): number {
  return BLOG_ARTICLES_PER_MONTH[plan ?? ''] ?? BLOG_ARTICLES_PER_MONTH.go;
}

// Extra languages each article may be translated into, on the top tier only. The cap above counts
// ORIGINALS, so a Pro brand at the ceiling ships 90 originals + 270 translations.
export const BLOG_TRANSLATION_LANGUAGES: Record<string, number> = {
  go: 0,
  starter: 0,
  pro: 3,
  scale: 3
};

export function blogTranslationLanguages(plan: string | null | undefined): number {
  return BLOG_TRANSLATION_LANGUAGES[plan ?? ''] ?? 0;
}

// Founder-made video commissions per month — HUMAN-produced clips the Anomalia team crafts and
// delivers in-app (the AI can't make these from scratch). A user-facing, plan-gated quota,
// distinct from videoCap() (the internal AI-clip guardrail).
export const FOUNDER_VIDEO_QUOTAS: Record<string, number> = {
  go: 0,
  starter: 0,
  pro: 2
};

export function founderVideoQuota(plan: string | null | undefined): number {
  return FOUNDER_VIDEO_QUOTAS[plan ?? ''] ?? FOUNDER_VIDEO_QUOTAS.starter;
}

// Radar source caps live in `$lib/plans` (Plan.radarSources + radarSourceLimit) so pricing
// cards and the Settings UI share one source of truth with the server gate.
export {
  isPaidPlan,
  canConnectSocials,
  hasSocialPublishing,
  hasBlogIntegrations,
  hasBlogCustomDomain,
  hasFullChatContext,
  CHAT_CONTEXT_CAP_TOKENS,
  hasWebHub,
  hasLeadFinding,
  hasProRadarLeads,
  leadEngagePlatforms,
  RADAR_PLATFORM_KEYS,
  hasAds,
  hasBacklinkNetwork,
  radarAllowedKinds,
  isRadarKindAllowed,
  RADAR_SOURCE_LIMITS,
  radarSourceLimit
} from '$lib/plans';
export type { RadarPlatformKey } from '$lib/plans';

// Plan ladder (cheapest → top), with display labels — used by the settings Upgrade flow.
// Go sits at the bottom; FEATURE_PLAN_GO only gates *selling* it, not upgrades from it.
export const PLAN_ORDER = ['go', 'starter', 'pro'] as const;
export type PlanTier = (typeof PLAN_ORDER)[number];
export const PLAN_LABELS: Record<string, string> = { go: 'Go', starter: 'Starter', pro: 'Pro' };

export type UpgradeOption = {
  key: string;
  label: string;
  posts: number;
  accounts: number;
  radarSources: number;
};

// The plans strictly ABOVE the current one (what the user can upgrade to). Unknown/absent plan
// is treated as below go, so every tier is offered — except Go itself, which is only offered
// while FEATURE_PLAN_GO is on.
export function plansAbove(plan: string | null | undefined): UpgradeOption[] {
  const idx = PLAN_ORDER.indexOf((plan ?? '') as PlanTier);
  return PLAN_ORDER.slice(idx + 1)
    .filter((k) => k !== 'go' || isPlanGoEnabled())
    .map((k) => ({
      key: k,
      label: PLAN_LABELS[k],
      posts: POST_QUOTAS[k],
      accounts: ACCOUNT_LIMITS[k],
      radarSources: RADAR_SOURCE_LIMITS[k]
    }));
}

// True only when the brand is already on the highest tier (offer a custom plan instead).
export function isTopPlan(plan: string | null | undefined): boolean {
  return PLAN_ORDER.indexOf((plan ?? '') as PlanTier) === PLAN_ORDER.length - 1;
}

/**
 * Quante settimane del ciclo editoriale copre UN batch di pianificazione.
 *
 * Ne copriva una, e una settimana è poco per due ragioni diverse: l'utente deve approvare quattro
 * volte al mese, e una serie non può costruire un arco fra un episodio e il successivo se chi
 * pianifica vede solo sette giorni. Due è il default per tutti. Quattro — il ciclo intero in un
 * colpo — è per il piano pro: non è un limite tecnico, è la cosa che si vende.
 *
 * Il ciclo non si supera mai: oltre `PLAN_WEEKS` non ci sono settimane da pianificare.
 */
export const BATCH_WEEKS_DEFAULT = 2;
const BATCH_WEEKS_MAX_BY_PLAN: Record<string, number> = { pro: 4 };

export function batchWeeks(plan: string | null | undefined, wanted?: number): number {
  const max = BATCH_WEEKS_MAX_BY_PLAN[plan ?? ''] ?? BATCH_WEEKS_DEFAULT;
  const asked = Number(wanted);
  if (!Number.isFinite(asked) || asked < 1) return BATCH_WEEKS_DEFAULT;
  return Math.min(Math.floor(asked), max, PLAN_WEEKS);
}
