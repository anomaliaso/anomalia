import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POST_STATUSES, POST_CONTENT_TYPES, POST_SOURCES } from './contracts/post-tools';
import { SITE_TYPES } from './brand-fields';

/**
 * Il CHECK vive nel database, l'elenco vive nel codice, e i due divergono in silenzio: la suite
 * mocka Supabase, quindi un insert finto accetta qualunque stringa e il test è verde per
 * costruzione (LESSONS.md, `brand_media.source`).
 *
 * `constraint-harness.mjs` prova che un valore fuori elenco viene RIFIUTATO, ma un caso in più
 * copre un valore in più: non fallisce il giorno in cui il codice ne impara un settimo. Questo
 * invece sì — confronta l'insieme dichiarato nel codice con quello ammesso dalla migration, e
 * rompe in entrambe le direzioni: valore nuovo nel codice e CHECK non aggiornato, oppure CHECK
 * allargato e costante rimasta indietro.
 *
 * `posts.source` è il motivo per cui esiste: `external` non era in nessun grep di letterali —
 * al punto dell'insert c'è una variabile e il valore nasce quattordici file più in là — e
 * sarebbe arrivato in produzione come un 23514 su ogni chiamata di
 * `POST /api/v1/brands/:slug/posts`.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MIGRATIONS = join(ROOT, 'supabase/migrations');

function allowedByTheDatabase(constraint: string): string[] {
  let allowed: string[] = [];

  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const at = sql.lastIndexOf(`add constraint ${constraint}`);
    if (at < 0) continue;

    const open = sql.indexOf('(', sql.indexOf('check', at));
    let depth = 0;
    let end = open;
    for (let i = open; i < sql.length; i++) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')' && --depth === 0) {
        end = i;
        break;
      }
    }
    allowed = [...sql.slice(open, end).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }

  return allowed;
}

const VOCABULARIES = [
  { constraint: 'posts_status_check', declared: POST_STATUSES },
  { constraint: 'posts_content_type_check', declared: POST_CONTENT_TYPES },
  { constraint: 'posts_source_check', declared: POST_SOURCES },
  { constraint: 'brand_kit_site_type_check', declared: SITE_TYPES }
] as const;

describe('il vocabolario del codice e quello del database sono lo stesso insieme', () => {
  for (const { constraint, declared } of VOCABULARIES) {
    it(`${constraint} ammette esattamente i valori dichiarati nel codice`, () => {
      const allowed = allowedByTheDatabase(constraint);

      expect(allowed.length, `nessun valore letto da ${constraint}: la scansione è passata a vuoto`).toBeGreaterThan(1);
      expect([...allowed].sort()).toEqual([...declared].sort());
    });
  }
});
