// Smoke-test strategy, week-planner, and GTM agents on a live brand.
//   npx vite-node --config scripts/vite-node.config.ts scripts/run-agents-smoke.ts [slug] [ownerEmail]
//
// Does NOT persist plans — only exercises agent loops + agent_runs / ai_calls logging.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAdminClient } from '../src/lib/server/supabase-admin';
import { withBrandContext } from '../src/lib/server/ai-log';
import { genaiClient } from '../src/lib/server/brand-context';
import {
  buildProposeSeedBrief,
  cadenceAllowed,
  loadActivePlan,
  postsForWeek,
  weekStrategyBrief
} from '../src/lib/server/editorial-plan';
import { planWeekStrategy } from '../src/lib/server/content-preview';
import { plannerProfile, planEvidence } from '../src/lib/server/planner-inputs';
import { localeLanguageName } from '../src/lib/i18n/locale';
import { activeGtmBrief } from '../src/lib/server/gtm';
import { proposeGtmDual } from '../src/lib/server/gtm';
import { loadApprovedRubrics } from '../src/lib/server/rubrics';
import { attachBrandPages } from '../src/lib/server/content-library';
import { runStrategyAgent } from '../src/lib/server/strategy-agent';

const slugOrId = process.argv[2] ?? 'anomalia';
const ownerEmail = process.argv[3] ?? process.env.OWNER_EMAIL ?? '';
const only = new Set((process.argv[4] ?? 'all').split(',').map((s) => s.trim()));
const runStrategy = only.has('all') || only.has('strategy');
const runWeek = only.has('all') || only.has('week');
const runGtm = only.has('all') || only.has('gtm');
const locale = 'it';

const admin = createAdminClient();
const isUuid = /^[0-9a-f-]{36}$/i.test(slugOrId);
let brandQuery = admin.from('brands').select('id, name, slug, plan, timezone, target_platforms, org_id');
brandQuery = isUuid ? brandQuery.eq('id', slugOrId) : brandQuery.eq('slug', slugOrId);
const { data: matches } = await brandQuery;
if (!matches?.length) {
  console.error(`brand '${slugOrId}' not found`);
  process.exit(1);
}
let brand = matches[0];
if (!isUuid && matches.length > 1 && ownerEmail) {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const user = users.users.find((u) => u.email?.toLowerCase() === ownerEmail.toLowerCase());
  if (user) {
    const { data: orgs } = await admin.from('organizations').select('id').eq('owner_id', user.id);
    const orgIds = new Set((orgs ?? []).map((o) => o.id));
    const scoped = matches.filter((b) => orgIds.has(b.org_id));
    if (scoped.length === 1) brand = scoped[0];
    else if (scoped.length > 1) {
      console.error('ambiguous slug — pass brand id');
      process.exit(1);
    }
  }
}

console.log(`[smoke] brand=${brand.slug} (${brand.id}) owner=${ownerEmail}\n`);

const platforms = Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : ['instagram'];
const allowedCadences = cadenceAllowed(brand.plan);
const outputLanguage = localeLanguageName(locale);

const [profile, evidence, gtmBrief, rubrics, editorialPlan] = await Promise.all([
  plannerProfile(admin, { id: brand.id, name: brand.name }),
  planEvidence(admin, brand.id),
  activeGtmBrief(admin, brand.id, brand.timezone).catch(() => ''),
  loadApprovedRubrics(admin, brand.id).catch(() => []),
  loadActivePlan(admin, brand.id)
]);

await attachBrandPages(profile, admin, brand.id).catch(() => {});

const planOpts = {
  platforms,
  allowedCadences,
  outputLanguage,
  strategyBrief: [gtmBrief, evidence.strategyBrief].filter(Boolean).join('\n\n'),
  benchmark: evidence.benchmark,
  topPosts: evidence.topPosts,
  zeroToOne: evidence.historyCount < 10,
  brandId: brand.id,
  supabase: admin,
  planTier: brand.plan,
  timezone: brand.timezone,
  rubrics
};

const results: Record<string, unknown> = { brand: { slug: brand.slug, id: brand.id } };
const tAll = Date.now();

// ── 1. Strategy agent (propose) ─────────────────────────────────────────────
if (runStrategy) {
console.log('── Strategy agent (propose) ──');
const t1 = Date.now();
const strategyResult = await withBrandContext(brand.id, () =>
  runStrategyAgent({
    supabase: admin,
    brandId: brand.id,
    profile,
    constraints: { allowedCadences, platforms, planTier: brand.plan, timezone: brand.timezone },
    mode: 'propose',
    seedBrief: buildProposeSeedBrief(planOpts),
    outputLanguage,
    verbose: true,
    planOpts
  })
);
results.strategy = {
  durationMs: Date.now() - t1,
  costUsd: strategyResult.costUsd,
  notes: strategyResult.notes,
  citations: strategyResult.citations?.length ?? 0,
  cadence: strategyResult.plan.cadence,
  weeks: strategyResult.plan.weeks?.length
};
console.log(`  done ${Math.round((Date.now() - t1) / 1000)}s · $${strategyResult.costUsd.toFixed(4)} · ${strategyResult.notes.slice(0, 120)}…\n`);
}

// ── 2. Week planner agent ───────────────────────────────────────────────────
if (runWeek) {
console.log('── Week planner agent ──');
const weekIndex = 0;
const weekCount = editorialPlan ? postsForWeek(editorialPlan, weekIndex) : 3;
const weekBrief = editorialPlan ? weekStrategyBrief(editorialPlan, weekIndex, rubrics) : planOpts.strategyBrief;
const t2 = Date.now();
const weekStrategy = await withBrandContext(brand.id, () =>
  planWeekStrategy(
    profile,
    {
      platforms,
      strategyBrief: weekBrief,
      rubrics,
      supabase: admin,
      brandId: brand.id,
      weekIndex,
      agentVerbose: true
    },
    weekCount
  )
);
results.weekPlanner = {
  durationMs: Date.now() - t2,
  seeds: weekStrategy.seeds?.length ?? 0,
  sample: weekStrategy.seeds?.[0]?.hook?.slice(0, 80)
};
console.log(`  done ${Math.round((Date.now() - t2) / 1000)}s · ${weekStrategy.seeds?.length ?? 0} seeds\n`);
}

// ── 3. GTM strategy agent (propose) ─────────────────────────────────────────
if (runGtm) {
console.log('── GTM strategy agent (propose) ──');
const t3 = Date.now();
const gtmPlan = await withBrandContext(brand.id, () =>
  proposeGtmDual(genaiClient(), profile, {
    platforms,
    outputLanguage,
    topPosts: evidence.topPosts,
    zeroToOne: evidence.historyCount < 10,
    supabase: admin,
    brandId: brand.id,
    timezone: brand.timezone,
    agentVerbose: true
  })
);
results.gtm = {
  durationMs: Date.now() - t3,
  objective: gtmPlan.objective?.slice(0, 120),
  phases90d: gtmPlan.phases_90d?.length ?? 0,
  phases6m: gtmPlan.phases_6m?.length ?? gtmPlan.phases?.length ?? 0
};
console.log(`  done ${Math.round((Date.now() - t3) / 1000)}s · ${gtmPlan.phases_90d?.length ?? 0}×90d · ${gtmPlan.phases_6m?.length ?? 0}×6m\n`);
}

// ── agent_runs + ai_calls snapshot ──────────────────────────────────────────
const since = new Date(tAll - 5000).toISOString();
const [{ data: runs }, { data: calls }] = await Promise.all([
  admin.from('agent_runs').select('agent, status, finished_ok, cost_usd_estimate, created_at').eq('brand_id', brand.id).gte('created_at', since).order('created_at', { ascending: false }),
  admin.from('ai_calls').select('label, provider, cost_usd, provider_credits').eq('brand_id', brand.id).gte('created_at', since).not('cost_usd', 'is', null)
]);
const aiCallsUsd = (calls ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
results.telemetry = {
  agentRuns: runs ?? [],
  aiCallsCount: calls?.length ?? 0,
  aiCallsUsd: Math.round(aiCallsUsd * 1e6) / 1e6,
  estimateSum: (runs ?? []).reduce((s, r) => s + Number(r.cost_usd_estimate ?? 0), 0)
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(process.cwd(), 'strategy-runs', `${brand.slug}-smoke-${stamp}`);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'smoke.json'), JSON.stringify(results, null, 2));

console.log('── Telemetry (this run) ──');
for (const r of runs ?? []) {
  console.log(`  agent_runs: ${r.agent} ok=${r.finished_ok} estimate=$${Number(r.cost_usd_estimate ?? 0).toFixed(4)}`);
}
console.log(`  ai_calls: ${calls?.length ?? 0} rows · $${aiCallsUsd.toFixed(4)} total`);
console.log(`\n[smoke] total ${Math.round((Date.now() - tAll) / 1000)}s · output ${outDir}`);
