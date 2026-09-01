import { env } from '$env/dynamic/private';

// Env-driven flags set on Vercel. `$env/dynamic/private` reads them at request time,
// so toggling the var on Vercel takes effect without a rebuild.
//
//   GEMINI_FLASH=gemini-3.7-flash  → Flash text/vision model (see gemini.ts)
//   FEATURE_PLAN_GO=true           → show & sell the Go tier on /pricing and /activate
//   FEATURE_PLAN_GO unset          → Go is hidden; existing Go subscribers keep working
//

/** Public launch gate for the Go plan (€29 prepare-and-export tier). */
export function isPlanGoEnabled(): boolean {
  return env.FEATURE_PLAN_GO === 'true';
}

/**
 * Soft→hard GSC gate on SEO plan generation when OAuth is configured.
 * Default ON; set FEATURE_GSC_GATE=false to disable.
 */
export function isGscGateEnabled(): boolean {
  return env.FEATURE_GSC_GATE !== 'false';
}

/**
 * Inject GSC into the default SEO agent + keyword strategy. Default ON.
 * Set FEATURE_GSC_IN_AGENT=false to disable the tool/prompt wiring.
 */
export function isGscInAgentEnabled(): boolean {
  return env.FEATURE_GSC_IN_AGENT !== 'false';
}

/**
 * GEO apply publishes a live URL (article or /p/… landing). Default ON.
 * Set FEATURE_GEO_PUBLISH_APPLY=false for draft-only legacy apply.
 */
export function isGeoPublishApplyEnabled(): boolean {
  return env.FEATURE_GEO_PUBLISH_APPLY !== 'false';
}

/**
 * Require HTTP 200 (or soft DB ok for app-hosted /blog/…/p/… paths) before keeping published.
 * Default ON; set FEATURE_PUBLISH_VERIFY=false to skip the live check.
 */
export function isPublishVerifyEnabled(): boolean {
  return env.FEATURE_PUBLISH_VERIFY !== 'false';
}

/**
 * GEO win requires target/brand host in cited sources (causal). Default ON.
 * Set FEATURE_GEO_CAUSAL_WIN=false for legacy any-mention wins.
 */
export function isGeoCausalWinEnabled(): boolean {
  return env.FEATURE_GEO_CAUSAL_WIN !== 'false';
}

/**
 * Free SFB listings require badge verify before order status=completed. Default ON.
 * Set FEATURE_SFB_BADGE=false to allow completed when the listing is merely published.
 */
export function isSfbBadgeEnabled(): boolean {
  return env.FEATURE_SFB_BADGE !== 'false';
}

/**
 * The pre-login guest preview: one post, from a website URL, before any account exists.
 * Default ON; set FEATURE_GUEST_PREVIEW=false to close the public path without a code deploy.
 * It is the only switch that stops an unauthenticated, money-spending endpoint, so it is read
 * BEFORE the rate-limit guard and before anything is generated.
 */
export function isGuestPreviewEnabled(): boolean {
  return env.FEATURE_GUEST_PREVIEW !== 'false';
}
