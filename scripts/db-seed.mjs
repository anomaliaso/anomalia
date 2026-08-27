/**
 * Self-host seed: the minimum to log in and see something — one demo user, one organization,
 * one brand. Idempotent (safe to re-run: finds what already exists instead of duplicating it).
 *
 * The demo user goes through GoTrue's admin API (POST /admin/users), not a hand-written insert
 * into auth.users: GoTrue owns the password hash format and the auth.identities row a real
 * signup would also create, and `handle_new_user` (migration 0001) already inserts the matching
 * `profiles` row via trigger — same path a real signup takes, just admin-triggered.
 * The organization/brand rows go straight to Postgres: GoTrue has no concept of them.
 *
 *   DATABASE_URL=postgres://... PUBLIC_SUPABASE_URL=http://localhost:8000 \
 *     SUPABASE_SERVICE_ROLE_KEY=... node scripts/db-seed.mjs
 *   npm run db:seed
 *
 * Override SEED_DEMO_EMAIL / SEED_DEMO_PASSWORD to not ship the same demo login everywhere.
 */
const SEED_EMAIL = process.env.SEED_DEMO_EMAIL || 'demo@example.com';
const SEED_PASSWORD = process.env.SEED_DEMO_PASSWORD || 'change-me-now-12345';
const SEED_ORG_NAME = process.env.SEED_ORG_NAME || 'Demo Org';
const SEED_BRAND_SLUG = process.env.SEED_BRAND_SLUG || 'demo';
const SEED_BRAND_NAME = process.env.SEED_BRAND_NAME || 'Demo Brand';
const SEED_BRAND_WEBSITE = process.env.SEED_BRAND_WEBSITE || 'https://example.com';
// A self-hosted instance is nobody's trial: BILLING_PROVIDER=open removes credit metering, but the
// ~75 feature gates that read brands.plan / brands.status directly do not go through the provider,
// and with plan=null accountLimit() is 0 — connecting a social account bounces to Stripe. So the
// seed brand starts on the top tier, active. Override if you want to exercise the gates.
const SEED_BRAND_PLAN = process.env.SEED_BRAND_PLAN || 'pro';
const SEED_BRAND_STATUS = process.env.SEED_BRAND_STATUS || 'active';

/** Create the demo user via GoTrue admin, or return the existing one by email (idempotent). */
export async function ensureDemoUser(gotrueUrl, serviceKey, email, password, fetchImpl = fetch) {
  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json'
  };

  const created = await fetchImpl(`${gotrueUrl}/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  if (created.ok) {
    const user = await created.json();
    return { id: user.id, created: true };
  }

  // Already exists (or any other admin-create failure) — look it up instead of failing the seed.
  for (let page = 1; page <= 5; page++) {
    const res = await fetchImpl(`${gotrueUrl}/admin/users?page=${page}&per_page=200`, { headers });
    if (!res.ok) break;
    const body = await res.json();
    const users = body.users ?? body;
    if (!Array.isArray(users) || users.length === 0) break;
    const match = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return { id: match.id, created: false };
  }

  const detail = await created.text().catch(() => created.statusText);
  throw new Error(`could not create or find demo user ${email}: ${created.status} ${detail}`);
}

/** One organization owned by the demo user (idempotent by owner_id — one demo org per demo user). */
export async function ensureOrg(client, ownerId, name) {
  const existing = await client.query('select id from organizations where owner_id = $1 limit 1', [
    ownerId
  ]);
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await client.query(
    'insert into organizations (name, owner_id) values ($1, $2) returning id',
    [name, ownerId]
  );
  return inserted.rows[0].id;
}

/** One brand in that org (idempotent via the (org_id, slug) unique constraint from migration 0001). */
export async function ensureBrand(client, orgId, slug, name, website, plan = SEED_BRAND_PLAN, status = SEED_BRAND_STATUS) {
  const row = await client.query(
    // The `do update` deliberately does NOT touch plan/status: an instance already in use must not
    // have them rewritten by every `npm run db:seed`.
    `insert into brands (org_id, slug, name, website, plan, status)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (org_id, slug) do update set name = excluded.name, website = excluded.website
     returning id`,
    [orgId, slug, name, website, plan, status]
  );
  return row.rows[0].id;
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = ['DATABASE_URL', 'PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(
    (k) => !process.env[k]
  );
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(', ')}. Never defaults to Anomalia's own project.`);
    process.exit(1);
  }

  const gotrueUrl = `${SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
  const user = await ensureDemoUser(gotrueUrl, SERVICE_KEY, SEED_EMAIL, SEED_PASSWORD);
  console.log(user.created ? `created demo user ${SEED_EMAIL}` : `demo user ${SEED_EMAIL} already exists`);

  const { Client } = await import('pg');
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const orgId = await ensureOrg(client, user.id, SEED_ORG_NAME);
    const brandId = await ensureBrand(client, orgId, SEED_BRAND_SLUG, SEED_BRAND_NAME, SEED_BRAND_WEBSITE);
    console.log(`org ${orgId} / brand ${SEED_BRAND_SLUG} (${brandId}) ready.`);
    console.log(`\nLog in with ${SEED_EMAIL} / ${SEED_PASSWORD} — change SEED_DEMO_PASSWORD before sharing this instance.`);
    // A single-tenant install needs this id: it is what tells the app there is nothing to switch
    // between. Printed here because this is the only moment the id is known and someone is looking.
    console.log(`\nSingle-tenant install? Add this to your .env — it hides the brand switcher, the
brands list and the invite screens, and sends /app straight to this brand:\n`);
    console.log(`  TENANT_BRAND_ID=${brandId}\n`);
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`FAILED: ${err.message}`);
    process.exit(1);
  });
}
