import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * NESSUN ENUM CON UNA STRINGA VUOTA — la regola che l'intera flotta ha pagato.
 *
 * Dal 1 al 6 agosto 2026 ogni run dell'autopilot è morta sullo stesso 400 di Gemini:
 *
 *   GenerateContentRequest.generation_config.response_schema
 *     .properties[seeds].items.properties[media_mode].enum[2]: cannot be empty
 *
 * Il colpevole era `enum: ['use_as_is', 'composite', '']` in content-preview.ts: il terzo valore
 * serviva a dire «nessun media di libreria», ma un enum di JSON Schema non ammette la stringa
 * vuota — il modo giusto è omettere il campo (toglierlo da `required`). Zero post prodotti per
 * settimane, e nessuno se ne è accorto perché l'errore viveva solo in `scheduler_runs.error`.
 *
 * Questo test non guarda `media_mode`: guarda OGNI enum del repo, letterale o costruito per
 * spread da una costante (`enum: [...CONTENT_FORMATS]`), perché il prossimo enum vuoto non si
 * chiamerà media_mode. Lettura del sorgente e basta, come gli altri test di proprietà di questo
 * repo: importare gli schemi vorrebbe dire importare mezzo server (env, rete, client AI).
 */

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.svelte-kit') continue;
      tsFiles(p, out);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** I letterali stringa di un pezzo di sorgente, nell'ordine in cui compaiono. */
function stringLiterals(body: string): string[] {
  return [...body.matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)].map((m) => m[1] ?? m[2] ?? '');
}

const FILES = tsFiles('src');
const SOURCES = new Map(FILES.map((f) => [f, readFileSync(f, 'utf8')]));

/** Il corpo di `const NAME = [ … ]`, cercato in tutto il repo. `null` se non si trova. */
function constArrayBody(name: string): string | null {
  for (const src of SOURCES.values()) {
    const m = src.match(new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*\\[([^\\]]*)\\]`));
    if (m) return m[1];
  }
  return null;
}

describe('schemi passati ai modelli', () => {
  it('nessun `enum:` contiene una stringa vuota (Gemini rifiuta la richiesta intera)', () => {
    const offenders: string[] = [];

    for (const [file, src] of SOURCES) {
      for (const m of src.matchAll(/\benum:\s*\[([^\]]*)\]/g)) {
        const body = m[1];
        const line = src.slice(0, m.index ?? 0).split('\n').length;

        if (stringLiterals(body).some((v) => v.trim() === '')) {
          offenders.push(`${file}:${line} — letterale vuoto in enum: [${body.trim()}]`);
        }

        // `enum: [...CONSTANTS]`: l'enum è vuoto solo se lo è la costante che lo genera.
        for (const s of body.matchAll(/\.\.\.([A-Za-z_$][\w$]*)/g)) {
          const constBody = constArrayBody(s[1]);
          if (constBody && stringLiterals(constBody).some((v) => v.trim() === '')) {
            offenders.push(`${file}:${line} — la costante ${s[1]} contiene una stringa vuota`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
