/**
 * Self-host migration applier.
 *
 * Applies `supabase/migrations/*.sql` in order against DATABASE_URL, tracking what already ran
 * in a `app_schema_migrations` table (filename + applied_at). Idempotent: re-running only applies
 * new files. Each file runs inside its own transaction — a failure rolls back that one file and
 * stops before touching the next, naming the file and (when Postgres reports a character
 * position) the line inside it.
 *
 * DATABASE_URL is required and NEVER defaults to Anomalia's own database — this script is meant
 * to run against a self-hoster's own Postgres.
 *
 *   DATABASE_URL=postgres://... node --env-file-if-exists=.env scripts/db-migrate.mjs
 *   npm run db:migrate
 *
 * ponytail: no ORM, no query builder — the migrations are already plain .sql files, `pg`'s simple
 * query protocol runs a whole file (multiple ';'-separated statements) in one `client.query(sql)`
 * call, so there is nothing to parse here beyond "which files, in what order". The DB I/O (connect
 * /query/end) is the only part that touches `pg`; everything else is plain functions so the ordering
 * and error-location logic can be tested with a fake client instead of a real Postgres.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const MIGRATIONS_DIR = join(ROOT, 'supabase/migrations');

/** Every migration file, ordered by its leading number (0007 → 7, 20260702… → 20260702).
 *  Il repo mescola prefissi corti e timestamp: il sort lessicale mette «0089_x» DOPO
 *  «2026…» e rompe l'ordine reale di applicazione — qui si ordina per numero. */
export function listMigrationFiles(dir = MIGRATIONS_DIR) {
  const num = (f) => {
    const m = f.match(/^(\d+)/);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => num(a) - num(b) || a.localeCompare(b));
}

/** Files present on disk that are not yet recorded as applied. */
export function pendingMigrations(allFiles, appliedFiles) {
  const applied = new Set(appliedFiles);
  return allFiles.filter((f) => !applied.has(f));
}

/** A pg error's 1-indexed character `position` (offset into the whole query string) → a 1-indexed line number. */
export function lineForPosition(sql, position) {
  const offset = Number(position) - 1;
  if (!Number.isFinite(offset) || offset < 0) return null;
  return sql.slice(0, offset).split('\n').length;
}

/** Statements Postgres refuses inside a transaction block: such a file is applied bare, so a
 *  failure halfway leaves it unrecorded and partially applied — the price of VACUUM. */
const OUTSIDE_TRANSACTION = /^[ \t]*(vacuum|reindex|create\s+index\s+concurrently|drop\s+index\s+concurrently)\b/im;

export function runsInTransaction(sql) {
  return !OUTSIDE_TRANSACTION.test(stripComments(sql));
}

/** Splits a file so every solo-only statement travels alone: several statements in one simple
 *  query are an implicit transaction block, which is exactly what VACUUM refuses. */
export function statementChunks(sql) {
  const chunks = [];
  let current = [];
  let solo = false;

  const flush = () => {
    if (current.join('').trim()) chunks.push(current.join('\n').trim());
    current = [];
  };

  for (const line of sql.split('\n')) {
    if (!solo && OUTSIDE_TRANSACTION.test(line)) {
      flush();
      solo = true;
    }

    current.push(line);

    if (solo && line.trim().endsWith(';')) {
      flush();
      solo = false;
    }
  }
  flush();

  return chunks;
}

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

export async function applyOne(client, file, dir = MIGRATIONS_DIR) {
  const sql = readFileSync(join(dir, file), 'utf8');
  const transactional = runsInTransaction(sql);

  if (transactional) await client.query('begin');
  try {
    // Simple query protocol (no parameters) — runs every ';'-separated statement in the file.
    for (const chunk of transactional ? [sql] : statementChunks(sql)) await client.query(chunk);
    await client.query('insert into app_schema_migrations (filename) values ($1)', [file]);
    if (transactional) await client.query('commit');
  } catch (err) {
    if (transactional) await client.query('rollback').catch(() => {});
    const line = lineForPosition(sql, err.position);
    throw new Error(`${file}${line ? `:${line}` : ''} — ${err.message}`);
  }
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error(
      'DATABASE_URL is not set. Point it at YOUR Postgres (e.g. from infra/compose) — this script never defaults to a database for you.'
    );
    process.exit(1);
  }

  const { Client } = await import('pg');
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    await client.query(`
      create table if not exists app_schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const { rows } = await client.query('select filename from app_schema_migrations');
    const all = listMigrationFiles();
    const pending = pendingMigrations(
      all,
      rows.map((r) => r.filename)
    );

    if (pending.length === 0) {
      console.log(`Up to date — ${all.length} migration(s) already applied.`);
      return;
    }

    console.log(`${pending.length} pending migration(s):`);
    for (const file of pending) console.log(`  ${file}`);

    for (const file of pending) {
      await applyOne(client, file);
      console.log(`applied ${file}`);
    }

    console.log(`Applied ${pending.length} migration(s).`);
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
