import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * IL GUARDIANO — il client service role non ha RLS: un id che arriva dall'URL o dal corpo lo
 * porta nella riga di chiunque, e un `WHERE` che scopa solo la riga sbagliata non basta.
 *
 * La regola: una scrittura service role filtrata su un id esterno DEVE portare la colonna del
 * tenant nella stessa query, oppure essere preceduta da una prova che quell'id è di questo brand
 * — una lettura scopata che finisce in `maybeSingle`/`single` e da cui si torna indietro, o
 * `updateBrandRow`/`deleteBrandRow`, che contano le righe toccate. Un update scopato che nessuno
 * conta NON è una prova: zero righe non è un errore, e l'esecuzione prosegue.
 *
 * È approssimato per costruzione: legge il sorgente, riconosce il client dal nome, e la prova
 * vale per tutto ciò che segue nel file. Le sonde qui sotto tengono la regola onesta — se
 * smette di riconoscere il difetto, il primo test è quello che cade.
 *
 * La terza regola prende il caso in cui la colonna del tenant sta nel `SET` invece che nel
 * `WHERE`: lì non c'è nessun id da scopare, c'è un `brand_id` da verificare. È la forma che
 * costava di più e si vedeva di meno — non attraversa dati, attraversa il conto.
 */
const SRC = fileURLToPath(new URL('.', import.meta.url));

const TENANT = "(brand_id|user_id|org_id|organization_id|owner_id|account_id)";
const TENANT_FILTER = new RegExp(`\\.eq\\(\\s*['"]${TENANT}['"]`);
const SCOPED_READ = new RegExp(`\\.eq\\(\\s*['"]${TENANT}['"][^;]*?\\.(maybeSingle|single)\\(`);
const COUNTED_WRITE = /\b(updateBrandRow|deleteBrandRow)\s*\(/;
const WRITE = /\.(update|delete|upsert)\(/;
const EXTERNAL_ID = /\.eq\(\s*['"][a-z_]+['"]\s*,\s*(params\.|body[.[]|payload[.[]|input\.|fd\.get)/;
const BOUND_TO_ADMIN = /(?:const|let)\s+([\w$]+)\s*=\s*(?:\(await import\([^)]*\)\)\.)?createAdminClient\(\)/g;
const RECEIVER = /([A-Za-z_$][\w$]*)\s*(?:\(\s*\))?\s*$/;

type Finding = { file: string; line: number; chain: string };

function unscopedServiceRoleWrites(file: string, src: string): Finding[] {
  const serviceRole = new Set(['createAdminClient']);
  for (const [, name] of src.matchAll(BOUND_TO_ADMIN)) {
    serviceRole.add(name);
  }
  // Sul percorso a chiave API `authenticate()` restituisce un client service role, e lo chiama
  // `supabase` come ogni rotta del browser chiama il proprio client con RLS.
  if (file.includes('/src/routes/api/')) {
    serviceRole.add('supabase');
  }

  const out: Finding[] = [];
  for (let at = src.indexOf('.from('); at !== -1; at = src.indexOf('.from(', at + 1)) {
    const before = src.slice(0, at);
    const chain = src.slice(at).split(';')[0];

    if (!serviceRole.has(before.match(RECEIVER)?.[1] ?? '')) continue;
    if (!WRITE.test(chain) || !EXTERNAL_ID.test(chain)) continue;
    if (TENANT_FILTER.test(chain)) continue;
    if (SCOPED_READ.test(before) || COUNTED_WRITE.test(before)) continue;

    out.push({ file, line: before.split('\n').length, chain: chain.replace(/\s+/g, ' ').slice(0, 120) });
  }
  return out;
}

const RAW_BODY = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+request\.json\(\)/g;
const KEYWORD = '(?:if|while|for|switch|catch|return|typeof)';

/**
 * Il corpo grezzo che viaggia intero: sparso in un `.update()`/`.insert()`, o passato come
 * argomento a qualcosa che lo scriverà. Il `WHERE` scopato non difende il `SET`, quindi un
 * `brand_id` in più sposta la riga nel brand di un altro cliente. Il contratto zod `.strict()`
 * lo rifiuta, e chi lo usa passa `parsed.data`, non `body`.
 */
function unparsedBodyIntoWrite(file: string, src: string): Finding[] {
  const out: Finding[] = [];
  for (const name of new Set([...src.matchAll(RAW_BODY)].map(([, n]) => n))) {
    const spread = new RegExp(`\\.(update|insert|upsert)\\(\\s*(\\{[^}]*\\.\\.\\.${name}\\b|${name}\\s*[,)])`);
    const passedWhole = new RegExp(`\\b(?!${KEYWORD}\\b)[a-zA-Z]\\w*\\([^()]*\\b${name}\\s*\\)`);
    const hit = src.match(spread) ?? src.match(passedWhole);
    if (!hit) continue;

    out.push({ file, line: src.slice(0, hit.index).split('\n').length, chain: hit[0].replace(/\s+/g, ' ') });
  }
  return out;
}

const TENANT_VAR = /(?:const|let)\s+(brandId|orgId|organizationId|userId|ownerId|accountId)\s*=\s*([^;]*)/g;
const FROM_BODY = /\bbody\b|await\s+request\.json\(\)/;
const OWNERSHIP_CHECKED = /\bownsBrand\s*\(/;

/**
 * Il tenant preso dal corpo e mai verificato. Non finisce in un `WHERE` da scopare: diventa il
 * `brand_id` di una riga scritta col client service role, o lo scope sotto cui gira il lavoro —
 * e da lì il costo di quel lavoro va sul conto del brand nominato. `canEnter` non lo ferma: è
 * una porta commerciale, non un confine di sicurezza, e lo dice la sua stessa fonte.
 */
function unverifiedTenantFromBody(file: string, src: string): Finding[] {
  const out: Finding[] = [];
  for (const match of src.matchAll(TENANT_VAR)) {
    const [, name, rhs] = match;
    if (!FROM_BODY.test(rhs) || OWNERSHIP_CHECKED.test(src)) continue;

    out.push({
      file,
      line: src.slice(0, match.index).split('\n').length,
      chain: `${name} = ${rhs.replace(/\s+/g, ' ').slice(0, 90)}`
    });
  }
  return out;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

const ADMIN = "const admin = createAdminClient();\n";

describe('la regola riconosce il difetto', () => {
  it('segnala una delete service role su un id dall\'URL senza vincolo di brand', () => {
    const src = `${ADMIN}await admin.from('brand_article_tags').delete().eq('article_id', params.id);`;

    expect(unscopedServiceRoleWrites('/src/routes/app/x/+page.server.ts', src)).toHaveLength(1);
  });

  it('un update scopato che nessuno conta non è una prova', () => {
    const src =
      `${ADMIN}const { error: err } = await admin.from('brand_articles').update(patch).eq('id', params.id).eq('brand_id', brand.id);\n` +
      "if (err) return fail(500, { error: err.message });\n" +
      "await admin.from('brand_article_tags').delete().eq('article_id', params.id);";

    expect(unscopedServiceRoleWrites('/src/routes/app/x/+page.server.ts', src)).toHaveLength(1);
  });

  it('accetta la prova per righe toccate', () => {
    const src =
      `${ADMIN}const failure = await updateBrandRow(admin, 'brand_articles', brand.id, params.id, patch);\n` +
      "if (failure) return fail(failure.status, { error: failure.error });\n" +
      "await admin.from('brand_article_tags').delete().eq('article_id', params.id);";

    expect(unscopedServiceRoleWrites('/src/routes/app/x/+page.server.ts', src)).toEqual([]);
  });

  it('accetta la prova per lettura scopata', () => {
    const src =
      "const { data: doc } = await supabase.from('brand_documents').select('file_url').eq('id', params.id).eq('brand_id', brand.id).maybeSingle();\n" +
      "if (!doc) return json({ error: 'not_found' }, { status: 404 });\n" +
      "await supabase.from('brand_documents').delete().eq('id', params.id);";

    expect(unscopedServiceRoleWrites('/src/routes/api/v1/brands/x/+server.ts', src)).toEqual([]);
  });

  it('lascia stare il client con RLS del browser', () => {
    const src = "await supabase.from('brands').update({ timezone: tz }).eq('slug', params.brand);";

    expect(unscopedServiceRoleWrites('/src/lib/server/settings-actions.ts', src)).toEqual([]);
  });
});

describe('la regola riconosce il corpo grezzo che arriva a un SET', () => {
  it('segnala il corpo passato intero a chi scrive', () => {
    const src =
      'const body = await request.json();\n' +
      'await updateMemoryEntry(supabase, brand.id, params.id, body);';

    expect(unparsedBodyIntoWrite('/src/routes/api/v1/x/+server.ts', src)).toHaveLength(1);
  });

  it('segnala il corpo sparso in un update', () => {
    const src =
      'const body = await request.json();\n' +
      "await supabase.from('brand_memory').update({ ...body, updated_at: now }).eq('id', id);";

    expect(unparsedBodyIntoWrite('/src/routes/api/v1/x/+server.ts', src)).toHaveLength(1);
  });

  it('accetta il corpo passato da un contratto', () => {
    const src =
      'const parsed = UPDATE_MEMORY_ENTRY.safeParse(await request.json().catch(() => null));\n' +
      'if (!parsed.success) return json({ error: '
      + "'invalid_input' }, { status: 400 });\n" +
      'await updateMemoryEntry(supabase, brand.id, params.id, parsed.data);';

    expect(unparsedBodyIntoWrite('/src/routes/api/v1/x/+server.ts', src)).toEqual([]);
  });

  it('non confonde un controllo con una scrittura', () => {
    const src =
      'const body = await request.json().catch(() => ({}));\n' +
      "if (body?.action !== 'promote') return json({ error: 'Unsupported action' }, { status: 400 });";

    expect(unparsedBodyIntoWrite('/src/routes/api/v1/x/+server.ts', src)).toEqual([]);
  });
});

const BRAND_FROM_BODY = "const brandId = typeof body?.brandId === 'string' ? body.brandId : null;\n";

describe('la regola riconosce il tenant preso dal corpo', () => {
  it('segnala un brandId dal corpo che nessuno verifica', () => {
    const src =
      BRAND_FROM_BODY +
      'if (!(await canEnter(supabase))) return new Response(\'Forbidden\', { status: 403 });\n' +
      'await startOnboardingStepJob(supabase, { kind, userId: user.id, brandId, input });';

    expect(unverifiedTenantFromBody('/src/routes/app/onboarding/x/+server.ts', src)).toHaveLength(1);
  });

  it('accetta un brandId verificato contro il client dell utente', () => {
    const src =
      BRAND_FROM_BODY +
      "if (brandId && !(await ownsBrand(supabase, brandId))) return new Response('Forbidden', { status: 403 });\n" +
      'await startOnboardingStepJob(supabase, { kind, userId: user.id, brandId, input });';

    expect(unverifiedTenantFromBody('/src/routes/app/onboarding/x/+server.ts', src)).toEqual([]);
  });

  it('lascia stare un id che viene da un brand gia caricato', () => {
    const src = 'const brandId = brand.id;\nawait withBrandContext(brandId, run);';

    expect(unverifiedTenantFromBody('/src/routes/app/x/+server.ts', src)).toEqual([]);
  });

  it('lascia stare un campo del corpo che non nomina un tenant', () => {
    const src = "const draftId = typeof body?.draftId === 'string' ? body.draftId : null;";

    expect(unverifiedTenantFromBody('/src/routes/app/x/+server.ts', src)).toEqual([]);
  });
});

describe('src/ non scrive fra clienti diversi', () => {
  const files = listTsFiles(SRC);

  it('ha trovato file .ts da controllare (il test non passa vuoto per errore)', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  const report = (findings: Finding[]) =>
    findings.map((f) => `${f.file.slice(SRC.length)}:${f.line}\n    ${f.chain}`).join('\n');

  it('nessuna scrittura service role su un id esterno senza vincolo di brand', () => {
    const findings = files.flatMap((f) => unscopedServiceRoleWrites(f, readFileSync(f, 'utf-8')));

    expect(findings, `il client service role ignora la RLS:\n${report(findings)}`).toEqual([]);
  });

  it('nessun corpo di richiesta non analizzato dentro un SET', () => {
    const findings = files.flatMap((f) => unparsedBodyIntoWrite(f, readFileSync(f, 'utf-8')));

    expect(findings, `il WHERE è scopato, il SET no:\n${report(findings)}`).toEqual([]);
  });

  it('nessun tenant preso dal corpo senza verifica di proprietà', () => {
    const findings = files.flatMap((f) => unverifiedTenantFromBody(f, readFileSync(f, 'utf-8')));

    expect(findings, `il brand lo sceglie chi chiama:\n${report(findings)}`).toEqual([]);
  });
});

