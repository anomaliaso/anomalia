// Unified app warnings — one source so every surface reports problems the same way. Computed once
// (server-side, in the brand layout load) and rendered by the global WarningCenter. Titles/messages
// are i18n KEYS (translated client-side); `values` feed interpolation; `href` is a full path.
import { writable } from 'svelte/store';
import { getPlatform } from '$lib/components/platform-meta';

export type WarningSeverity = 'error' | 'warning' | 'suggestion';

export interface AppWarning {
  id: string;
  severity: WarningSeverity;
  title: string; // i18n key
  message: string; // i18n key
  values?: Record<string, string | number>;
  href?: string;
}

const normPlatform = (p: string) => { const k = String(p ?? '').toLowerCase().trim(); return k === 'twitter' ? 'x' : k; };
const labels = (keys: string[]) => keys.map((k) => getPlatform(k).label).join(', ');

// True when the two platform lists cover a different SET (order/dupes ignored).
function setsDiffer(a: string[], b: string[]): boolean {
  const sa = new Set(a.map(normPlatform));
  const sb = new Set(b.map(normPlatform));
  if (sa.size !== sb.size) return true;
  for (const x of sa) if (!sb.has(x)) return true;
  return false;
}

// The brand-level signals every warning is derived from. Kept flat so the layout load can fill it
// from what it already queries.
export interface BrandWarningInput {
  base: string; // e.g. /app/acme
  // False for free/trial brands — connect CTAs must go to /activate (pricing), not Settings OAuth.
  canConnectSocials?: boolean;
  targetPlatforms: string[];
  connectedPlatforms: string[];
  brokenPlatforms: string[]; // accounts that exist but need reconnecting (expired/error/disconnected)
  autopilotFailureCount: number; // consecutive autopilot failures (>=3 → auto-disabled)
  autopilotMaxFailures: number; // the threshold at which autopilot auto-disables
  hasProposedPlan: boolean; // an autopilot-proposed strategy/plan is awaiting the user's review
  strategyPlatforms: string[] | null; // null = no strategy generated yet
  editorialPlanPlatforms: string[] | null; // null = no active editorial plan
  contentPlatforms: string[]; // platforms of generated, not-yet-published posts
  contentCount: number; // how many such posts exist
  failedPostCount: number; // posts whose publish failed
  attentionPostCount: number; // posts flagged for a human look (Director, media QC, …)
  postsRemaining: number; // monthly post budget left
  postsQuota: number; // monthly post quota (0 → unmetered/unknown)
  hasStrategy: boolean; // an active GTM roadmap exists
  hasEditorialPlan: boolean; // an active editorial plan with content exists
  // Null until the optional people→preview half finishes (or legacy brands that completed the full wizard).
  onboardingCompleted: boolean;
  pendingCount: number;
  calendarConflicts: number; // time slots with 2+ posts double-booked on the same minute
  // Studio gaps — specific missing pieces the AI could use.
  hasLogo: boolean;
  hasVisualStyle: boolean;
  hasHashtags: boolean;
  peopleCount: number;
  competitorCount: number;
  blogEnabled: boolean; // the brand opted its blog into the content pipeline (plan + radar)
  hasGeoAudit: boolean; // at least one GEO audit has been run
}

export function computeBrandWarnings(i: BrandWarningInput): AppWarning[] {
  const targets = [...new Set((i.targetPlatforms ?? []).map(normPlatform).filter(Boolean))];
  const connected = new Set((i.connectedPlatforms ?? []).map(normPlatform));
  const broken = new Set((i.brokenPlatforms ?? []).map(normPlatform));
  // A platform is "set up" if it has any account, active OR broken — a broken one is flagged
  // separately (reconnect), so it must not ALSO read as "never connected".
  const hasAccount = new Set([...connected, ...broken]);
  const connectHref =
    i.canConnectSocials === false ? `${i.base}/activate` : `${i.base}/settings/connected-accounts`;
  const out: AppWarning[] = [];

  // A previously-connected account is now broken (token expired / revoked) → publishing fails there.
  if (broken.size) {
    out.push({ id: 'account-needs-reconnect', severity: 'error', title: 'warnings.reconnect.title', message: 'warnings.reconnect.msg', values: { platforms: labels([...broken]) }, href: connectHref });
  }

  if (targets.length === 0) {
    out.push({ id: 'no-platforms', severity: 'warning', title: 'warnings.noPlatforms.title', message: 'warnings.noPlatforms.msg', href: `${i.base}/settings/brand#platforms` });
  } else {
    const notConnected = targets.filter((p) => !hasAccount.has(p));
    if (notConnected.length) {
      out.push({ id: 'platforms-not-connected', severity: 'error', title: 'warnings.notConnected.title', message: 'warnings.notConnected.msg', values: { platforms: labels(notConnected) }, href: connectHref });
    }
    // Strategy drift: the strategy was built for a different set of platforms than the brand now
    // operates on → it should be regenerated to fit them.
    if (i.strategyPlatforms && i.strategyPlatforms.length && setsDiffer(targets, i.strategyPlatforms)) {
      const strat = i.strategyPlatforms.map(normPlatform);
      out.push({ id: 'strategy-platform-mismatch', severity: 'warning', title: 'warnings.strategyMismatch.title', message: 'warnings.strategyMismatch.msg', values: { strategy: labels([...new Set(strat)]), current: labels(targets) }, href: `${i.base}/gtm` });
    }

    // The editorial plan cascades from the strategy — if it too was built for other platforms, it
    // needs adjusting to the new set.
    if (i.editorialPlanPlatforms && i.editorialPlanPlatforms.length && setsDiffer(targets, i.editorialPlanPlatforms)) {
      const plan = i.editorialPlanPlatforms.map(normPlatform);
      out.push({ id: 'plan-platform-mismatch', severity: 'warning', title: 'warnings.planMismatch.title', message: 'warnings.planMismatch.msg', values: { plan: labels([...new Set(plan)]), current: labels(targets) }, href: `${i.base}/plan` });
    }

    // Cross-post opportunity: content already generated but not yet published doesn't cover some of
    // the current platforms (typically the freshly-added ones) → it could be cross-posted there.
    if (i.contentCount > 0) {
      const covered = new Set((i.contentPlatforms ?? []).map(normPlatform));
      const missing = targets.filter((p) => !covered.has(p));
      if (missing.length) {
        out.push({ id: 'crosspost-opportunity', severity: 'suggestion', title: 'warnings.crosspost.title', message: 'warnings.crosspost.msg', values: { platforms: labels(missing), count: i.contentCount }, href: `${i.base}/calendar` });
      }
    }
  }

  // Autopilot health: repeated failures degrade to a warning, then auto-disable (a hard error the
  // user must act on to resume the weekly engine).
  if (i.autopilotFailureCount >= i.autopilotMaxFailures) {
    out.push({ id: 'autopilot-disabled', severity: 'error', title: 'warnings.autopilotDisabled.title', message: 'warnings.autopilotDisabled.msg', href: `${i.base}/settings` });
  } else if (i.autopilotFailureCount > 0) {
    out.push({ id: 'autopilot-failing', severity: 'warning', title: 'warnings.autopilotFailing.title', message: 'warnings.autopilotFailing.msg', values: { count: i.autopilotFailureCount }, href: `${i.base}/settings` });
  }

  // Autopilot proposed a new strategy/plan cycle and is waiting for the user to review it.
  if (i.hasProposedPlan) {
    out.push({ id: 'plan-proposed', severity: 'suggestion', title: 'warnings.proposed.title', message: 'warnings.proposed.msg', href: `${i.base}/gtm` });
  }

  // Publishing failed on one or more posts — a hard failure the user must see.
  if (i.failedPostCount > 0) {
    out.push({ id: 'failed-posts', severity: 'error', title: 'warnings.failed.title', message: 'warnings.failed.msg', values: { count: i.failedPostCount }, href: `${i.base}/calendar?status=failed` });
  }
  // Posts flagged for a human look before they go out (Director, media QC remake, …).
  if (i.attentionPostCount > 0) {
    out.push({ id: 'posts-need-attention', severity: 'warning', title: 'warnings.attention.title', message: 'warnings.attention.msg', values: { count: i.attentionPostCount }, href: `${i.base}/calendar` });
  }
  // Monthly post budget used up — nothing new will be produced until it resets or the plan upgrades.
  if (i.postsQuota > 0 && i.postsRemaining <= 0) {
    out.push({ id: 'quota-exhausted', severity: 'warning', title: 'warnings.quota.title', message: 'warnings.quota.msg', values: { quota: i.postsQuota }, href: `${i.base}/settings` });
  }
  // Optional onboarding half (people → strategy → plan → first posts) not finished yet.
  // Continue in the brand overview chat — the assistant drives the remaining setup steps.
  if (!i.onboardingCompleted) {
    out.push({
      id: 'continue-onboarding',
      severity: 'suggestion',
      title: 'warnings.continueOnboarding.title',
      message: 'warnings.continueOnboarding.msg',
      href: i.base
    });
  }

  // Strategy layers not set up yet — nudge the user through them in order (strategy → plan).
  // Skipped when the continue-onboarding CTA already covers the same gap.
  if (i.onboardingCompleted && !i.hasStrategy) {
    out.push({ id: 'no-strategy', severity: 'suggestion', title: 'warnings.noStrategy.title', message: 'warnings.noStrategy.msg', href: `${i.base}/gtm` });
  } else if (i.onboardingCompleted && !i.hasEditorialPlan) {
    out.push({ id: 'no-plan', severity: 'suggestion', title: 'warnings.noPlan.title', message: 'warnings.noPlan.msg', href: `${i.base}/plan` });
  }

  if (i.pendingCount > 0) {
    out.push({ id: 'pending-posts', severity: 'suggestion', title: 'warnings.pending.title', message: 'warnings.pending.msg', values: { count: i.pendingCount }, href: `${i.base}/calendar` });
  }

  // Two or more posts booked on the same minute → they'd fire on top of each other. The calendar
  // banner there offers to let the AI rebalance the schedule.
  if (i.calendarConflicts > 0) {
    out.push({ id: 'calendar-conflicts', severity: 'warning', title: 'warnings.calendarConflicts.title', message: 'warnings.calendarConflicts.msg', values: { count: i.calendarConflicts }, href: `${i.base}/calendar` });
  }

  // Studio gaps — each missing piece is a specific, actionable suggestion (the AI produces better
  // content with them, but none blocks generation).
  if (!i.hasLogo) out.push({ id: 'studio-no-logo', severity: 'suggestion', title: 'warnings.studioLogo.title', message: 'warnings.studioLogo.msg', href: `${i.base}/settings/brand` });
  if (!i.hasVisualStyle) out.push({ id: 'studio-no-visual-style', severity: 'suggestion', title: 'warnings.studioVisual.title', message: 'warnings.studioVisual.msg', href: `${i.base}/settings/brand` });
  if (i.peopleCount === 0) out.push({ id: 'studio-no-people', severity: 'suggestion', title: 'warnings.studioPeople.title', message: 'warnings.studioPeople.msg', href: `${i.base}/settings/people` });
  if (i.competitorCount === 0) out.push({ id: 'studio-no-competitors', severity: 'suggestion', title: 'warnings.studioCompetitors.title', message: 'warnings.studioCompetitors.msg', href: `${i.base}/competitors` });
  if (!i.hasHashtags) out.push({ id: 'studio-no-hashtags', severity: 'suggestion', title: 'warnings.studioHashtags.title', message: 'warnings.studioHashtags.msg', href: `${i.base}/settings/brand#hashtags` });

  // Blog not opted in → Anomalia's plan & radar generate social only. Nudge the user to enable it so
  // the pipeline also produces blog articles (from the plan and from the news).
  if (!i.blogEnabled) out.push({ id: 'blog-not-enabled', severity: 'suggestion', title: 'warnings.blogOff.title', message: 'warnings.blogOff.msg', href: `${i.base}/site` });

  // No GEO audit yet — nudge the user to run one so they see their AI visibility.
  if (!i.hasGeoAudit) out.push({ id: 'no-geo-audit', severity: 'suggestion', title: 'warnings.noGeoAudit.title', message: 'warnings.noGeoAudit.msg', href: `${i.base}/seo` });

  return out;
}

export function warningCounts(warnings: AppWarning[]): { error: number; warning: number; suggestion: number; total: number } {
  const c = { error: 0, warning: 0, suggestion: 0, total: warnings.length };
  for (const w of warnings) c[w.severity]++;
  return c;
}

/** Shared open state so the sidebar bell can open the WarningCenter drawer. */
export const warningCenterOpen = writable(false);

/**
 * Gli avvisi del brand, pubblicati da `WarningCenter` (che li riceve dal layout) perché la
 * CAMPANELLA vive nel fondo della sidebar, dall'altra parte dell'albero.
 *
 * ponytail: uno store invece di una prop, perché il layout del brand è in mano a un altro
 * lavoro in corso e non va toccato. Quando si libera, la sidebar può ricevere `warnings`
 * direttamente e questo store sparisce — il pannello resta lo stesso, cambia solo la via.
 */
export const brandWarnings = writable<AppWarning[]>([]);

// ── Quante NON ne hai ancora viste ──────────────────────────────────────────────────────────────
// Il badge mostrava il totale, che è quasi sempre lo stesso numero: un contatore che non cala mai
// non è una notifica, è un adesivo. Quello che serve distinguere è "quante segnalazioni esistono"
// (il pannello) da "quante non hai ancora guardato" (il badge).
//
// Niente timestamp da confrontare: un AppWarning è STATO ricalcolato a ogni caricamento, non un
// evento, e non ha un istante di nascita. Ha però un `id` stabile (sono costanti: 'failed-posts',
// 'no-strategy', `agent:<uuid>`…), quindi il segnalibro è l'INSIEME degli id già visti. Tre casi,
// tutti gratis: una segnalazione che si risolve sparisce dalla lista e quindi dal badge; una
// ancora aperta ma già vista resta nel segnalibro e non riaccende niente a ogni ricarica; una
// nuova ha un id che nel segnalibro non c'è, e si accende.
//
// ponytail: localStorage, come SHELL_PREF_KEYS — quindi il "visto" è PER DISPOSITIVO. Segnarle
// viste sul portatile le lascia accese sul telefono. Farlo per utente vorrebbe una colonna dove
// salvare preferenze utente, che oggi non c'è: la proposta di migration è nel report.
export const seenWarningsKey = (brandSlug: string) => `anomalia.warningsSeen.${brandSlug}`;

/**
 * Le segnalazioni non ancora viste. `seen` è l'insieme salvato all'ultima apertura del pannello.
 */
export function unseenWarnings(
  warnings: readonly AppWarning[],
  seen: readonly string[]
): AppWarning[] {
  const s = new Set(seen);
  return warnings.filter((w) => !s.has(w.id));
}

/**
 * Il segnalibro da salvare quando il pannello si apre: gli id attualmente PRESENTI, non l'unione
 * con quelli vecchi. Così non cresce all'infinito, e una segnalazione che sparisce e più avanti
 * ritorna conta come nuova — che è esattamente quello che è.
 */
export function seenAfterOpening(warnings: readonly AppWarning[]): string[] {
  return warnings.map((w) => w.id);
}

/**
 * Gli id già visti per questo brand. `null` = non ancora letto dal disco: finché è null il badge
 * non dice niente, invece di lampeggiare il totale per un fotogramma e poi correggersi.
 */
export const seenWarningIds = writable<readonly string[] | null>(null);

export function loadSeenWarnings(brandSlug: string): void {
  if (typeof localStorage === 'undefined' || !brandSlug) return;
  try {
    const raw = localStorage.getItem(seenWarningsKey(brandSlug));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    seenWarningIds.set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    // Segnalibro illeggibile (quota, dati vecchi): si riparte da "niente visto", mai un crash.
    seenWarningIds.set([]);
  }
}

export function markWarningsSeen(brandSlug: string, warnings: readonly AppWarning[]): void {
  const ids = seenAfterOpening(warnings);
  seenWarningIds.set(ids);
  if (typeof localStorage === 'undefined' || !brandSlug) return;
  try {
    localStorage.setItem(seenWarningsKey(brandSlug), JSON.stringify(ids));
  } catch {
    /* niente spazio: il badge resta giusto per questa sessione */
  }
}
