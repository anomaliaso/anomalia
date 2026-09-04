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
 *   node scripts/query-tables-from-migrations.mjs          # stampa l'elenco
 *   node scripts/query-tables-from-migrations.mjs --write   # riscrive query-tables.ts
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const GENERATED = join(ROOT, 'packages', 'api-contracts', 'src', 'query-tables.ts');

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
    const sql = readFileSync(join(dir, file), 'utf8');
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

const tables = tablesFromMigrations();

if (process.argv.includes('--write')) {
  writeFileSync(GENERATED, render(tables));
  console.log(`query-tables.ts: ${tables.length} tabelle`);
} else if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(tables.join('\n'));
}
