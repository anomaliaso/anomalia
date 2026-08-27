/**
 * COLLAUDO — si guarda, non si legge un report.
 *
 * Gira il codice VERO (`src/lib/server/chat/query-tool.ts` e `sandbox-workspace.ts`), non una copia,
 * e stampa cosa succede. Due cose non possono succedere, per costruzione:
 *
 *  - NIENTE PORTA 5173: qui non c'è nessun server, è un processo che esce da solo.
 *  - NIENTE SCRITTURE IN PRODUZIONE: `fetch` è intercettato (nessuna richiesta esce dalla macchina)
 *    e il comando parte con `SUPABASE_SERVICE_ROLE_KEY=` vuoto, così il client di servizio non si
 *    costruisce nemmeno. Il §0 lo VERIFICA invece di prometterlo: se una delle due cose non tiene,
 *    il collaudo si ferma qui e esce 1.
 *
 * Alla fine: `esito` e codice d'uscita. Ogni riga `[ok]` è un controllo che fallisce se la logica
 * si rompe — non una stampa.
 */
import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '$lib/server/supabase-admin';
import {
  createQueryTool,
  explainDbError,
  DB_STATEMENT_TIMEOUT_MS,
  QUERY_MAX_CHARS,
  QUERY_MAX_ROWS,
  QUERY_MAX_VALUE_CHARS,
  QUERY_TABLE_LIST
} from '$lib/server/chat/query-tool';
import { describeColumns, toCsv } from '$lib/server/chat/sandbox-workspace';

// ── impalcatura ────────────────────────────────────────────────────────────────────────────────
let failures = 0;
const W = 96;
const rule = (c = '─') => console.log(c.repeat(W));
const title = (n: string, t: string) => {
  console.log('');
  rule('━');
  console.log(`  §${n}  ${t}`);
  rule('━');
};
const say = (s = '') => console.log(s);
const quote = (s: string) =>
  String(s)
    .split('\n')
    .flatMap((line) => line.match(new RegExp(`.{1,${W - 6}}`, 'g')) ?? [''])
    .forEach((l) => console.log('   │ ' + l));
const check = (label: string, ok: boolean, saw?: string) => {
  if (!ok) failures++;
  console.log(`   ${ok ? '[ok]  ' : '[ROTTO]'} ${label}`);
  if (!ok && saw !== undefined) console.log(`           visto invece: ${saw}`);
};

// ── §0 · il collaudo non può scrivere ──────────────────────────────────────────────────────────
title('0', 'Questo collaudo non può toccare il database di produzione');

let adminErr = '';
try {
  createAdminClient();
} catch (e) {
  adminErr = e instanceof Error ? e.message : String(e);
}
say('   La chiave di servizio è l\'unico modo di scrivere. Provo a costruire quel client:');
quote(adminErr || '(NESSUN ERRORE — il client di servizio si è costruito)');
check(
  'createAdminClient() non si costruisce → nessuna riga può essere scritta da questo processo',
  adminErr.includes('SUPABASE_SERVICE_ROLE_KEY not configured'),
  adminErr || 'client costruito'
);

/** Ogni richiesta HTTP che il codice tenta. Nessuna esce: rispondiamo noi, in memoria. */
type Seen = { method: string; url: string; body?: string };
const seen: Seen[] = [];
let canned: { status: number; body: unknown; contentRange?: string } = { status: 200, body: [] };

const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  seen.push({ method, url, body: typeof init?.body === 'string' ? init.body : undefined });
  return new Response(JSON.stringify(canned.body), {
    status: canned.status,
    headers: {
      'content-type': 'application/json',
      ...(canned.contentRange ? { 'content-range': canned.contentRange } : {})
    }
  });
};

const BRAND = '11111111-2222-3333-4444-555555555555';
const supabase = createClient('https://collaudo.invalid', 'sb_publishable_collaudo', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: fakeFetch as unknown as typeof fetch }
});
// Il tool esige una sessione utente (anon key + JWT). Qui gliene diamo una finta: nessun token vero
// entra in questo processo.
(supabase.auth as unknown as { getSession: () => Promise<unknown> }).getSession = async () => ({
  data: { session: { access_token: 'jwt-finto-del-collaudo' } },
  error: null
});

const tool = createQueryTool({ supabase, brandId: BRAND, userId: 'u-collaudo', threadId: 't-collaudo' })
  .query as unknown as { execute: (i: unknown, o: unknown) => Promise<Record<string, unknown>> };
const run = (input: unknown) => tool.execute(input, {});

say('');
say('   E la rete: `fetch` è sostituito da una funzione che REGISTRA e risponde in memoria.');
check('nessuna richiesta HTTP partita finora', seen.length === 0, `${seen.length}`);

if (failures > 0) {
  say('');
  say('   Le garanzie del collaudo non tengono. Mi fermo prima di eseguire qualunque altra cosa.');
  process.exit(1);
}

// ── §1 · una scrittura mascherata non ha dove andare ───────────────────────────────────────────
title('1', '`query` — una scrittura mascherata non viene rifiutata: non è esprimibile');

const masked: Array<[string, unknown]> = [
  ['SQL infilato nel nome della tabella', { table: "posts; insert into admins(user_id) values ('me') --" }],
  ['CTE che scrive, travestita da tabella', { table: 'x) with q as (insert into brands(name) values (\'x\') returning 1) select * from (select 1' }],
  ['chiamata a una funzione SECURITY DEFINER', { table: 'rpc/notify_admin_email' }],
  ['espressione al posto di una colonna', { table: 'posts', columns: ['id', "(select notify_admin_email('a','b'))"] }],
  ['SQL nel nome di una colonna di filtro', { table: 'posts', where: [{ column: 'id); drop table posts; --', op: 'eq', value: 1 }] }],
  ['SQL nel campo di ordinamento', { table: 'posts', order: { column: 'id; delete from posts' } }]
];

for (const [label, input] of masked) {
  const before = seen.length;
  const out = await run(input);
  const partite = seen.length - before;
  say('');
  say(`   ${label}`);
  quote(`in:  ${JSON.stringify(input)}`);
  quote(`out: ${out.error} — ${String(out.message).slice(0, 200)}`);
  check(`rifiutato in locale (${out.error}) e ZERO richieste partite`, out.error === 'not_an_identifier' && partite === 0, `richieste partite: ${partite}, error: ${String(out.error)}`);
}

say('');
rule();
say('   E ora lo stesso SQL dentro un VALORE, dove il modello ce lo può mettere davvero.');
say('   Non viene rifiutato — viene letto come testo, perché non esiste il posto dove diventerebbe SQL:');
canned = { status: 200, body: [{ id: 'p1', caption: 'ciao' }], contentRange: '0-0/1' };
const beforeLegit = seen.length;
await run({
  table: 'posts',
  columns: ['id', 'caption'],
  where: [
    { column: 'brand_id', op: 'eq', value: BRAND },
    { column: 'caption', op: 'ilike', value: "%'; drop table posts; --%" }
  ],
  limit: 5
});
const req = seen[seen.length - 1];
say('');
say('   La richiesta VERA che il codice ha costruito (registrata, mai spedita):');
quote(`${req.method} ${req.url}`);
check('il verbo HTTP è GET, e GET non scrive', req.method === 'GET', req.method);
check('il metodo NON è POST/PATCH/DELETE su nessuna delle richieste fatte finora', seen.every((s) => s.method === 'GET'), seen.map((s) => s.method).join(','));
check('è partita esattamente una richiesta', seen.length - beforeLegit === 1, String(seen.length - beforeLegit));
check(
  "il `drop table` è finito percent-encoded dentro un parametro di query (`%3B` = ';'), non in una istruzione",
  req.url.includes('drop') && req.url.includes('%3B') && !req.url.includes('; drop'),
  req.url
);

// ── §2 · i tetti si dichiarano ─────────────────────────────────────────────────────────────────
title('2', '`query` — ogni tetto che morde lo dice, nel risultato');

say(`   Dichiarati nel codice: ${QUERY_MAX_ROWS} righe max, ${QUERY_MAX_CHARS} caratteri di risultato,`);
say(`   ${QUERY_MAX_VALUE_CHARS} caratteri per singolo valore, ${DB_STATEMENT_TIMEOUT_MS / 1000}s di statement_timeout (del database, non nostro).`);

// (a) il limite chiesto oltre il massimo viene tagliato, e si vede nella richiesta.
canned = { status: 200, body: [{ id: 'p1' }], contentRange: '0-0/9999' };
const beforeLimit = seen.length;
await run({ table: 'posts', columns: ['id'], limit: 5000 });
const limitUrl = seen[seen.length - 1].url;
say('');
say('   (a) il modello chiede limit: 5000 →');
quote(decodeURIComponent(limitUrl));
check(
  `nella richiesta c'è limit=${QUERY_MAX_ROWS}, non 5000`,
  limitUrl.includes(`limit=${QUERY_MAX_ROWS}`) && !limitUrl.includes('limit=5000'),
  limitUrl
);
check('una sola richiesta', seen.length - beforeLimit === 1, String(seen.length - beforeLimit));

// (b) una colonna enorme viene tagliata E nominata.
const LUNGO = 'x'.repeat(726_007); // la misura vera di brand_documents.content in produzione
canned = {
  status: 200,
  body: [{ id: 'd1', title: 'Brand book', content: LUNGO }],
  contentRange: '0-0/120'
};
const big = await run({ table: 'brand_documents' });
const rows = big.rows as Array<Record<string, unknown>>;
say('');
say('   (b) una riga con una colonna da 726.007 caratteri (la misura vera di `brand_documents.content`) →');
quote(`limits: ${String(big.limits)}`);
quote(`content ricevuto: ${String(rows[0].content).length} caratteri, finisce con «${String(rows[0].content).slice(-28)}»`);
check('la riga arriva comunque (o la scoperta delle colonne morirebbe lì)', rows.length === 1 && 'content' in rows[0], JSON.stringify(Object.keys(rows[0] ?? {})));
// Il numero è scritto a mano di proposito: se il controllo leggesse la costante, alzare la
// costante renderebbe il controllo verde da solo — e un controllo che non può fallire non è un controllo.
check(`il valore è tagliato a ${QUERY_MAX_VALUE_CHARS} caratteri`, String(rows[0].content).length < 3_000, String(String(rows[0].content).length));
check('il taglio è DICHIARATO, e per nome di colonna («content»)', String(big.limits).includes('Values cut') && String(big.limits).includes('content'), String(big.limits));
check(`il conto delle righe è dichiarato ("${String(big.returned)} rows of ~${String(big.total)}")`, String(big.limits).includes(`${big.returned} rows of ~${big.total}`), String(big.limits));

// (c) il tetto sui caratteri totali: righe scartate, e detto.
canned = {
  status: 200,
  body: Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, content: 'y'.repeat(1_900) })),
  contentRange: '0-39/40'
};
const many = await run({ table: 'brand_documents', limit: 40 });
say('');
say('   (c) 40 righe da ~1.900 caratteri l\'una (il database le ha restituite tutte) →');
quote(`limits: ${String(many.limits)}`);
check(
  `meno di 40 righe mostrate, e il taglio a ${QUERY_MAX_CHARS} caratteri è dichiarato`,
  (many.returned as number) < 40 && String(many.limits).includes(`Cut at ${QUERY_MAX_CHARS} chars`),
  `${String(many.returned)} righe — ${String(many.limits)}`
);

// (d) le 141 tabelle non stanno nella descrizione (si pagherebbero a ogni passo di ogni turno).
const descr = (tool as unknown as { description?: string }).description ?? '';
say('');
say(`   (d) la lista delle ${QUERY_TABLE_LIST.length} tabelle si ottiene chiamando \`query\` senza \`table\`,`);
say(`       e NON sta nella descrizione del tool (~${Math.round(descr.length / 4)} token, pagati a ogni passo di ogni turno):`);
const tables = await run({});
check(
  `query({}) elenca ${QUERY_TABLE_LIST.length} tabelle`,
  (tables.count as number) === QUERY_TABLE_LIST.length,
  String(tables.count)
);
check(
  'la descrizione del tool NON contiene la lista',
  !descr.includes('social_post_history') && !descr.includes('brand_documents'),
  `${descr.length} caratteri`
);

// ── §3 · l'errore insegna ──────────────────────────────────────────────────────────────────────
title('3', '`query` — l\'errore del database dice cosa fare, non solo cosa è andato storto');

canned = {
  status: 404,
  body: {
    code: 'PGRST205',
    message: "Could not find the table 'public.postz' in the schema cache",
    hint: "Perhaps you meant the table 'public.posts'",
    details: null
  }
};
const err = await run({ table: 'postz' });
say('   Tabella sbagliata di una lettera. Il database risponde PGRST205; il modello riceve:');
quote(`error:   ${String(err.error)}`);
quote(`message: ${String(err.message)}`);
quote(`fix:     ${String(err.fix)}`);
check('il suggerimento di PostgREST arriva al modello intatto', String(err.fix).includes("Perhaps you meant the table 'public.posts'"), String(err.fix));
check('e gli viene detto come si elencano le tabelle', String(err.fix).includes('no table'), String(err.fix));

say('');
say('   Gli altri quattro errori che capitano davvero:');
for (const [code, msg] of [
  ['42703', 'column "gtm_plan" does not exist'],
  ['42501', 'permission denied for table brands'],
  ['57014', 'canceling statement due to statement timeout'],
  ['PGRST200', "Could not find a relationship between 'posts' and 'brands'"]
] as const) {
  say('');
  say(`   ${code} — ${msg}`);
  quote(explainDbError(code, msg, null));
}
check(
  `il 57014 nomina gli ${DB_STATEMENT_TIMEOUT_MS / 1000}s veri del ruolo`,
  explainDbError('57014', '', null).includes(`${DB_STATEMENT_TIMEOUT_MS / 1000}s`),
  explainDbError('57014', '', null)
);
check(
  'il 42703 insegna a scoprire le colonne (una riga vera, le sue chiavi SONO lo schema)',
  explainDbError('42703', '', null).includes('keys ARE the column list'),
  explainDbError('42703', '', null)
);
check(
  'il 42501 dice che non c\'è niente da riprovare',
  /nothing to retry/i.test(explainDbError('42501', '', null)),
  explainDbError('42501', '', null)
);

// ── §4 · history.csv ───────────────────────────────────────────────────────────────────────────
title('4', 'history.csv — una colonna che nessuno valorizza non vale zero: non esiste');

/** Le colonne del file vero (`sandbox-workspace.ts`), nell'ordine vero. */
const HISTORY_COLUMNS = ['published_at', 'platform', 'source', 'likes', 'comments', 'shares', 'views', 'saves', 'reach', 'engagement_rate', 'chars', 'url'];
const METRICHE = ['likes', 'comments', 'shares', 'views', 'saves', 'reach', 'engagement_rate'] as const;

/** Righe come le produce il codice vero: le metriche assenti sono '' (vedi `metricColumns`). */
const scrape = (i: number) => ({
  published_at: `2026-08-${String(10 + i).padStart(2, '0')}`,
  platform: 'instagram',
  source: 'scrapecreators',
  likes: 120 + i * 7,
  comments: 4 + i,
  shares: '',
  views: 3000 + i * 90,
  saves: '', // scrapecreators non li porta: 0 righe su 3.131, misurato
  reach: '', // nessuna fonte li porta: 0 righe su 3.507
  engagement_rate: '', // idem
  chars: 180 + i,
  url: `https://instagram.com/p/abc${i}`
});
const zernio = (i: number) => ({ ...scrape(i), source: 'zernio', shares: 2 + i, saves: 9 + i, engagement_rate: 0.031 + i / 1000 });

// ── il brand tipico: 22 su 29 non hanno una sola riga `zernio`.
const soloScrape = [scrape(0), scrape(1), scrape(2)];

say('   Il caso vero: 22 brand su 29 non hanno una sola riga `zernio`, quindi il loro storico');
say('   non porta engagement_rate, saves, shares. `reach` non ce l\'ha nessuno: 0 righe su 3.507.');
say('');
say('   PRIMA — l\'intestazione si scriveva comunque:');
quote(toCsv(soloScrape, HISTORY_COLUMNS).split('\n').slice(0, 3).join('\n'));

const { columns, note } = describeColumns(soloScrape, HISTORY_COLUMNS, METRICHE);
say('');
say('   ADESSO — le colonne che nessuna riga valorizza non vengono scritte:');
quote(toCsv(soloScrape, columns).split('\n').slice(0, 3).join('\n'));
say('');
say('   …e il README, accanto al file, dice perché:');
quote(note);

check('engagement_rate NON è nel file', !columns.includes('engagement_rate'), columns.join(','));
check('saves, shares, reach nemmeno', !['saves', 'shares', 'reach'].some((c) => columns.includes(c)), columns.join(','));
check('likes/views/comments — che ci sono davvero — restano', ['likes', 'views', 'comments'].every((c) => columns.includes(c)), columns.join(','));
check('le colonne non-metrica non si toccano mai', ['published_at', 'platform', 'source', 'chars', 'url'].every((c) => columns.includes(c)), columns.join(','));
check('il README nomina le colonne assenti e dice che non sono zeri', /non sono zeri, sono assenti/.test(note) && note.includes('engagement_rate'), note);

// ── la conseguenza, in numeri: cosa faceva lo script della VM.
say('');
rule();
say('   La conseguenza, in numeri. Lo script che ha girato davvero nella sandbox faceva');
say('   `float(r[\'engagement_rate\'] or 0)` e ne prendeva la mediana:');

const leggiCsv = (csv: string) => {
  const [head, ...body] = csv.trim().split('\n');
  const cols = head.split(',');
  return body.map((line) => Object.fromEntries(line.split(',').map((v, i) => [cols[i], v])));
};
const mediana = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const prima = leggiCsv(toCsv(soloScrape, HISTORY_COLUMNS));
const medPrima = mediana(prima.map((r) => Number(r['engagement_rate'] || 0)));
say('');
say(`   PRIMA:  la colonna c'era, vuota → mediana engagement_rate = ${medPrima.toFixed(3)}`);
say('           riportata come misura, «con metodo citabile», su ogni piattaforma.');

const dopo = leggiCsv(toCsv(soloScrape, columns));
const chiaveAssente = !('engagement_rate' in dopo[0]);
say(`   ADESSO: la colonna non c'è → \`r['engagement_rate']\` alza KeyError, che è RUMOROSO.`);
say('           Lo script si ferma e dice cosa manca, invece di rispondere zero.');
check('prima la mediana usciva 0 (il bug, riprodotto)', medPrima === 0, String(medPrima));
check('adesso la chiave non esiste proprio → KeyError in pandas/csv.DictReader', chiaveAssente, JSON.stringify(Object.keys(dopo[0])));

// ── e la copertura parziale non si nasconde.
say('');
rule();
say('   Terzo caso: il brand che ha ENTRAMBE le fonti. La colonna resta — ma con la copertura scritta.');
const miste = [zernio(0), scrape(1), scrape(2)];
const parziale = describeColumns(miste, HISTORY_COLUMNS, METRICHE);
say('');
quote(toCsv(miste, parziale.columns).split('\n').slice(0, 4).join('\n'));
say('');
quote(parziale.note);
check('engagement_rate resta, perché una riga ce l\'ha', parziale.columns.includes('engagement_rate'), parziale.columns.join(','));
check('la copertura è dichiarata: 1/3', parziale.note.includes('engagement_rate 1/3'), parziale.note);
check('e dice di raggruppare per `source` prima di mediare', parziale.note.includes('source'), parziale.note);
check('reach resta fuori anche qui: nessuna delle due fonti lo porta', !parziale.columns.includes('reach'), parziale.columns.join(','));

// ── esito ──────────────────────────────────────────────────────────────────────────────────────
say('');
rule('━');
say(`   ESITO: ${failures === 0 ? 'tutto verde' : `${failures} controlli ROTTI`}`);
say(`   Richieste HTTP tentate dal codice: ${seen.length} — tutte ${[...new Set(seen.map((s) => s.method))].join('/')}, tutte intercettate, nessuna spedita.`);
say(`   Righe scritte nel database: 0 (il client di servizio non si costruisce, §0).`);
rule('━');
say('');
process.exit(failures === 0 ? 0 : 1);
