// Live strategy-agent run with full step logging.
//   GTM_PROVIDER=kie npx vite-node --config scripts/vite-node.config.ts scripts/run-strategy-agent.ts [slug] [mode] [feedback] [ownerEmail] [locale]
//   mode: propose | revise | replan (default revise)
//
// Writes strategy-runs/<slug>-<timestamp>/run.json + run.md with every tool call.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAdminClient } from '../src/lib/server/supabase-admin';
import { withBrandContext } from '../src/lib/server/ai-log';
import { runStrategyAgent, type StrategyAgentMode } from '../src/lib/server/strategy-agent';
import { buildProposeSeedBrief, cadenceAllowed, loadActivePlan } from '../src/lib/server/editorial-plan';
import { plannerProfile, planEvidence } from '../src/lib/server/planner-inputs';
import { localeLanguageName } from '../src/lib/i18n/locale';
import { activeGtmBrief } from '../src/lib/server/gtm';

const slugOrId = process.argv[2] ?? 'anomalia';
const modeArg = (process.argv[3] ?? 'revise').toLowerCase();
const mode: StrategyAgentMode = ['propose', 'revise', 'replan'].includes(modeArg)
  ? (modeArg === 'replan' ? 'replan_week' : (modeArg as StrategyAgentMode))
  : 'revise';
const feedback =
  (['propose', 'revise', 'replan'].includes(modeArg) ? process.argv[4] : process.argv[3]) ??
  (mode === 'propose'
    ? ''
    : mode === 'replan_week'
      ? 'Settimana lancio: focus su automazione social per founder tech, zero caroselli prodotto.'
      : 'Aumenta il peso di Reddit nel piano e riduci i caroselli — abbiamo pochi prodotti fotografati.');
const ownerEmail =
  (['propose', 'revise', 'replan'].includes(modeArg) ? process.argv[5] : process.argv[4]) ??
  process.env.OWNER_EMAIL ?? '';
const locale =
  (['propose', 'revise', 'replan'].includes(modeArg) ? process.argv[6] : process.argv[5]) ?? 'it';

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

const plan = mode === 'propose' ? null : await loadActivePlan(admin, brand.id);
if (mode !== 'propose' && !plan) {
  console.error(`no active editorial plan for ${brand.slug}`);
  process.exit(1);
}

const [profile, evidence, gtmBrief] = await Promise.all([
  plannerProfile(admin, { id: brand.id, name: brand.name }),
  planEvidence(admin, brand.id),
  activeGtmBrief(admin, brand.id, brand.timezone).catch(() => '')
]);

const platforms = Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [];
const allowedCadences = cadenceAllowed(brand.plan);
const planOpts = {
  platforms,
  allowedCadences,
  outputLanguage: localeLanguageName(locale),
  strategyBrief: [gtmBrief, evidence.strategyBrief].filter(Boolean).join('\n\n'),
  benchmark: evidence.benchmark,
  topPosts: evidence.topPosts,
  zeroToOne: evidence.historyCount < 10,
  brandId: brand.id,
  supabase: admin,
  planTier: brand.plan,
  timezone: brand.timezone
};
const seedBrief =
  mode === 'propose'
    ? buildProposeSeedBrief(planOpts)
    : feedback;

console.log(`[run] brand=${brand.slug} (${brand.id}) mode=${mode}`);
if (feedback) console.log(`[run] brief: ${feedback.slice(0, 120)}…\n`);

const t0 = Date.now();
const result = await withBrandContext(brand.id, () =>
  runStrategyAgent({
    supabase: admin,
    brandId: brand.id,
    profile,
    constraints: {
      allowedCadences,
      platforms,
      planTier: brand.plan,
      timezone: brand.timezone
    },
    mode,
    currentPlan: plan ?? undefined,
    seedBrief,
    weekIndex: mode === 'replan_week' ? 0 : undefined,
    outputLanguage: localeLanguageName(locale),
    verbose: true,
    planOpts
  })
);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(process.cwd(), 'strategy-runs', `${brand.slug}-agent-${stamp}`);
mkdirSync(outDir, { recursive: true });

const payload = {
  brand: { slug: brand.slug, id: brand.id, plan: brand.plan },
  mode,
  feedback: feedback || null,
  durationMs: Date.now() - t0,
  notes: result.notes,
  citations: result.citations,
  costUsd: result.costUsd,
  credits: result.credits,
  stepLog: result.stepLog,
  plan: result.plan
};
writeFileSync(join(outDir, 'run.json'), JSON.stringify(payload, null, 2));

const md = [
  `# Strategy agent run — ${brand.name}`,
  `_Generated ${new Date().toISOString()} · ${Math.round((Date.now() - t0) / 1000)}s · $${result.costUsd.toFixed(4)}_`,
  '',
  '## Feedback',
  feedback,
  '',
  '## Agent notes',
  result.notes,
  '',
  '## Citations',
  ...(result.citations.length
    ? result.citations.map((c) => `- [${c.title}](${c.uri})`)
    : ['_(none)_']),
  '',
  '## Steps',
  ...(result.stepLog ?? []).flatMap((s) => {
    const lines = [`### Step ${s.step}`];
    for (const tc of s.toolCalls ?? []) {
      lines.push(`**→ ${tc.name}**`, '```json', JSON.stringify(tc.input, null, 2), '```');
    }
    for (const tr of s.toolResults ?? []) {
      lines.push(`**← ${tr.name}**`, '```json', JSON.stringify(tr.output, null, 2).slice(0, 8000), '```');
    }
    if (s.text) lines.push(`_text:_ ${s.text}`);
    return [...lines, ''];
  }),
  '',
  '## Result plan',
  `**Strategy:** ${result.plan.strategy}`,
  `**Cadence:** ${result.plan.cadence}`,
  '',
  ...(result.plan.weeks ?? []).map(
    (w, i) =>
      `### Week ${i + 1} — ${w.theme}\n- Focus: ${w.focus}\n- Mix: ${(w.content_mix ?? []).map((m) => `${m.count}× ${m.type}`).join(', ')}\n`
  )
].join('\n');
writeFileSync(join(outDir, 'run.md'), md);

console.log(`\n[run] done in ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(`[run] notes: ${result.notes.slice(0, 300)}`);
console.log(`[run] output: ${outDir}`);
