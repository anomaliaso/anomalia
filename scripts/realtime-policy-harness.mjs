import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHmac } from 'node:crypto';
import { Client } from 'pg';
import { applyOne } from './db-migrate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JWT_SECRET = 'task59-jwt-secret';
const JWT_PART = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const JWT_HEADER = JWT_PART({ alg: 'HS256', typ: 'JWT' });
const JWT_PAYLOAD = JWT_PART({
  role: 'anon',
  iss: 'supabase',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600
});
const ANON_KEY = `${JWT_HEADER}.${JWT_PAYLOAD}.${createHmac('sha256', JWT_SECRET).update(`${JWT_HEADER}.${JWT_PAYLOAD}`).digest('base64url')}`;
const MIGRATION = join(ROOT, 'supabase/migrations/0226_realtime_brand_channel_policies.sql');
const REALTIME_SCHEMA = join(ROOT, 'infra/compose/volumes/db/realtime.sql');
const POLICY_INIT = join(ROOT, 'infra/compose/volumes/db/realtime-policies.sh');
const MIGRATION_NAME = '0226_realtime_brand_channel_policies.sql';
const PROJECT = `anomalia-task59-${process.pid}-${Date.now()}`;
const TEMP = mkdtempSync(join(tmpdir(), 'anomalia-task59-'));
const COMPOSE = join(TEMP, 'compose.yml');
const INIT = join(TEMP, 'init.sql');

const compose = `
services:
  db:
    image: supabase/postgres:17.6.1.136
    environment:
      POSTGRES_PASSWORD: task59-postgres
      POSTGRES_DB: postgres
      PGPORT: 5432
    volumes:
      - db-data:/var/lib/postgresql/data
      - ${INIT}:/docker-entrypoint-initdb.d/99-task59.sql:ro
      - ${REALTIME_SCHEMA}:/docker-entrypoint-initdb.d/migrations/99-realtime.sql:ro
    ports:
      - '127.0.0.1::5432'
    healthcheck:
      test: ['CMD', 'pg_isready', '-U', 'postgres', '-h', 'localhost']
      interval: 2s
      timeout: 2s
      retries: 30

  realtime:
    image: supabase/realtime:v2.102.3
    depends_on:
      db:
        condition: service_healthy
    environment:
      PORT: 4000
      DB_HOST: db
      DB_PORT: 5432
      DB_USER: supabase_admin
      DB_PASSWORD: task59-postgres
      DB_NAME: postgres
      DB_AFTER_CONNECT_QUERY: SET search_path TO _realtime
      DB_ENC_KEY: supabaserealtime
      API_JWT_SECRET: ${JWT_SECRET}
      SECRET_KEY_BASE: task59-secret-key-base-that-is-long-enough-for-realtime
      METRICS_JWT_SECRET: task59-jwt-secret
      ERL_AFLAGS: -proto_dist inet_tcp
      DNS_NODES: "''"
      RLIMIT_NOFILE: '10000'
      APP_NAME: realtime
      SEED_SELF_HOST: 'true'
      RUN_JANITOR: 'true'
      DISABLE_HEALTHCHECK_LOGGING: 'true'
    healthcheck:
      test:
        [
          'CMD-SHELL',
          'curl -sSfL --head -o /dev/null -H "Authorization: Bearer ${ANON_KEY}" http://localhost:4000/api/tenants/realtime-dev/health'
        ]
      interval: 2s
      timeout: 2s
      retries: 30
      start_period: 5s

  realtime-policies:
    image: supabase/postgres:17.6.1.136
    depends_on:
      realtime:
        condition: service_healthy
    environment:
      PGHOST: db
      PGPORT: 5432
      PGUSER: postgres
      PGPASSWORD: task59-postgres
      PGDATABASE: postgres
    volumes:
      - ${MIGRATION}:/0226_realtime_brand_channel_policies.sql:ro
      - ${POLICY_INIT}:/realtime-policies.sh:ro
    entrypoint: ['/bin/sh', '/realtime-policies.sh']

volumes:
  db-data:
`;

const init = `
create schema if not exists _realtime;
grant usage, create on schema _realtime to public;
create schema if not exists realtime;

create or replace function public.auth_brand_ids()
returns setof uuid
language sql
stable
as $$
  select null::uuid where false;
$$;
`;

writeFileSync(COMPOSE, compose);
writeFileSync(INIT, init);

function composeRun(args, allowFailure = false) {
  const result = spawnSync(
    'docker',
    ['compose', '--project-name', PROJECT, '--file', COMPOSE, ...args],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${args.join(' ')}\n${result.stdout}${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function sql(query) {
  return composeRun([
    'exec',
    '-T',
    'db',
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '--no-psqlrc',
    '--set',
    'ON_ERROR_STOP=on',
    '--tuples-only',
    '--no-align',
    '--command',
    query
  ]).trim();
}

function expect(value, expected, label) {
  if (value !== expected) throw new Error(`${label}: expected ${expected}, received ${value}`);
}

async function applyMigration(dbPort) {
  const client = new Client({
    connectionString: `postgres://postgres:task59-postgres@127.0.0.1:${dbPort}/postgres`
  });
  await client.connect();
  try {
    await client.query(
      'create table if not exists app_schema_migrations (filename text primary key, applied_at timestamptz not null default now())'
    );
    return await applyOne(client, MIGRATION_NAME);
  } finally {
    await client.end();
  }
}

try {
  composeRun(['up', '--detach', '--wait', 'db']);
  sql('grant usage, create on schema realtime to postgres');
  const dbPort = Number(composeRun(['port', 'db', '5432']).trim().split(':').pop());
  const first = await applyMigration(dbPort);
  expect(
    JSON.stringify(first),
    JSON.stringify({ status: 'deferred', prerequisite: 'realtime.messages' }),
    'clean replay result'
  );
  expect(sql("select coalesce(to_regclass('realtime.messages')::text, 'missing')"), 'missing', 'clean replay table');
  expect(
    sql("select count(*)::text from pg_policies where schemaname = 'realtime' and tablename = 'messages'"),
    '0',
    'clean replay policies'
  );
  expect(
    sql("select count(*)::text from app_schema_migrations where filename = '0226_realtime_brand_channel_policies.sql'"),
    '0',
    'clean replay migration record'
  );

  composeRun(['up', '--detach', '--wait', 'realtime']);
  composeRun(['run', '--rm', 'realtime-policies']);
  expect(sql("select coalesce(to_regclass('realtime.messages')::text, 'missing')"), 'realtime.messages', 'post-health table');
  expect(
    sql("select count(*)::text from pg_policies where schemaname = 'realtime' and tablename = 'messages'"),
    '2',
    'post-health policies'
  );
  expect(
    sql("select count(*)::text from app_schema_migrations where filename = '0226_realtime_brand_channel_policies.sql'"),
    '1',
    'post-health migration record'
  );

  composeRun(['run', '--rm', '--no-deps', 'realtime-policies']);
  expect(
    sql("select count(*)::text from pg_policies where schemaname = 'realtime' and tablename = 'messages'"),
    '2',
    'repeated hook policies'
  );
  expect(
    sql("select count(*)::text from app_schema_migrations where filename = '0226_realtime_brand_channel_policies.sql'"),
    '1',
    'repeated hook migration record'
  );

  console.log('Realtime policy lifecycle passed: clean replay, post-health init, repeated init.');
} catch (error) {
  console.error(composeRun(['logs', '--no-color', 'db', 'realtime', 'realtime-policies'], true));
  throw error;
} finally {
  composeRun(['down', '--volumes', '--remove-orphans'], true);
  rmSync(TEMP, { recursive: true, force: true });
}
