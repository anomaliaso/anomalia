/** Anomalia management fee on top of platform ad spend (model A: pass-through + markup). */
export const AD_MANAGEMENT_FEE_RATE = 0.12;

/**
 * When false, Social ads / Google ads show a "book a call" placeholder instead of the self-serve
 * UI. The real page markup stays in place behind this gate — flip to `true` when automatic ads
 * go fully self-serve (no sales call required). Client-safe; mirrored by server loaders/actions.
 */
export const ADS_SELF_SERVE = false;


/**
 * True when this user may use the self-serve Ads UI. La allowlist di preview vive lato server
 * (internal-users.ts, da env): chi chiama da lì passa `preview`; il client riceve il booleano.
 */
export function adsSelfServeEnabled(preview = false): boolean {
  return ADS_SELF_SERVE || preview;
}

/** Credits per USD, same rate as the AI meter (src/lib/server/credits.ts). */
export const CREDITS_PER_USD = 100;

/**
 * The management fee, billed in AI credits instead of an invoice: launching a campaign and every
 * day it keeps spending draws down the same balance content generation uses.
 *
 * ponytail: no FX — one unit of the ad account's currency counts as one dollar. EUR/USD drift is
 * ±10% on a 12% fee; add a rate lookup here if a brand ever runs a far-off currency.
 */
export function creditsForSpend(spend: number): number {
  return Math.round(feeBreakdown(spend).fee * CREDITS_PER_USD);
}

/**
 * Accept what a human (or the AI) actually types: "anomalia.so" is a URL to everyone except
 * `<input type="url">` and `new URL()`. Adds the scheme when it is missing rather than rejecting
 * the value. Returns '' for anything that still isn't a usable http(s) URL.
 */
export function normalizeUrl(raw: string | null | undefined): string {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

/**
 * Server error code → i18n key + values. Only `credits_exhausted` carries data (it is encoded as
 * `credits_exhausted:<needed>:<left>` by approveCampaign); everything else is a plain code, and an
 * unknown one falls back to itself so a Zernio message still reaches the user.
 */
export function adsErrorMessage(error: string): { key: string; values: Record<string, string> } {
  const [code, needed, left] = error.split(':');
  if (code === 'credits_exhausted') {
    return { key: 'app.ads.err.credits_exhausted', values: { needed: needed ?? '', left: left ?? '0' } };
  }
  // Codes may carry a payload after a colon (`goal_not_supported:conversions`,
  // `invalid_status:active`). Key off the code alone, or the whole string became the key, no
  // translation ever matched, and the user read the raw identifier.
  return { key: `app.ads.err.${code}`, values: { detail: needed ?? '' } };
}

export function feeBreakdown(platformBudget: number): {
  platformBudget: number;
  fee: number;
  total: number;
  feeRate: number;
} {
  const amount = Math.max(0, Number(platformBudget) || 0);
  const fee = Math.round(amount * AD_MANAGEMENT_FEE_RATE * 100) / 100;
  return {
    platformBudget: amount,
    fee,
    total: Math.round((amount + fee) * 100) / 100,
    feeRate: AD_MANAGEMENT_FEE_RATE
  };
}
