// Organic-growth data readiness — shared client/server checks.
// When data is thin, produce/autopilot must refuse and ask the user to remediate
// (Studio / social sync / competitors / personality), not ship generic wallpaper.

export type GrowthCheckKey =
  | 'about'
  | 'voice'
  | 'history'
  | 'historyDepth'
  | 'competitors'
  | 'audience'
  | 'products'
  | 'visual'
  | 'knowledge'
  | 'plan'
  | 'web'
  | 'gsc'
  | 'social_connect';

export type GrowthCheck = {
  key: GrowthCheckKey;
  ok: boolean;
  /** false + blocking → produce/autopilot must not run. */
  blocking: boolean;
  /** App path to fix (includes /app/{slug}/…). */
  fix?: string;
  /** Optional numeric/context detail for i18n ({detail}). */
  detail?: string;
};

export type GrowthSnapshot = {
  slug: string;
  about: boolean;
  audience: boolean;
  /** Editorial-plan personality stamped into content_prefs (or active plan voice). */
  personality: boolean;
  /** Kit ai_character tone / speaking_style / brand_style. */
  voiceKit: boolean;
  historyCount: number;
  hasSocialHandles: boolean;
  competitorCount: number;
  productCount: number;
  hasVisualStyle: boolean;
  documentCount: number;
  hasEditorialPlan: boolean;
  /** Optional: an active website/blog configured (warn-only check; callers that don't track it stay ok). */
  hasWebsite?: boolean;
  /** Optional: Google Search Console connected (warn-only check; same opt-in semantics). */
  gscConnected?: boolean;
  /** Optional: at least one active social account to publish to (warn-only check; same opt-in semantics). */
  hasSocialAccounts?: boolean;
};

export type GrowthReadiness = {
  ready: boolean;
  checks: GrowthCheck[];
  blocking: GrowthCheck[];
  warnings: GrowthCheck[];
};

const HISTORY_MIN = 5;
const HISTORY_GOOD = 12;

/** Pure evaluator — unit-tested; same result on client and server. */
export function evaluateGrowthReadiness(s: GrowthSnapshot): GrowthReadiness {
  const base = `/app/${s.slug}`;
  const voiceOk = s.personality || s.voiceKit;
  const historyOk = s.historyCount >= HISTORY_MIN;
  const historyGood = s.historyCount >= HISTORY_GOOD;

  const checks: GrowthCheck[] = [
    {
      key: 'about',
      ok: s.about,
      blocking: true,
      fix: `${base}/settings/brand`
    },
    {
      key: 'voice',
      ok: voiceOk,
      blocking: true,
      fix: `${base}/plan`,
      detail: s.personality ? 'personality' : s.voiceKit ? 'kit' : undefined
    },
    {
      key: 'history',
      ok: historyOk,
      blocking: true,
      fix: `${base}/settings/connected-accounts`,
      detail: String(s.historyCount)
    },
    {
      key: 'historyDepth',
      ok: historyGood,
      blocking: false,
      fix: `${base}/settings/connected-accounts`,
      detail: String(s.historyCount)
    },
    {
      key: 'competitors',
      ok: s.competitorCount >= 1,
      blocking: true,
      fix: `${base}/settings/brand`,
      detail: String(s.competitorCount)
    },
    {
      key: 'audience',
      ok: s.audience,
      blocking: false,
      fix: `${base}/settings/brand`
    },
    {
      key: 'products',
      ok: s.productCount >= 1,
      blocking: false,
      fix: `${base}/settings/products`,
      detail: String(s.productCount)
    },
    {
      key: 'visual',
      ok: s.hasVisualStyle,
      blocking: false,
      fix: `${base}/settings/brand`
    },
    {
      key: 'knowledge',
      ok: s.documentCount >= 1,
      blocking: false,
      fix: `${base}/settings/knowledge`,
      detail: String(s.documentCount)
    },
    {
      key: 'plan',
      ok: s.hasEditorialPlan && s.personality,
      blocking: false,
      fix: `${base}/plan`
    },
    {
      key: 'web',
      ok: s.hasWebsite !== false,
      blocking: false,
      fix: `${base}/site`
    },
    {
      key: 'gsc',
      ok: s.gscConnected !== false,
      blocking: false,
      fix: `${base}/settings/search-console`
    },
    {
      key: 'social_connect',
      ok: s.hasSocialAccounts !== false,
      blocking: false,
      fix: `${base}/settings/connected-accounts`
    }
  ];

  const blocking = checks.filter((c) => !c.ok && c.blocking);
  const warnings = checks.filter((c) => !c.ok && !c.blocking);
  return {
    ready: blocking.length === 0,
    checks,
    blocking,
    warnings
  };
}

/** English operator message for CLI / NDJSON (UI uses i18n). */
export function growthReadinessMessage(r: GrowthReadiness): string {
  if (r.ready) {
    if (!r.warnings.length) return 'Brand data looks ready for organic growth content.';
    return `Ready to produce, with ${r.warnings.length} improvement(s): ${r.warnings.map((w) => w.key).join(', ')}.`;
  }
  const lines = r.blocking.map((c) => {
    const where = c.fix ? ` → ${c.fix}` : '';
    return `- ${c.key}${c.detail != null ? ` (${c.detail})` : ''}${where}`;
  });
  return [
    'Organic growth content needs better brand data first — fix these, then produce again:',
    ...lines
  ].join('\n');
}
