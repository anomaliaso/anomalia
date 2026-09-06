/**
 * LE TABELLE CHE `query` PUÒ NOMINARE, DERIVATE DALLE MIGRAZIONI E NON DAL DATABASE.
 *
 * La regola è una sola: una tabella esiste se una migrazione la crea. Non «esiste se sta in
 * produzione», che è la trappola in cui cade il primo tentativo di generare dal catalogo —
 * produzione contiene anche ciò che nessuna migrazione crea, e da un'installazione da zero quei
 * nomi non esistono affatto: `asset_projects`, `asset_project_files` e `mcp_logs` erano già stati
 * tolti a mano proprio per questo, e generando dal catalogo tornerebbero dentro.
 *
 * La stessa regola, senza un'eccezione in più, tiene fuori i backup: `thread_events_backup_20260901`
 * è nato da una mano, non da una migrazione, e un backup in `public` non è un dato da leggere.
 *
 * Vale solo `public`: un `create table stripe.subscriptions` non entra, ed è il limite «solo
 * public» applicato dove si genera invece che raccomandato nella descrizione del tool.
 *
 * LO STESSO ELENCO SERVE ALLA SCRITTURA, e per lei non basta il nome della tabella: quando
 * Postgres rifiuta, `insert_row` deve poter dire QUALI valori quel vincolo ammette e QUALI colonne
 * quel ruolo può scrivere, o il modello indovina il giro dopo. Anche quelle due risposte stanno
 * nelle migrazioni — `check (status in (…))` e `grant insert (…) on … to authenticated` — e da lì
 * si generano, nello stesso passaggio e con la stessa regola.
 *
 *   node scripts/query-tables-from-migrations.mjs          # stampa l'elenco
 *   node scripts/query-tables-from-migrations.mjs --write   # riscrive query-tables.ts e write-rules.ts
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const GENERATED = join(ROOT, 'packages', 'api-contracts', 'src', 'query-tables.ts');
const GENERATED_WRITE_RULES = join(ROOT, 'packages', 'api-contracts', 'src', 'write-rules.ts');

const NAME = String.raw`"?[a-z_][a-z0-9_]*"?(?:\s*\.\s*"?[a-z_][a-z0-9_]*"?)?`;
const STATEMENT = new RegExp(
  [
    String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?(?<created>${NAME})`,
    String.raw`drop\s+table\s+(?:if\s+exists\s+)?(?<dropped>${NAME})`,
    String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?<from>${NAME})\s+rename\s+to\s+(?<to>${NAME})`
  ].join('|'),
  'gis'
);

/**
 * Il DDL, senza i commenti e senza le stringhe che lo nominano.
 * `20260905120000_secdef_least_privilege.sql` contiene
 * `where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')` — testo dentro un
 * event trigger, non una `create table` — e lo scanner ne ricavava una tabella di nome `as`.
 * Un guardiano che si nomina da solo è un pattern che si ricopia, quindi si toglie la causa.
 *
 * I commenti spariscono PRIMA delle stringhe, e l'ordine non è cosmetico: i commenti qui sono in
 * italiano, pieni di apostrofi, e un apostrofo spaiato fa divorare al taglio delle stringhe interi
 * blocchi di DDL vero. Tolti i commenti prima, gli apostrofi rimasti sono letterali veri e chiusi.
 */
function withoutStringLiterals(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * `public.posts` e `posts` sono la stessa tabella; `stripe.subscriptions` non è di `public` e non
 * entra. È qui che «solo lo schema public» smette di essere una raccomandazione.
 */
function publicTable(raw) {
  if (!raw) return null;
  const parts = raw.replace(/"/g, '').split('.').map((s) => s.trim().toLowerCase());
  if (parts.length === 2) return parts[0] === 'public' ? parts[1] : null;
  return parts[0];
}

export function tablesFromMigrations(dir = MIGRATIONS) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const tables = new Set();

  for (const file of files) {
    const sql = withoutStringLiterals(readFileSync(join(dir, file), 'utf8'));
    for (const match of sql.matchAll(STATEMENT)) {
      const created = publicTable(match.groups.created);
      if (created) {
        tables.add(created);
        continue;
      }

      const dropped = publicTable(match.groups.dropped);
      if (dropped) {
        tables.delete(dropped);
        continue;
      }

      const renamedFrom = publicTable(match.groups.from);
      const renamedTo = publicTable(match.groups.to);
      if (renamedFrom && renamedTo && tables.delete(renamedFrom)) tables.add(renamedTo);
    }
  }

  return [...tables].sort();
}

function render(tables) {
  const lines = [];
  let row = [];
  for (const t of tables) {
    row.push(t);
    if (row.join(' ').length > 96) {
      lines.push(`  '${row.join(' ')} ' +`);
      row = [];
    }
  }
  if (row.length) lines.push(`  '${row.join(' ')}';`);
  else lines[lines.length - 1] = lines[lines.length - 1].replace(/ \+$/, ';').replace(/ '$/, "'");

  return `/**
 * GENERATO — non si modifica a mano: \`node scripts/query-tables-from-migrations.mjs --write\`.
 *
 * Ogni tabella di \`public\` che una migrazione crea, cioè ogni tabella che esiste anche da
 * un'installazione da zero. La regola e il perché stanno nello script; \`query-tool.test.ts\`
 * rigenera e confronta, quindi una migrazione che aggiunge una tabella fa fallire il test finché
 * questo file non viene rigenerato — e l'agente non resta cieco su una tabella nuova.
 */
export const QUERY_TABLES =
${lines.join('\n')}
`;
}

/**
 * I valori ammessi vivono DENTRO le stringhe — `check (status in ('approved', …))` — quindi qui i
 * letterali restano e spariscono solo i commenti. L'ordine è quello di `withoutStringLiterals`, e
 * per la stessa ragione: i commenti sono in italiano e i loro apostrofi non sono letterali.
 */
function withoutComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Le parentesi si contano, non si cercano: `check (media_url ~ '^https?://(a|b)')` chiude la sua
 * prima parentesi dentro un letterale, e un `.*?\)` pigro taglierebbe l'espressione a metà —
 * dicendo al modello che sono ammessi valori che non lo sono.
 */
function balanced(sql, open) {
  let depth = 0;
  let quoted = false;

  for (let i = open; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") quoted = !quoted;
    if (quoted) continue;
    if (c === '(') depth++;
    if (c === ')' && --depth === 0) return sql.slice(open + 1, i);
  }

  return null;
}

const CONSTRAINT = /constraint\s+"?([a-z_][a-z0-9_]*)"?\s+check\s*\(/gi;
const DROP_CONSTRAINT = /drop\s+constraint\s+(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;

/** Nome del vincolo → la sua espressione, ripiegata su una riga: è ciò che il 23514 non dice. */
export function checksFromMigrations(dir = MIGRATIONS) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const checks = new Map();

  for (const file of files) {
    const sql = withoutComments(readFileSync(join(dir, file), 'utf8'));

    for (const match of sql.matchAll(DROP_CONSTRAINT)) checks.delete(match[1].toLowerCase());

    for (const match of sql.matchAll(CONSTRAINT)) {
      const body = balanced(sql, match.index + match[0].length - 1);
      if (body) checks.set(match[1].toLowerCase(), body.replace(/\s+/g, ' ').trim());
    }
  }

  return Object.fromEntries([...checks].sort(([a], [b]) => a.localeCompare(b)));
}

const GRANT = /(grant|revoke)\s+([a-z, ]+?)\s*(?:\(([^)]*)\))?\s+on\s+(?:table\s+)?"?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+(?:to|from)\s+([a-z_, ]+)/gi;

/**
 * Le colonne che `authenticated` può scrivere, per tabella, quando un grant per colonna le
 * restringe. Una tabella che non compare qui NON è senza permessi: è senza restrizione di colonna,
 * e il suo 42501 viene dalla RLS — che è una riga sbagliata, non una colonna vietata. Distinguere
 * i due è tutto il valore di questo elenco: il rimedio è opposto.
 */
export function writableColumnsFromMigrations(dir = MIGRATIONS) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const grants = new Map();

  for (const file of files) {
    const sql = withoutComments(readFileSync(join(dir, file), 'utf8'));

    for (const [, verb, privileges, columns, table, roles] of sql.matchAll(GRANT)) {
      if (!roles.split(',').some((r) => r.trim().toLowerCase() === 'authenticated')) continue;

      const acts = privileges
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter((p) => p === 'insert' || p === 'update');
      if (!acts.length) continue;

      const entry = grants.get(table.toLowerCase()) ?? { insert: null, update: null };
      for (const act of acts) {
        entry[act] =
          verb.toLowerCase() === 'revoke' || !columns
            ? null
            : columns.split(',').map((c) => c.trim().replace(/"/g, '')).filter(Boolean);
      }
      grants.set(table.toLowerCase(), entry);
    }
  }

  return Object.fromEntries(
    [...grants]
      .filter(([, e]) => e.insert || e.update)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([table, e]) => [table, { insert: e.insert ?? [], update: e.update ?? [] }])
  );
}

function renderWriteRules(checks, writable) {
  return `/**
 * GENERATO — non si modifica a mano: \`node scripts/query-tables-from-migrations.mjs --write\`.
 *
 * Le due risposte che uno SQLSTATE nudo non dà a chi scrive: quali valori un CHECK ammette (23514)
 * e quali colonne un grant lascia scrivere (42501). Vengono dalle migrazioni, come l'elenco delle
 * tabelle, e per la stessa ragione. \`write-tool.test.ts\` rigenera e confronta: una migrazione che
 * aggiunge un vincolo o stringe un grant fa fallire il test finché questo file non è rigenerato,
 * e l'agente non si trova davanti a un rifiuto che nessuno sa spiegare.
 */
export const TABLE_CHECKS: Record<string, string> = ${JSON.stringify(checks, null, 2)};

export const WRITABLE_COLUMNS: Record<string, { insert: string[]; update: string[] }> = ${JSON.stringify(writable, null, 2)};
`;
}

const tables = tablesFromMigrations();

if (process.argv.includes('--write')) {
  const checks = checksFromMigrations();
  const writable = writableColumnsFromMigrations();

  writeFileSync(GENERATED, render(tables));
  writeFileSync(GENERATED_WRITE_RULES, renderWriteRules(checks, writable));
  console.log(`query-tables.ts: ${tables.length} tabelle`);
  console.log(
    `write-rules.ts: ${Object.keys(checks).length} vincoli, ${Object.keys(writable).length} tabelle con grant per colonna`
  );
} else if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(tables.join('\n'));
}
