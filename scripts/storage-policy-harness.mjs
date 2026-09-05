/**
 * Storage policy harness: replays, against a REAL Postgres and a REAL storage-api, the moves a red
 * team actually landed on production.
 *
 * The unit suite mocks Supabase, so a storage insert there accepts anything — it cannot see an RLS
 * predicate, a bucket's mime allowlist or a size limit, because none of those live in our code.
 * They live in the database and in supabase/storage-api, so the only test that can fail for the
 * right reason is one that talks to both. Same shape as scripts/realtime-policy-harness.mjs: a
 * throwaway compose stack, assertions, and a teardown that runs even when an assertion throws.
 *
 * The DB assertions run inside a transaction closed by `rollback`; the HTTP ones cannot, so the
 * stack is destroyed with its volumes at the end instead.
 *
 *   npm run test:storage-policies
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHmac, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { listMigrationFiles, applyOne } from './db-migrate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JWT_SECRET = 'storage-policy-harness-jwt-secret-at-least-32-chars';
const POSTGRES_PASSWORD = 'storage-policy-harness';
const PROJECT = `anomalia-storage-policies-${process.pid}-${Date.now()}`;
const TEMP = mkdtempSync(join(tmpdir(), 'anomalia-storage-policies-'));
const COMPOSE = join(TEMP, 'compose.yml');
const ROLES = join(ROOT, 'infra/compose/volumes/db/roles.sql');
const JWT = join(ROOT, 'infra/compose/volumes/db/jwt.sql');
const ADMIN_PASSWORD = join(TEMP, 'supabase-admin-password.sql');

// 20260827130000_selfhost_schema_parity.sql does `set role supabase_admin`, and the image leaves
// that role without a password — so the migrator cannot log in as it. roles.sql is vendored
// verbatim from upstream and must not be edited; this is the one extra line, kept next to it.
writeFileSync(
  ADMIN_PASSWORD,
  "\\set pgpass `echo \"$POSTGRES_PASSWORD\"`\nALTER USER supabase_admin WITH PASSWORD :'pgpass';\n"
);

const HOUR = 3600;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function mintJwt(claims) {
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    iss: 'supabase',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + HOUR,
    ...claims
  });
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const ANON_KEY = mintJwt({ role: 'anon' });
const SERVICE_KEY = mintJwt({ role: 'service_role' });

const compose = `
services:
  db:
    image: supabase/postgres:17.6.1.136
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: postgres
      PGPORT: 5432
      JWT_SECRET: ${JWT_SECRET}
      JWT_EXP: ${HOUR}
    volumes:
      - ${ROLES}:/docker-entrypoint-initdb.d/init-scripts/99-roles.sql:ro
      - ${JWT}:/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql:ro
      - ${ADMIN_PASSWORD}:/docker-entrypoint-initdb.d/init-scripts/99-zz-harness.sql:ro
      - db-data:/var/lib/postgresql/data
    ports:
      - '127.0.0.1::5432'
    healthcheck:
      test: ['CMD', 'pg_isready', '-U', 'postgres', '-h', 'localhost']
      interval: 2s
      timeout: 2s
      retries: 40

  auth:
    image: supabase/gotrue:v2.189.0
    depends_on:
      db:
        condition: service_healthy
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      GOTRUE_API_PORT: 9999
      API_EXTERNAL_URL: http://localhost:9999
      GOTRUE_DB_DRIVER: postgres
      GOTRUE_DB_DATABASE_URL: postgres://supabase_auth_admin:${POSTGRES_PASSWORD}@db:5432/postgres?search_path=auth
      GOTRUE_SITE_URL: http://localhost:5173
      GOTRUE_JWT_ADMIN_ROLES: service_role
      GOTRUE_JWT_AUD: authenticated
      GOTRUE_JWT_DEFAULT_GROUP_NAME: authenticated
      GOTRUE_JWT_EXP: ${HOUR}
      GOTRUE_JWT_SECRET: ${JWT_SECRET}
      GOTRUE_MAILER_AUTOCONFIRM: 'true'

  rest:
    image: postgrest/postgrest:v14.12
    depends_on:
      db:
        condition: service_healthy
    environment:
      PGRST_DB_URI: postgres://authenticator:${POSTGRES_PASSWORD}@db:5432/postgres
      PGRST_DB_SCHEMAS: public,storage
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: ${JWT_SECRET}
      PGRST_DB_USE_LEGACY_GUCS: 'false'

  storage:
    image: supabase/storage-api:v1.60.4
    depends_on:
      db:
        condition: service_healthy
      rest:
        condition: service_started
    environment:
      ANON_KEY: ${ANON_KEY}
      SERVICE_KEY: ${SERVICE_KEY}
      POSTGREST_URL: http://rest:3000
      AUTH_JWT_SECRET: ${JWT_SECRET}
      DATABASE_URL: postgres://supabase_storage_admin:${POSTGRES_PASSWORD}@db:5432/postgres
      STORAGE_PUBLIC_URL: http://localhost:5000
      FILE_SIZE_LIMIT: 524288000
      STORAGE_BACKEND: file
      GLOBAL_S3_BUCKET: stub
      FILE_STORAGE_BACKEND_PATH: /var/lib/storage
      TENANT_ID: stub
      REGION: stub
      ENABLE_IMAGE_TRANSFORMATION: 'false'
    ports:
      - '127.0.0.1::5000'

volumes:
  db-data:
`;

writeFileSync(COMPOSE, compose);

function composeRun(args, allowFailure = false) {
  const result = spawnSync(
    'docker',
    ['compose', '--project-name', PROJECT, '--file', COMPOSE, ...args],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${args.join(' ')}\n${result.stdout}${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

/** The image has no wget, so a compose healthcheck cannot see /status — poll it from here. */
async function waitForStatus(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${url}/status`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`storage-api never answered ${url}/status`);
}

// storage-api's own words for the two refusals that matter, pinned so an unrelated 400 (a missing
// bucket, a duplicate key) can never be mistaken for a policy doing its job.
const DENIED = '400 Unauthorized';
const BAD_MIME = '400 invalid_mime_type';

const failures = [];

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures.push(`${label}: expected ${expected}, received ${actual}`);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` (expected ${expected}, got ${actual})`}`);
}

/** A user client is the anon key plus the user's JWT — exactly what the browser and hooks.server.ts
 *  send. The outcome is the status plus storage-api's own error name: a bare 400 would let "refused
 *  because the policy said no" and "refused because the bucket does not exist" look identical, and
 *  a test that cannot tell those apart passes for the wrong reason. */
async function upload(storageUrl, bucket, path, jwt, { contentType = 'image/png', bytes = 8 } = {}) {
  const res = await fetch(`${storageUrl}/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jwt}`,
      apikey: ANON_KEY,
      'content-type': contentType,
      'x-upsert': 'false'
    },
    body: Buffer.alloc(bytes, 1)
  });
  if (res.ok) return 'ok';
  const body = await res.json().catch(() => ({}));
  return `${res.status} ${body.error ?? body.message ?? 'unknown'}`;
}

const MIGRATION_UNDER_TEST = '20260905140000_storage_tenant_isolation.sql';
const SKIP_FIX = process.argv.includes('--skip-fix');

/** What the dashboard put on production by hand, and no migration ever wrote down. Reproducing it
 *  is the whole point: without it this harness measures a database production has never run, and
 *  every check below would pass while the real hole stayed open.
 *
 *  It runs BEFORE the migrations, because that is the order production has: the hand-made objects
 *  were already there when the later migrations landed, and one of them
 *  (20260905120000_secdef_least_privilege.sql) revokes on `rls_auto_enable` — a function its own
 *  comment says "vive solo in produzione". Without it here, that migration cannot apply to a fresh
 *  database at all. Copied verbatim from production, event trigger included. */
async function applyProductionDrift(client) {
  await client.query(`
    create or replace function public.rls_auto_enable() returns event_trigger
      language plpgsql security definer set search_path to 'pg_catalog' as $fn$
      declare cmd record;
      begin
        for cmd in
          select * from pg_event_trigger_ddl_commands()
          where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
            and object_type in ('table', 'partitioned table')
        loop
          if cmd.schema_name = 'public' then
            begin
              execute format('alter table if exists %s enable row level security', cmd.object_identity);
            exception when others then null;
            end;
          end if;
        end loop;
      end; $fn$;

    drop event trigger if exists ensure_rls;
    create event trigger ensure_rls on ddl_command_end execute function public.rls_auto_enable();

    create policy "Allow authenticated uploads to media bucket" on storage.objects
      for insert to authenticated with check (bucket_id = 'media');

    insert into storage.buckets (id, name, public)
      values ('email-assets', 'email-assets', true) on conflict (id) do nothing;

    create policy "email_assets_public_read" on storage.objects
      for select to anon, authenticated using (bucket_id = 'email-assets');
    create policy "email_assets_service_upload" on storage.objects
      for insert to service_role with check (bucket_id = 'email-assets');
  `);
}

/** Production is "every migration, then the drift, then whatever Andrea applies next" — so the
 *  migration under test is applied last, after the drift, exactly as it will be applied for real. */
async function applyMigrations(dbPort) {
  const client = new Client({
    connectionString: `postgres://supabase_admin:${POSTGRES_PASSWORD}@127.0.0.1:${dbPort}/postgres`
  });
  await client.connect();
  try {
    await client.query(
      'create table if not exists app_schema_migrations (filename text primary key, applied_at timestamptz not null default now())'
    );
    const files = listMigrationFiles();
    if (!files.includes(MIGRATION_UNDER_TEST)) {
      throw new Error(`${MIGRATION_UNDER_TEST} is not in supabase/migrations`);
    }
    await applyProductionDrift(client);
    for (const file of files.filter((f) => f !== MIGRATION_UNDER_TEST)) {
      await applyOne(client, file);
    }
    if (!SKIP_FIX) await applyOne(client, MIGRATION_UNDER_TEST);
  } finally {
    await client.end();
  }
}

/** Two tenants that share nothing: the shape the red team used — a self-registered account against
 *  a stranger's folder. `member` is in owner's org, `outsider` is in its own. */
const OWNER = randomUUID();
const OUTSIDER = randomUUID();
const OWNER_ORG = randomUUID();
const OWNER_BRAND = randomUUID();
const OUTSIDER_ORG = randomUUID();

async function seed(client) {
  const user = (id, email) => client.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())`,
    [id, email]
  );
  await user(OWNER, 'owner@harness.test');
  await user(OUTSIDER, 'outsider@harness.test');

  await client.query(
    `insert into public.organizations (id, name, owner_id) values ($1, 'Owner Org', $2), ($3, 'Outsider Org', $4)`,
    [OWNER_ORG, OWNER, OUTSIDER_ORG, OUTSIDER]
  );
  // Both memberships, because the schema asks the question two ways: auth_brand_ids() (the media
  // policy) goes through organizations.owner_id, the blog taxonomy's owner policy goes through
  // org_members. Seeding only one makes a check pass for a reason that has nothing to do with it.
  await client.query(
    `insert into public.org_members (org_id, user_id, role) values ($1, $2, 'owner'), ($3, $4, 'owner')`,
    [OWNER_ORG, OWNER, OUTSIDER_ORG, OUTSIDER]
  );
  await client.query(
    `insert into public.brands (id, org_id, slug, name) values ($1, $2, 'harness-brand', 'Harness Brand')`,
    [OWNER_BRAND, OWNER_ORG]
  );
}

/** The blog taxonomy leak, asserted where it lives: as the `anon` role, inside a rollback. */
async function anonSeesTaxonomy(client) {
  await client.query('begin');
  try {
    await client.query(
      `insert into public.blog_categories (brand_id, name, slug) values ($1, 'Secret Section', 'secret')`,
      [OWNER_BRAND]
    );
    await client.query(
      `insert into public.blog_tags (brand_id, name, slug) values ($1, 'Secret Tag', 'secret')`,
      [OWNER_BRAND]
    );
    await client.query(
      `insert into public.blog_authors (brand_id, name, slug) values ($1, 'Secret Author', 'secret')`,
      [OWNER_BRAND]
    );
    await client.query(`set local role anon`);
    // Two outcomes count as closed: no rows (the policy is gone) or no privilege at all (the grant
    // is gone too). The second is the stronger one, so it is what this asserts.
    const rows = await client.query(
      `select (select count(*) from public.blog_categories)
            + (select count(*) from public.blog_tags)
            + (select count(*) from public.blog_authors) as n`
    ).catch((err) => (err.code === '42501' ? null : Promise.reject(err)));
    return rows === null ? 'denied' : Number(rows.rows[0].n);
  } finally {
    await client.query('rollback');
  }
}

/** A member of the brand's org still has to be able to manage its own taxonomy. */
async function memberSeesTaxonomy(client) {
  await client.query('begin');
  try {
    await client.query(
      `insert into public.blog_categories (brand_id, name, slug) values ($1, 'Own Section', 'own')`,
      [OWNER_BRAND]
    );
    await client.query(`set local role authenticated`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: OWNER, role: 'authenticated' })
    ]);
    const rows = await client.query(`select count(*) as n from public.blog_categories`);
    return Number(rows.rows[0].n);
  } finally {
    await client.query('rollback');
  }
}

async function bucketRow(client, id) {
  const { rows } = await client.query(
    `select file_size_limit, allowed_mime_types from storage.buckets where id = $1`,
    [id]
  );
  return { exists: rows.length === 1, ...rows[0] };
}

try {
  console.log('booting db …');
  composeRun(['up', '--detach', '--wait', 'db']);
  const dbPort = Number(composeRun(['port', 'db', '5432']).trim().split(':').pop());

  // storage-api owns storage.objects / storage.buckets / storage.foldername — the supabase/postgres
  // image does NOT ship them, so it has to run its own migrations before ours can reference them.
  // GoTrue owns the auth schema the migrations lean on (0001 calls auth.jwt() on line 66).
  console.log('booting gotrue (owns the auth schema) …');
  composeRun(['up', '--detach', 'auth']);

  console.log('booting storage-api (creates the storage schema) …');
  composeRun(['up', '--detach', 'storage']);
  const storageUrl = `http://127.0.0.1:${composeRun(['port', 'storage', '5000']).trim().split(':').pop()}`;
  await waitForStatus(storageUrl);

  console.log('applying every migration …');
  await applyMigrations(dbPort);

  const client = new Client({
    connectionString: `postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${dbPort}/postgres`
  });
  await client.connect();

  try {
    await seed(client);

    const ownerJwt = mintJwt({ sub: OWNER, role: 'authenticated', aud: 'authenticated' });
    const outsiderJwt = mintJwt({ sub: OUTSIDER, role: 'authenticated', aud: 'authenticated' });

    console.log('\nmedia bucket — who may write where');
    check(
      'owner writes its own folder',
      await upload(storageUrl, 'media', `${OWNER}/uploads/${randomUUID()}.png`, ownerJwt),
      'ok'
    );
    check(
      "outsider writes into the owner's folder",
      await upload(storageUrl, 'media', `${OWNER}/uploads/${randomUUID()}.png`, outsiderJwt),
      DENIED
    );
    check(
      'brand member writes the brand folder (motion video)',
      await upload(storageUrl, 'media', `${OWNER_BRAND}/motion/${randomUUID()}.mp4`, ownerJwt, {
        contentType: 'video/mp4'
      }),
      'ok'
    );
    check(
      "outsider writes the brand's folder",
      await upload(storageUrl, 'media', `${OWNER_BRAND}/motion/${randomUUID()}.mp4`, outsiderJwt, {
        contentType: 'video/mp4'
      }),
      DENIED
    );
    check(
      'outsider writes the bucket root',
      await upload(storageUrl, 'media', `${randomUUID()}.png`, outsiderJwt),
      DENIED
    );

    console.log('\npublic buckets — what may be served back');
    check(
      'svg into media',
      await upload(storageUrl, 'media', `${OWNER}/uploads/${randomUUID()}.svg`, ownerJwt, {
        contentType: 'image/svg+xml'
      }),
      BAD_MIME
    );
    check(
      'svg into email-assets (service role, the weekly-recap scraper)',
      await upload(storageUrl, 'email-assets', `trends/${randomUUID()}.jpg`, SERVICE_KEY, {
        contentType: 'image/svg+xml'
      }),
      BAD_MIME
    );
    // Storage matches the allowlist on the WHOLE header, parameters included: `image/png` in the
    // list does not admit `image/png;charset=UTF-8`. Production holds one such object, scraped from
    // a remote site — which is why weekly-recap.ts now names the type itself instead of forwarding
    // whatever the remote server said. Pinned here so nobody "fixes" the list by adding variants.
    check(
      'a content-type carrying a charset parameter is refused, so the scraper must name its own',
      await upload(storageUrl, 'email-assets', `trends/${randomUUID()}.png`, SERVICE_KEY, {
        contentType: 'image/png;charset=UTF-8'
      }),
      BAD_MIME
    );
    check(
      'the canonical type weekly-recap now sends does land',
      await upload(storageUrl, 'email-assets', `trends/${randomUUID()}.png`, SERVICE_KEY, {
        contentType: 'image/png'
      }),
      'ok'
    );
    check(
      'mp4 into media stays allowed',
      await upload(storageUrl, 'media', `${OWNER}/generated/${randomUUID()}.mp4`, ownerJwt, {
        contentType: 'video/mp4'
      }),
      'ok'
    );
    check(
      'wav into media stays allowed',
      await upload(storageUrl, 'media', `${OWNER_BRAND}/voiceover/${randomUUID()}.wav`, ownerJwt, {
        contentType: 'audio/wav'
      }),
      'ok'
    );

    console.log('\nbucket limits');
    const media = await bucketRow(client, 'media');
    const emailAssets = await bucketRow(client, 'email-assets');
    // `bucketRow` returns {} for a bucket that does not exist, and `undefined > n` is false rather
    // than an error — so the row has to be proved present before any comparison means anything.
    check('the media bucket row exists', media.exists, true);
    check('the email-assets bucket row exists', emailAssets.exists, true);
    check(
      'media size limit is set and clears the largest object in production (44 MB)',
      Number(media.file_size_limit) > 46_390_775,
      true
    );
    check(
      'email-assets size limit is set and clears the scraper cap (2 MB)',
      Number(emailAssets.file_size_limit) > 2_000_000,
      true
    );

    console.log('\nblog taxonomy — the tenant enumeration primitive');
    check('an anonymous visitor reading the taxonomy', await anonSeesTaxonomy(client), 'denied');
    check('rows the brand owner can still read', await memberSeesTaxonomy(client), 1);
  } finally {
    await client.end();
  }

  if (failures.length) {
    throw new Error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  }
  console.log('\nStorage policies hold: cross-tenant writes refused, svg refused, taxonomy closed.');
} catch (error) {
  console.error(composeRun(['logs', '--no-color', '--tail', '80', 'db', 'storage'], true));
  throw error;
} finally {
  composeRun(['down', '--volumes', '--remove-orphans'], true);
  rmSync(TEMP, { recursive: true, force: true });
}
