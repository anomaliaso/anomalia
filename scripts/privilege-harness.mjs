/**
 * OGNI PRIVILEGIO, PROVATO COL RUOLO VERO.
 *
 * Il gemello `constraint-harness.mjs` chiede «il CHECK morde?». Qui la domanda è un'altra: «con
 * la sessione di un cliente, cosa riesco a scrivere e cosa riesco a leggere?». Una policy, un
 * grant per colonna e il corpo di una SECURITY DEFINER non si misurano in vitest — la suite mocka
 * Supabase, un insert finto accetta qualunque cosa, e il cancello resta verde mentre è
 * scavalcabile. Qui il ruolo è vero (`set local role authenticated` con le claim del JWT), la RLS
 * si valuta, e il rifiuto è uno SQLSTATE di Postgres, non un'aspettativa.
 *
 * Le SECURITY DEFINER si provano col grant RIMESSO dentro la transazione, di proposito: la
 * domanda non è «authenticated può eseguirla?» — quella la decide un grant, e un grant torna —
 * ma «se la eseguisse, cosa otterrebbe?».
 *
 * Si guarda fallire PRIMA delle migration in `FIX_MIGRATIONS` (che l'harness applica dentro la
 * transazione se esistono) e passare dopo. Tutto gira dentro UNA transazione chiusa da un
 * ROLLBACK: non resta una riga.
 *
 *   DATABASE_URL=postgres://postgres:<pw>@127.0.0.1:5432/postgres node scripts/privilege-harness.mjs
 *   npm run test:privileges
 *
 * DATABASE_URL deve puntare a localhost: contro un database remoto lo script si rifiuta di partire.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const INSUFFICIENT_PRIVILEGE = '42501';
const RAISE_EXCEPTION = 'P0001';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const MIGRATIONS_DIR = join(fileURLToPath(new URL('..', import.meta.url)), 'supabase/migrations');
const REGISTRY_MIGRATION = '20260905210000_self_write_columns.sql';
const FIX_MIGRATIONS = [REGISTRY_MIGRATION, '20260905220000_secdef_run_and_spend_filters.sql'];

/**
 * Lo specchio del registro che vive in `REGISTRY_MIGRATION`: `insert` e `update` sono le colonne
 * che l'utente decide di sé, `system` quelle che decide il sistema. Le tre liste insieme devono
 * fare TUTTA la tabella, e `system` non può sovrapporsi alle altre due: una colonna nuova non
 * classificata rende rosso l'harness, che è il solo modo perché la domanda «e questa, chi la
 * decide?» venga posta prima e non dopo.
 */
const SELF_WRITE = {
  profiles: {
    insert: [],
    update: ['full_name', 'avatar_url', 'locale'],
    system: ['id', 'email', 'utm', 'created_at', 'approved_at']
  },
  organizations: {
    insert: ['name', 'owner_id'],
    update: [],
    system: ['id', 'stripe_customer_id', 'stripe_subscription_id', 'plan', 'activated_at', 'created_at']
  },
  brands: {
    insert: [
      'id', 'org_id', 'created_by', 'name', 'website', 'slug', 'target_platforms', 'content_prefs',
      'onboarding_completed_at'
    ],
    update: [
      'name', 'website', 'timezone', 'target_platforms', 'content_prefs', 'ads_settings',
      'chat_default_tier', 'launched_at', 'setup_step', 'setup_completed_at', 'onboarding_state',
      'onboarding_completed_at', 'own_history_at'
    ],
    system: [
      'status', 'plan', 'stripe_subscription_id', 'stripe_customer_id', 'trial_ends_at',
      'zernio_profile_id', 'paused_at', 'created_at', 'activated_at', 'autopilot_enabled',
      'last_autopilot_run_at', 'autopilot_failure_count', 'onboarding_status', 'blog_slug',
      'blog_config', 'last_rank_check_at', 'last_crawl_at', 'last_review_at', 'last_visual_at',
      'last_digest_sent_at'
    ]
  }
};

const GUARDED_FUNCTIONS = [
  'brand_provider_spend_usd',
  'agent_kit_claim_run',
  'agent_kit_close_run',
  'agent_kit_wait_for_approval'
];

const RESTORED_GRANTS = [
  'public.brand_provider_spend_usd(uuid, text, timestamptz)',
  'public.agent_kit_claim_run(uuid, text, timestamptz, timestamptz)',
  'public.agent_kit_close_run(uuid, text, text, bigint, text, jsonb, jsonb)',
  'public.agent_kit_wait_for_approval(uuid, text, text, text, jsonb, text, text, jsonb, jsonb)'
];

const OWNER = '11111111-1111-4111-8111-111111111111';
const OUTSIDER = '22222222-2222-4222-8222-222222222222';
const SPENT_USD = 7.25;
const LEASE_OWNER = 'worker-legittimo';

function localOnly(url) {
  const { hostname } = new URL(url);

  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`DATABASE_URL punta a ${hostname}: questo harness scrive, e scrive solo in locale`);
  }
}

async function attempt(client, sql, params = []) {
  await client.query('savepoint probe');

  try {
    const { rowCount, rows } = await client.query(sql, params);
    await client.query('release savepoint probe');

    return { accepted: true, rowCount, rows };
  } catch (error) {
    await client.query('rollback to savepoint probe');
    await client.query('release savepoint probe');

    return { accepted: false, code: error.code, message: error.message };
  }
}

async function becomes(client, role, uid) {
  await client.query(`set local role ${role}`);
  await client.query('select set_config($1, $2, true)', [
    'request.jwt.claims',
    JSON.stringify({ sub: uid, role })
  ]);
}

async function becomesOwner(client) {
  await client.query('set local role none');
  await client.query('select set_config($1, $2, true)', ['request.jwt.claims', '']);
}

async function scalar(client, sql, params = []) {
  const { rows } = await client.query(sql, params);

  return rows[0] ? Object.values(rows[0])[0] : null;
}

async function applyFixes(client) {
  for (const file of FIX_MIGRATIONS) {
    const path = join(MIGRATIONS_DIR, file);

    if (!existsSync(path)) {
      console.log(`(assente, si misura lo schema com'è) ${file}`);
      continue;
    }

    await client.query(readFileSync(path, 'utf8'));
    console.log(`(applicata nella transazione)          ${file}`);
  }
}

async function seed(client) {
  await client.query(
    `insert into auth.users (id, email) values ($1, 'owner@harness.test'), ($2, 'outsider@harness.test')`,
    [OWNER, OUTSIDER]
  );

  const orgId = await scalar(
    client,
    `insert into public.organizations (name, owner_id) values ('Harness Org', $1) returning id`,
    [OWNER]
  );
  const brandId = await scalar(
    client,
    `insert into public.brands (org_id, name, slug) values ($1, 'Harness Brand', 'harness-brand') returning id`,
    [orgId]
  );

  await client.query(
    `insert into public.ai_calls (brand_id, label, provider, ms, ok, cost_usd)
     values ($1, 'harness', 'dataforseo', 1, true, $2)`,
    [brandId, SPENT_USD]
  );

  const threadId = await scalar(
    client,
    `insert into public.chat_threads (brand_id, user_id) values ($1, $2) returning id`,
    [brandId, OWNER]
  );
  const runId = await scalar(
    client,
    `insert into public.agent_kit_runs (brand_id, thread_id, agent_id, user_id, state)
     values ($1, $2, 'auto', $3, 'queued') returning id`,
    [brandId, threadId, OWNER]
  );

  return { orgId, brandId, runId };
}

async function billingFacts(client, orgId, brandId) {
  const facts = [];

  await becomes(client, 'authenticated', OWNER);

  const upgrade = await attempt(client, `update public.organizations set plan = 'pro' where id = $1`, [orgId]);
  facts.push({
    what: "authenticated non si regala il piano dell'organizzazione",
    ok: upgrade.code === INSUFFICIENT_PRIVILEGE,
    got: upgrade.accepted ? `accettato, righe ${upgrade.rowCount}` : upgrade.code
  });

  const subscription = await attempt(
    client,
    `update public.organizations set stripe_subscription_id = 'sub_finto', activated_at = now() where id = $1`,
    [orgId]
  );
  facts.push({
    what: 'authenticated non si inventa un abbonamento Stripe',
    ok: subscription.code === INSUFFICIENT_PRIVILEGE,
    got: subscription.accepted ? 'accettato' : subscription.code
  });

  const activate = await attempt(
    client,
    `update public.brands set plan = 'pro', status = 'active' where id = $1`,
    [brandId]
  );
  facts.push({
    what: 'authenticated non attiva il brand da sé',
    ok: activate.code === INSUFFICIENT_PRIVILEGE,
    got: activate.accepted ? 'accettato' : activate.code
  });

  const bornPro = await attempt(
    client,
    `insert into public.brands (org_id, name, slug, plan) values ($1, 'Furbo', 'furbo', 'pro')`,
    [orgId]
  );
  facts.push({
    what: 'authenticated non fa nascere un brand già pro',
    ok: bornPro.code === INSUFFICIENT_PRIVILEGE,
    got: bornPro.accepted ? 'accettato' : bornPro.code
  });

  const orgBornPro = await attempt(
    client,
    `insert into public.organizations (name, owner_id, plan) values ('Furba', $1, 'pro')`,
    [OWNER]
  );
  facts.push({
    what: "authenticated non fa nascere un'organizzazione già pro",
    ok: orgBornPro.code === INSUFFICIENT_PRIVILEGE,
    got: orgBornPro.accepted ? 'accettato' : orgBornPro.code
  });

  await becomesOwner(client);

  const plan = await scalar(client, 'select plan from public.organizations where id = $1', [orgId]);
  facts.push({ what: "il piano dell'organizzazione è ancora quello di prima", ok: plan === null, got: plan });

  return facts;
}

async function profileFacts(client) {
  const facts = [];

  facts.push({
    what: 'il trigger di signup crea il profilo',
    ok: (await scalar(client, 'select count(*)::int from public.profiles where id = $1', [OWNER])) === 1
  });

  await becomes(client, 'authenticated', OWNER);

  const selfApprove = await attempt(client, 'update public.profiles set approved_at = now() where id = $1', [OWNER]);
  facts.push({
    what: 'authenticated non si scrive approved_at addosso',
    ok: selfApprove.code === INSUFFICIENT_PRIVILEGE,
    got: selfApprove.accepted ? `accettato, righe ${selfApprove.rowCount}` : selfApprove.code
  });

  const rewriteEmail = await attempt(
    client,
    `update public.profiles set email = 'chiunque@altrove.test' where id = $1`,
    [OWNER]
  );
  facts.push({
    what: 'authenticated non riscrive la propria email',
    ok: rewriteEmail.code === INSUFFICIENT_PRIVILEGE,
    got: rewriteEmail.accepted ? 'accettato' : rewriteEmail.code
  });

  const ownFields = await attempt(
    client,
    `update public.profiles set full_name = 'Nome Cognome', locale = 'it', avatar_url = 'https://x/y.png'
     where id = $1`,
    [OWNER]
  );
  facts.push({
    what: 'authenticated cambia nome, lingua e avatar come prima',
    ok: ownFields.accepted && ownFields.rowCount === 1,
    got: ownFields.accepted ? `righe ${ownFields.rowCount}` : ownFields.code
  });

  const approved = await scalar(client, 'select public.is_approved()');
  facts.push({ what: 'is_approved() resta falso dopo il tentativo', ok: approved === false, got: approved });

  await becomesOwner(client);

  return facts;
}

async function columnsOf(client, table) {
  const { rows } = await client.query(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`,
    [table]
  );

  return rows.map((r) => r.column_name);
}

async function grantedTo(client, table, privilege) {
  const { rows } = await client.query(
    `select column_name from information_schema.column_privileges
     where table_schema = 'public' and table_name = $1 and grantee = 'authenticated' and privilege_type = $2`,
    [table, privilege]
  );

  return rows.map((r) => r.column_name);
}

function missing(expected, actual) {
  const seen = new Set(actual);

  return expected.filter((x) => !seen.has(x));
}

async function registryFacts(client) {
  const facts = [];

  for (const [table, registry] of Object.entries(SELF_WRITE)) {
    const userDecides = [...new Set([...registry.insert, ...registry.update])];
    const real = await columnsOf(client, table);
    const unclassified = missing(real, [...userDecides, ...registry.system]);
    const bothWays = registry.system.filter((c) => userDecides.includes(c));

    facts.push({
      what: `${table}: ogni colonna è classificata in ${REGISTRY_MIGRATION}`,
      ok: unclassified.length === 0 && bothWays.length === 0,
      got: unclassified.length
        ? `non classificate: ${unclassified.join(', ')}`
        : bothWays.length
          ? `classificate due volte: ${bothWays.join(', ')}`
          : `${real.length} colonne`
    });

    for (const [privilege, expected] of [
      ['UPDATE', registry.update],
      ['INSERT', registry.insert]
    ]) {
      const granted = await grantedTo(client, table, privilege);
      facts.push({
        what: `${table}: authenticated ${privilege === 'UPDATE' ? 'aggiorna' : 'inserisce'} solo ciò che decide di sé`,
        ok: missing(granted, expected).length === 0 && missing(expected, granted).length === 0,
        got: granted.sort().join(', ') || 'niente'
      });
    }
  }

  return facts;
}

async function grantFacts(client) {
  const open = await scalar(
    client,
    `select count(*)::int
     from pg_proc p, unnest(array['anon', 'authenticated']) as r(rolname)
     where p.pronamespace = 'public'::regnamespace
       and p.proname = any($1)
       and has_function_privilege(r.rolname, p.oid, 'execute')`,
    [GUARDED_FUNCTIONS]
  );

  return [
    {
      what: 'nessuna delle quattro è eseguibile da anon o authenticated',
      ok: open === 0,
      got: `${open} combinazioni aperte`
    }
  ];
}

async function spendFacts(client, brandId) {
  const leaked = await attempt(
    client,
    `select public.brand_provider_spend_usd($1, 'dataforseo', now() - interval '1 day') as usd`,
    [brandId]
  );
  const leakedUsd = leaked.accepted ? Number(leaked.rows[0].usd) : null;

  await becomesOwner(client);
  await becomes(client, 'service_role', OWNER);
  const real = Number(await scalar(client, `select public.brand_provider_spend_usd($1, 'dataforseo', now() - interval '1 day')`, [brandId]));
  await becomesOwner(client);

  return [
    {
      what: 'la spesa per fornitore di un brand altrui non esce',
      ok: leakedUsd === 0,
      got: leaked.accepted ? `$${leakedUsd}` : leaked.code
    },
    { what: 'il service role legge ancora la spesa vera', ok: real === SPENT_USD, got: `$${real}` }
  ];
}

async function runState(client, runId) {
  return scalar(client, 'select state from public.agent_kit_runs where id = $1', [runId]);
}

async function fence(client, runId) {
  return scalar(client, 'select lease_fence from public.agent_kit_runs where id = $1', [runId]);
}

async function runFacts(client, runId) {
  const facts = [];

  const stolenClaim = await attempt(
    client,
    `select public.agent_kit_claim_run($1, 'ladro', now(), now() + interval '5 minutes')`,
    [runId]
  );
  await becomesOwner(client);
  facts.push({
    what: 'authenticated non prende il run di un altro tenant',
    ok: stolenClaim.code === RAISE_EXCEPTION && (await runState(client, runId)) === 'queued',
    got: stolenClaim.accepted ? `preso, stato ${await runState(client, runId)}` : stolenClaim.code
  });

  await becomes(client, 'service_role', OWNER);
  const claimed = await attempt(
    client,
    `select public.agent_kit_claim_run($1, $2, now(), now() + interval '5 minutes')`,
    [runId, LEASE_OWNER]
  );
  await becomesOwner(client);
  facts.push({
    what: 'il service role prende il run come prima',
    ok: claimed.accepted && (await runState(client, runId)) === 'running',
    got: claimed.accepted ? await runState(client, runId) : claimed.code
  });

  const held = await fence(client, runId);

  await becomes(client, 'authenticated', OUTSIDER);
  const stolenClose = await attempt(
    client,
    `select public.agent_kit_close_run($1, 'aborted', $2, $3, 'rubato', null, null)`,
    [runId, LEASE_OWNER, held]
  );
  const stolenWait = await attempt(
    client,
    `select public.agent_kit_wait_for_approval($1, 'a1', 't1', 'tool', '{}'::jsonb, 'h1', 'perché', '{}'::jsonb, null)`,
    [runId]
  );
  await becomesOwner(client);
  facts.push({
    what: 'authenticated non chiude il run di un altro tenant',
    ok: stolenClose.code === RAISE_EXCEPTION && (await runState(client, runId)) === 'running',
    got: stolenClose.accepted ? `chiuso, stato ${await runState(client, runId)}` : stolenClose.code
  });
  facts.push({
    what: 'authenticated non mette il run di un altro in attesa di approvazione',
    ok:
      stolenWait.code === RAISE_EXCEPTION &&
      stolenWait.message.startsWith('agent_kit_wait_for_approval:') &&
      (await scalar(client, 'select count(*)::int from public.agent_kit_approval_requests')) === 0,
    got: stolenWait.accepted ? `stato ${await runState(client, runId)}` : stolenWait.message
  });

  await becomes(client, 'service_role', OWNER);
  const waited = await attempt(
    client,
    `select public.agent_kit_wait_for_approval($1, 'a1', 't1', 'tool', '{}'::jsonb, 'h1', 'perché', '{}'::jsonb, null)`,
    [runId]
  );
  await becomesOwner(client);
  facts.push({
    what: 'il service role mette il run in attesa come prima',
    ok: waited.accepted && (await runState(client, runId)) === 'waiting_takeover',
    got: waited.accepted ? await runState(client, runId) : waited.code
  });

  await becomes(client, 'service_role', OWNER);
  await client.query(`select public.agent_kit_claim_run($1, $2, now(), now() + interval '5 minutes')`, [runId, LEASE_OWNER]);
  const closed = await attempt(
    client,
    `select public.agent_kit_close_run($1, 'done', $2, $3, 'completed', null, null) as out`,
    [runId, LEASE_OWNER, await fence(client, runId)]
  );
  await becomesOwner(client);
  facts.push({
    what: 'il service role chiude il run come prima',
    ok: closed.accepted && closed.rows[0].out.closed === true && (await runState(client, runId)) === 'done',
    got: closed.accepted ? JSON.stringify(closed.rows[0].out) : closed.code
  });

  return facts;
}

async function main() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('DATABASE_URL mancante');
    process.exit(2);
  }

  localOnly(url);

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('begin');

  let facts = [];

  try {
    await applyFixes(client);

    const { orgId, brandId, runId } = await seed(client);

    facts = facts.concat(await profileFacts(client));
    facts = facts.concat(await billingFacts(client, orgId, brandId));
    facts = facts.concat(await registryFacts(client));
    facts = facts.concat(await grantFacts(client));

    for (const signature of RESTORED_GRANTS) {
      await client.query(`grant execute on function ${signature} to authenticated`);
    }

    await becomes(client, 'authenticated', OUTSIDER);
    facts = facts.concat(await spendFacts(client, brandId));

    await becomes(client, 'authenticated', OUTSIDER);
    facts = facts.concat(await runFacts(client, runId));
  } finally {
    await client.query('rollback');
    await client.end();
  }

  console.log('');
  for (const fact of facts) {
    console.log(`${fact.ok ? 'ok  ' : 'FAIL'}  ${fact.what}  (${fact.got ?? 'sì'})`);
  }

  const failed = facts.filter((f) => !f.ok).length;
  console.log(`\n${facts.length - failed}/${facts.length} privilegi tengono`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(2);
});
