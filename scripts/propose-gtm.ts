// One-off GTM roadmap generation for a brand (proposeGtmDual + persist as proposed).
// Run: GTM_PROVIDER=kie npx vite-node --config scripts/vite-node.config.ts scripts/propose-gtm.ts [slug]
import { createAdminClient } from '../src/lib/server/supabase-admin';
import { genaiClient } from '../src/lib/server/brand-context';
import { withBrandContext } from '../src/lib/server/ai-log';
import { proposeGtmDual } from '../src/lib/server/gtm';
import { plannerProfile, planEvidence } from '../src/lib/server/planner-inputs';
import { localeLanguageName } from '../src/lib/i18n/locale';

const slugOrId = process.argv[2] ?? 'anomalia';
const objective = process.argv[3] ?? '';
const locale = process.argv[4] ?? 'it';
const ownerEmail = process.argv[5] ?? process.env.OWNER_EMAIL ?? '';
const admin = createAdminClient();

const isUuid = /^[0-9a-f-]{36}$/i.test(slugOrId);
let brandQuery = admin.from('brands').select('id, name, slug, plan, timezone, target_platforms, org_id');
brandQuery = isUuid ? brandQuery.eq('id', slugOrId) : brandQuery.eq('slug', slugOrId);
const { data: matches, error: brandErr } = await brandQuery;

if (brandErr || !matches?.length) {
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
      console.error(`slug '${slugOrId}' is ambiguous (${scoped.length} in your workspace). Pass the brand id instead.`);
      for (const b of scoped) console.error(`  - ${b.id} (${b.name})`);
      process.exit(1);
    }
  }
}

const slug = brand.slug;

const platforms = Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [];
const provider = (process.env.GTM_PROVIDER ?? 'gemini').toLowerCase();
console.log(`[gtm] ${slug} (${brand.id}) — provider=${provider}, locale=${locale}`);

const t0 = Date.now();
const plan = await withBrandContext(brand.id, async () => {
  const [profile, evidence] = await Promise.all([
    plannerProfile(admin, { id: brand.id, name: brand.name }),
    planEvidence(admin, brand.id)
  ]);
  return proposeGtmDual(genaiClient(), profile, {
    objective,
    platforms,
    outputLanguage: localeLanguageName(locale),
    benchmark: evidence.benchmark,
    topPosts: evidence.topPosts,
    zeroToOne: evidence.historyCount < 10
  });
});

await admin.from('gtm_plans').update({ status: 'rejected' }).eq('brand_id', brand.id).eq('status', 'proposed');
const dualPhases = { horizon_90d: plan.phases_90d ?? [], horizon_6m: plan.phases_6m ?? plan.phases };
const { data: row, error: insertErr } = await admin
  .from('gtm_plans')
  .insert({
    brand_id: brand.id,
    status: 'proposed',
    horizon: '6m',
    objective: plan.objective || null,
    phases: dualPhases,
    funnel: plan.funnel ?? null,
    source: 'manual'
  })
  .select('id')
  .single();

if (insertErr) {
  console.error('[gtm] insert failed:', insertErr.message);
  process.exit(1);
}

console.log(`[gtm] done in ${Math.round((Date.now() - t0) / 1000)}s — proposed plan ${row.id}`);
console.log(`[gtm] objective: ${plan.objective}`);
console.log(`[gtm] 90d phases: ${(plan.phases_90d ?? []).map((p) => p.name).join(' → ')}`);
console.log(`[gtm] 6m phases: ${(plan.phases_6m ?? plan.phases).map((p) => p.name).join(' → ')}`);
