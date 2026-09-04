/**
 * Move an organization's billing from its paying brand up to the org row (#191).
 *
 *   npx vite-node --config scripts/vite-node.config.ts scripts/migrate-org-billing.ts
 *   …                                                 scripts/migrate-org-billing.ts --org <id> --apply
 *   …                                                 scripts/migrate-org-billing.ts --verify [--org <id>]
 *
 * Writes ONLY to `organizations`, and only the four billing columns. Stripe is never called: the
 * org reuses the very customer and subscription its brand already has, which is what makes this
 * reversible — the brand columns stay as they are and keep answering until a later migration
 * drops them.
 *
 * Dry run by default. `--apply` needs `--org`, because the rollout is one org at a time with a
 * check in between; migrating 90-odd rows in one command is not a thing this script can do.
 */
import { isPaying, planForOrg, type BillingValues, type BrandRow, type OrgRow } from './org-billing-plan';

// The server modules are pulled in from inside main(): importing them drags SvelteKit's env and
// the i18n bundle along, and `planForOrg` — the part that decides what gets written to a real
// billing row — is a pure function that should be testable without any of it.
type AdminClient = Awaited<ReturnType<typeof adminClient>>;
const adminClient = async () =>
  (await import('../src/lib/server/supabase-admin')).createAdminClient();

// ── the runner ───────────────────────────────────────────────────────────────────

const SELECT =
  'id, name, stripe_customer_id, stripe_subscription_id, plan, activated_at, ' +
  'brands(id, name, plan, stripe_customer_id, stripe_subscription_id, activated_at)';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function requireEnv() {
  const missing = ['PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(
    (k) => !process.env[k]
  );
  if (missing.length === 0) return;
  console.error(
    `Missing ${missing.join(' and ')}.\n` +
      'This script needs the service role: RLS hides other people\'s orgs from the anon key, so ' +
      'it would read an empty database and report that nothing needs migrating.\n' +
      '  npx vite-node --config scripts/vite-node.config.ts scripts/migrate-org-billing.ts'
  );
  process.exit(2);
}

async function loadOrgs(db: AdminClient, orgId?: string) {
  const q = db.from('organizations').select(SELECT).order('created_at', { ascending: true });
  const { data, error } = await (orgId ? q.eq('id', orgId) : q);
  if (error) throw new Error(`reading organizations: ${error.message}`);
  return (data ?? []) as unknown as OrgRow[];
}

const label = (o: OrgRow) => `${o.id.slice(0, 8)} ${o.name ?? '(no name)'}`;

async function report(orgs: OrgRow[], apply: boolean, db: AdminClient) {
  const counts = { migrate: 0, done: 0, skip: 0, conflict: 0 };

  for (const org of orgs) {
    const plan = planForOrg(org);
    counts[plan.kind]++;

    if (plan.kind === 'skip') {
      console.log(`  skip      ${label(org)} — ${plan.reason}`);
      continue;
    }
    if (plan.kind === 'done') {
      console.log(`  done      ${label(org)} — already migrated`);
      continue;
    }
    if (plan.kind === 'conflict') {
      console.log(`  CONFLICT  ${label(org)} — ${plan.brandIds.length} paying brands: ${plan.brandIds.join(', ')}`);
      console.log('            not migrating: pick the right subscription by hand first.');
      continue;
    }

    const v = plan.values;
    console.log(`  migrate   ${label(org)} — from brand ${plan.brandName ?? plan.brandId}`);
    console.log(`            customer=${v.stripe_customer_id} subscription=${v.stripe_subscription_id} plan=${v.plan} activated_at=${v.activated_at}`);

    if (!apply) continue;
    const { error } = await db.from('organizations').update(v).eq('id', org.id);
    if (error) throw new Error(`writing org ${org.id}: ${error.message}`);
    console.log('            written.');
  }

  console.log(
    `\n${orgs.length} orgs — ${counts.migrate} to migrate, ${counts.done} already done, ` +
      `${counts.skip} skipped, ${counts.conflict} conflicts`
  );
  if (counts.conflict > 0) process.exitCode = 1;
}

async function verify(orgs: OrgRow[], db: AdminClient) {
  for (const org of orgs) {
    const paying = (org.brands ?? []).filter(isPaying)[0];
    if (!org.stripe_customer_id && !paying) {
      console.log(`  skip      ${label(org)} — free, nothing to verify`);
      continue;
    }

    const same =
      !!paying &&
      org.stripe_customer_id === paying.stripe_customer_id &&
      org.stripe_subscription_id === paying.stripe_subscription_id &&
      org.plan === paying.plan;
    console.log(`  ${same ? '(a) ok    ' : '(a) MISMATCH'} ${label(org)}`);
    if (!same) {
      console.log(`            org   customer=${org.stripe_customer_id} subscription=${org.stripe_subscription_id} plan=${org.plan}`);
      console.log(`            brand customer=${paying?.stripe_customer_id} subscription=${paying?.stripe_subscription_id} plan=${paying?.plan}`);
      process.exitCode = 1;
    }

    const brand = paying ?? org.brands?.[0];
    if (!brand) continue;
    const { getCreditsUsage } = await import('../src/lib/server/credits');
    const usage = await getCreditsUsage(db as never, {
      id: brand.id,
      plan: org.plan ?? brand.plan,
      activated_at: org.activated_at ?? brand.activated_at,
      status: 'active'
    });
    console.log(
      `  (b)       pool ${usage.used}/${usage.quota} credits (${usage.percent}% used, ${usage.remaining} left), ` +
        `period ${usage.periodStart.toISOString().slice(0, 10)} → ${usage.periodEnd.toISOString().slice(0, 10)}`
    );
  }
  console.log('\n(c) billing portal opens and (d) an AI action passes the gate are NOT checked here — do those in the browser.');
}

async function main() {
  requireEnv();
  const orgId = arg('--org');
  const apply = process.argv.includes('--apply');
  const wantVerify = process.argv.includes('--verify');

  if (apply && !orgId) {
    console.error(
      '--apply needs --org <id>: the rollout is one org at a time, verified before the next.\n' +
        'Run without --apply first to see what a given org would get.'
    );
    process.exit(2);
  }

  const db = await adminClient();
  const orgs = await loadOrgs(db, orgId);
  if (orgs.length === 0) {
    console.error(orgId ? `No org ${orgId}.` : 'No organizations.');
    process.exit(1);
  }

  if (wantVerify) {
    console.log(`verify — ${orgs.length} org(s)\n`);
    await verify(orgs, db);
    return;
  }

  console.log(`${apply ? 'APPLY' : 'dry run — nothing is written'} — ${orgs.length} org(s)\n`);
  await report(orgs, apply, db);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
