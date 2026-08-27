// Live produce-agent dry-run on a brand (default: anomalia).
// Does NOT insert posts into the approval queue — only runs the agent loop and writes logs.
//
//   npx vite-node --config scripts/vite-node.config.ts \
//     scripts/run-produce-agent.ts [slug] [seedCount] [ownerEmail]
//   (PRODUCE_AGENT_ENABLED defaults ON; set =false to force legacy)
//
// Writes strategy-runs/produce-<slug>-<timestamp>/{run.json,run.md}

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAdminClient } from '../src/lib/server/supabase-admin';
import { planWeekStrategy, type ContentPrefs } from '../src/lib/server/content-preview';
import { plannerProfile, planEvidence } from '../src/lib/server/planner-inputs';
import { localeLanguageName } from '../src/lib/i18n/locale';
import { activeGtmBrief } from '../src/lib/server/gtm';
import { cadenceAllowed } from '../src/lib/server/editorial-plan';
import { loadApprovedRubrics } from '../src/lib/server/rubrics';
import { attachBrandPages } from '../src/lib/server/content-library';
import {
  produceAgentEnabled,
  runProduceAgentLoop,
  PRODUCE_MAX_ROUNDS
} from '../src/lib/server/produce-agent';

process.env.PRODUCE_AGENT_ENABLED = process.env.PRODUCE_AGENT_ENABLED ?? 'true';

const slugOrId = process.argv[2] ?? 'anomalia';
const seedCount = Math.max(1, Math.min(4, Number(process.argv[3] ?? 2) || 2));
const ownerEmail = process.argv[4] ?? process.env.OWNER_EMAIL ?? '';
const locale = 'it';

const admin = createAdminClient();
const isUuid = /^[0-9a-f-]{36}$/i.test(slugOrId);
let brandQuery = admin.from('brands').select('id, name, slug, plan, timezone, target_platforms, org_id, content_prefs');
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
  }
}

const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
const owner = users.users.find((u) => u.email?.toLowerCase() === ownerEmail.toLowerCase());
const userId = owner?.id ?? brand.id;

console.log(`[produce-dry] brand=${brand.slug} (${brand.id})`);
console.log(`[produce-dry] enabled=${produceAgentEnabled()} seeds=${seedCount} maxRounds=${PRODUCE_MAX_ROUNDS}`);
console.log(`[produce-dry] userId=${userId}\n`);

if (!produceAgentEnabled()) {
  console.error('PRODUCE_AGENT_ENABLED=false — aborting dry-run');
  process.exit(1);
}

const platforms = Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : ['instagram'];
const prefs = (brand.content_prefs as ContentPrefs) ?? {};
if (!prefs.language) prefs.language = localeLanguageName(locale);

const [profile, evidence, gtmBrief, rubrics] = await Promise.all([
  plannerProfile(admin, { id: brand.id, name: brand.name }),
  planEvidence(admin, brand.id),
  activeGtmBrief(admin, brand.id, brand.timezone).catch(() => ''),
  loadApprovedRubrics(admin, brand.id).catch(() => [])
]);
await attachBrandPages(profile, admin, brand.id).catch(() => {});

console.log('── Pass 1: plan seeds (week planner / legacy) ──');
const tPlan = Date.now();
const strategy = await planWeekStrategy(
  profile,
  {
    platforms,
    prefs,
    supabase: admin,
    brandId: brand.id,
    userId,
    timezone: brand.timezone,
    strategyBrief: [gtmBrief, evidence.strategyBrief].filter(Boolean).join('\n\n'),
    topPosts: evidence.topPosts,
    rubrics,
    allowedCadences: cadenceAllowed(brand.plan),
    maxVideos: 0,
    maxCarousels: 0,
    onProgress: (step, message) => console.log(`  [plan ${step}] ${message}`)
  },
  seedCount
);
console.log(`  planned ${strategy.seeds.length} seeds in ${Math.round((Date.now() - tPlan) / 1000)}s`);
console.log(`  theme: ${strategy.theme}`);
strategy.seeds.forEach((s, i) => {
  console.log(`  ${i}. [${s.platform}/${s.format}] ${s.angle.slice(0, 100)}`);
});

console.log('\n── Pass 2: produce agent ↔ reviewer loop ──');
const progressLog: Array<{ t: number; step: string; message: string }> = [];
const t0 = Date.now();
const result = await runProduceAgentLoop({
  supabase: admin,
  userId,
  brandId: brand.id,
  profile,
  strategy: { ...strategy, seeds: strategy.seeds.slice(0, seedCount) },
  prefs,
  maxVideos: 0,
  maxCarousels: 0,
  timezone: brand.timezone,
  strategyBrief: [gtmBrief, evidence.strategyBrief].filter(Boolean).join('\n\n'),
  deadlineMs: 360_000,
  onProgress: (step, message) => {
    const entry = { t: Date.now() - t0, step, message };
    progressLog.push(entry);
    console.log(`  [+${Math.round(entry.t / 1000)}s ${step}] ${message}`);
  }
});

const dir = join(
  'strategy-runs',
  `produce-${brand.slug}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
);
mkdirSync(dir, { recursive: true });

const payload = {
  brand: { id: brand.id, slug: brand.slug, name: brand.name },
  seedCount,
  durationMs: Date.now() - t0,
  strategy: {
    theme: strategy.theme,
    rationale: strategy.rationale,
    doDont: strategy.doDont,
    seeds: strategy.seeds.slice(0, seedCount)
  },
  result: result
    ? {
        approved: result.approved,
        rounds: result.rounds,
        batchJustification: result.batchJustification,
        reviewSummary: result.reviewSummary,
        posts: result.posts.map((p) => ({
          platform: p.platform,
          format: p.format,
          caption: p.caption,
          image_prompt: p.image_prompt?.slice(0, 240),
          justification: p.justification,
          imageUrl: p.imageUrl,
          imageUrls: p.imageUrls
        })),
        produceSteps: result.produceSteps,
        reviewSteps: result.reviewSteps
      }
    : null,
  progressLog
};

writeFileSync(join(dir, 'run.json'), JSON.stringify(payload, null, 2));

const md: string[] = [
  `# Produce agent dry-run — ${brand.name}`,
  '',
  `- Brand: \`${brand.slug}\` (\`${brand.id}\`)`,
  `- Duration: ${Math.round((Date.now() - t0) / 1000)}s`,
  `- Seeds: ${seedCount}`,
  `- Approved: ${result?.approved ?? 'null (fallback)'}`,
  `- Rounds: ${result?.rounds ?? 0}`,
  '',
  `## Theme`,
  strategy.theme,
  '',
  `## Batch justification`,
  result?.batchJustification || '_(none)_',
  '',
  `## Review summary`,
  result?.reviewSummary || '_(none)_',
  '',
  `## Progress`,
  ...progressLog.map((p) => `- \`+${Math.round(p.t / 1000)}s\` **${p.step}**: ${p.message}`),
  '',
  `## Produce tool steps (${result?.produceSteps.length ?? 0})`
];

for (const s of result?.produceSteps ?? []) {
  md.push(`### Produce step ${s.step}`);
  for (const c of s.toolCalls ?? []) {
    md.push(`- **call** \`${c.name}\` \`${JSON.stringify(c.input).slice(0, 200)}\``);
  }
  for (const r of s.toolResults ?? []) {
    const out = typeof r.output === 'string' ? r.output : JSON.stringify(r.output);
    md.push(`- **result** \`${r.name}\` ${out.slice(0, 400).replace(/\n/g, ' ')}`);
  }
  if (s.text) md.push(`- text: ${s.text.slice(0, 300)}`);
  md.push('');
}

md.push(`## Review tool steps (${result?.reviewSteps.length ?? 0})`);
for (const s of result?.reviewSteps ?? []) {
  md.push(`### Review step ${s.step}`);
  for (const c of s.toolCalls ?? []) {
    md.push(`- **call** \`${c.name}\` \`${JSON.stringify(c.input).slice(0, 300)}\``);
  }
  for (const r of s.toolResults ?? []) {
    const out = typeof r.output === 'string' ? r.output : JSON.stringify(r.output);
    md.push(`- **result** \`${r.name}\` ${out.slice(0, 400).replace(/\n/g, ' ')}`);
  }
  if (s.text) md.push(`- text: ${s.text.slice(0, 300)}`);
  md.push('');
}

md.push(`## Posts`);
for (const [i, p] of (result?.posts ?? []).entries()) {
  md.push(`### Post ${i} — ${p.platform} / ${p.format}`);
  md.push(`**Caption**\n\n${p.caption}\n`);
  md.push(`**Justification**\n\n${p.justification || '_(none)_'}\n`);
  md.push(`**Image brief**\n\n${p.image_prompt || '_(none)_'}\n`);
  if (p.imageUrl) md.push(`![post ${i}](${p.imageUrl})\n`);
}

writeFileSync(join(dir, 'run.md'), md.join('\n'));
console.log(`\n[produce-dry] wrote ${dir}/run.md`);
console.log(`[produce-dry] approved=${result?.approved} rounds=${result?.rounds} posts=${result?.posts.length ?? 0}`);
if (!result) process.exit(2);
