/**
 * `query` — LETTURA DIRETTA DEL DATABASE, CON I PERMESSI DELL'UTENTE E DI NESSUN ALTRO.
 *
 * 1. LA CHIAVE ANON DA SOLA VEDE ZERO RIGHE: tutte le tabelle di `public` hanno RLS e nessuna policy
 *    di dati-di-brand è aperta ad `anon`. Serve anon PIÙ il JWT dell'utente, cioè quello che manda il
 *    browser — e allora la proprietà è esatta e non approssimata: l'agente non può leggere niente che
 *    l'utente non potrebbe leggere aprendo l'app. Lo stesso permesso, imposto da Postgres.
 *
 * 2. LA SOLA LETTURA NON È CONTROLLATA, È INESPRIMIBILE. Qui non c'è nessuna stringa SQL: `query`
 *    parla PostgREST (`.from(t).select(cols)` = una GET), quindi non esiste il posto dove infilare
 *    una scrittura. Le forme mascherate (`with x as (insert …) select`, `select … into`, una funzione
 *    `security definer`) non vengono rifiutate: non si possono scrivere. E `.rpc()` è escluso di
 *    proposito — decine di funzioni `SECURITY DEFINER` sono eseguibili da `authenticated`, fra cui
 *    una che manda email: montarlo rimetterebbe dentro dalla finestra tutto il resto.
 *
 * 3. IL TIMEOUT È DEL DATABASE (`statement_timeout` sul ruolo, 8s) e vale anche se questo file
 *    sparisse. Qui si DICHIARA, e si aggiunge solo il pezzo che il database non copre: una
 *    connessione HTTP appesa senza nessuna query che gira (`AbortSignal.timeout`).
 *
 * IL CONFINE, DICHIARATO: `query` funziona dove il client porta i permessi dell'utente, e si RIFIUTA
 * dove porta la service role — nella coda e sul percorso a chiave API. Un tool che «a volte legge
 * tutto» sarebbe peggio di un tool che a volte non c'è.
 *
 * Il confine non si indovina guardando il client: lo dichiara chi lo costruisce (`isRlsScoped`,
 * `$lib/server/rls-client`). Prima si guardava `auth.getSession()`, che sembra la stessa domanda e
 * non lo è: sul percorso API il client nasce con i cookie a vuoto, quindi è senza sessione pur
 * essendo perfettamente scoped, e il cancello chiudeva la porta ai JWT di CLI e MCP — 46 rifiuti in
 * produzione in dodici giorni — mentre avrebbe fatto passare una service role che una sessione ce
 * l'avesse avuta.
 */
import { tool } from 'ai';
import { POST_STATUS_VOCABULARY } from '$lib/server/chat/post-status';
import { QUERY_TABLES } from '@anomalia/api-contracts';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isRlsScoped } from '$lib/server/rls-client';
import { logAiCall } from '$lib/server/ai-log';

/** Righe di default per chiamata quando il modello non chiede un `limit`. */
export const QUERY_DEFAULT_ROWS = 20;
/**
 * Tetto duro sulle righe. 200 e non 100 perché `list_media` ne serviva 200 e `list_posts` 50: un
 * tetto sotto la lettura che sostituisce non è un tetto, è una perdita.
 */
export const QUERY_MAX_ROWS = 200;
/**
 * Tetto sui caratteri del risultato. `select *` su `brand_documents` ha righe da centinaia di
 * migliaia di caratteri l'una: senza questo, UNA chiamata riempie la finestra di contesto e il
 * turno muore. Il taglio è per riga intera — mezza riga di JSON non è un dato, è spazzatura.
 *
 * 20.000 → 60.000: a 20.000 le 50 righe che `list_posts` restituiva ne tornavano nove, e da lì è
 * nata la conclusione sbagliata che il tool non si potesse togliere. Il tetto era nostro.
 *
 * 60.000 è misurato, non scelto: la risposta di `list_posts` — 50 post con le loro 17 colonne e
 * caption vere — pesa 45.781 caratteri contro il database locale. Il tetto sta sopra quel numero
 * con margine, perché è esattamente il costo che il tool ritirato aveva già. È un SOFFITTO, non un
 * default: con le colonne nominate una lettura normale ne usa una frazione, e quando morde lo dice
 * e dà l'offset per riprendere.
 */
export const QUERY_MAX_CHARS = 60_000;
/**
 * Tetto su UN SINGOLO valore quando le righe sono TANTE: una colonna sola può arrivare a centinaia
 * di migliaia di caratteri e la prima riga si prende sempre (o `select *` su quella tabella non
 * tornerebbe mai niente). Il taglio SI DICHIARA per nome di colonna: il modello deve sapere che
 * quel campo l'ha visto monco, o costruirà una risposta su un testo che crede completo.
 *
 * UNA riga sola è un documento, non una tabella: lì il tetto per valore non si applica, perché
 * `get_article` esisteva per leggere un articolo INTERO e riscriverlo, e un corpo tagliato a 2.000
 * caratteri riscritto sopra l'originale è la peggiore delle perdite — silenziosa e distruttiva.
 * Il tetto sui caratteri totali continua a valere: il contesto non può esplodere comunque.
 */
export const QUERY_MAX_VALUE_CHARS = 2_000;
/**
 * Quanto può costare UNA riga letta come documento (`limit: 1`). Sta sotto `QUERY_MAX_CHARS` con
 * margine perché la riga porta anche le altre colonne e la nota del taglio: un documento che
 * sfonda il budget totale sarebbe di nuovo un troncamento non dichiarato, dall'altro lato.
 */
export const QUERY_MAX_DOC_CHARS = 40_000;
/**
 * Il database molla da solo a 8s (`statement_timeout` sul ruolo `authenticated`). Questo è solo il
 * guinzaglio sulla connessione HTTP, per il caso in cui nessuna query stia girando e la risposta
 * comunque non arrivi. Volutamente PIÙ LUNGO di 8s, così il 57014 del database arriva al modello
 * come un errore che insegna invece che come un abort muto.
 */
export const QUERY_ABORT_MS = 12_000;
/** Verificato su `pg_roles`: `authenticated` → statement_timeout=8s. Dichiarato, non imposto qui. */
export const DB_STATEMENT_TIMEOUT_MS = 8_000;

/**
 * Un identificatore Postgres non virgolettato, e nient'altro: è il terzo posto in cui vive la regola
 * (gli altri due sono la descrizione del tool e il suo esempio). Un tentativo di scrivere SQL dentro
 * un nome di tabella o di colonna non passa di qui, e non parte nessuna richiesta di rete.
 */
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Gli operatori di filtro PostgREST che accettiamo. Whitelist e non blacklist: un operatore che
 * non conosciamo non arriva alla rete.
 */
const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'cs', 'cd'] as const;
type Op = (typeof OPS)[number];

/**
 * Le tabelle di `public` che `query` può nominare. GENERATA dalle migrazioni, mai battuta a mano:
 * la lista scritta a mano era già invecchiata di 16 nomi — `thread_events`, `agent_kit_runs`,
 * `post_verdicts`, `video_reviews` fra gli altri — e una lista che invecchia non confonde soltanto,
 * su MCP RIFIUTA una tabella valida prima che la richiesta parta.
 *
 * Dalle migrazioni e non dal catalogo di produzione, perché la domanda giusta è «questa tabella
 * esiste anche da un'installazione da zero?»: in produzione sopravvivono nomi che nessuna
 * migrazione crea, e generarli dentro rimetterebbe l'agente a sbattere dove era già sbattuto.
 * La stessa regola tiene fuori i backup, senza doverli elencare.
 */
export const QUERY_TABLE_LIST = QUERY_TABLES.split(' ');

/** Il rifiuto quando il client non porta i permessi dell'utente. Il test lo verifica per contenuto. */
export const NO_SESSION_ERROR = {
  error: 'no_user_session',
  message:
    '`query` reads the database AS THIS USER: anon key + their JWT, so Postgres RLS grants the agent exactly the user permissions and nothing more. This client is not user-scoped — it is a background/queue turn or a CLI API-key request, and both hold a service-role client (`bypassrls=true`) that would read EVERY brand in the database. Refusing to read with it. An API key is not promoted to a user session on purpose: a key carries `permissions.brand_ids`, often narrower than the brands its owner belongs to, and RLS cannot see that restriction — minting a session for it would silently widen a deliberately narrow key.',
  fix: 'Use this surface\'s own read tools — there is one per subject, and each scopes to this brand by construction. Or come back as yourself: `query` reads wherever the caller carries their own session — the app, `anomalia login`, and MCP.'
} as const;

/**
 * Errori PostgREST → errore + COSA FARE. Un errore SQL nudo dice a un modello che ha sbagliato e non
 * come si fa a non sbagliare, quindi riprova uguale.
 */
export function explainDbError(code: string | undefined, message: string, hint?: string | null): string {
  switch (code) {
    case 'PGRST205':
        // Il suggerimento di PostgREST vale più di qualunque cosa possiamo scrivere noi: passa per primo.
      return `${hint ? hint + '. ' : ''}Call query with no table to list every table you can name.`;
    case '42703':
      return 'That column does not exist. Call query with just the table (no columns) to get one real row back — its keys ARE the column list.';
    case '42501':
      return 'RLS denied this read. You can only see rows belonging to brands this user is a member of; there is no way around it and nothing to retry. Pick a table tied to this brand.';
    case '57014':
      return `The database gave up: statement_timeout is ${DB_STATEMENT_TIMEOUT_MS / 1000}s on this role and the query took longer. Add a where filter on an indexed column (brand_id, created_at), lower the limit, or select fewer columns.`;
    case 'PGRST200':
      return 'No foreign-key relationship between those two tables, so `embed` cannot reach it — embedding follows declared foreign keys only. Read the second table with its own call and match the ids yourself.';
    case 'PGRST100':
      return 'PostgREST could not parse the filter. `op` must be one of: ' + OPS.join(', ') + '.';
    default:
      return `Unrecognized database error. Call query with no table to see what exists. Raw: ${message}`;
  }
}

type Filter = {
  column: string;
  op: Op;
  value: string | number | boolean | null | Array<string | number>;
  negate?: boolean;
};
type Order = { column: string; ascending?: boolean; nullsFirst?: boolean };
type Embed = { table: string; columns?: string[] };

/**
 * `in` vuole `(a,b,c)` sul filo. Gli altri operatori vogliono lo scalare così com'è.
 * `is` vuole la parola `null`/`true`/`false`, non il valore.
 */
function wireValue(op: Op, value: Filter['value']): string {
  if (op === 'in') {
    const items = Array.isArray(value) ? value : [value as string | number];
    return `(${items.map((v) => String(v)).join(',')})`;
  }
  if (value === null) return 'null';
  return String(value);
}

const wireOp = (f: Filter): string => (f.negate ? `not.${f.op}` : f.op);

/** `[{table:'blog_categories',columns:['name']}]` → `blog_categories(name)`. Solo identificatori. */
const wireEmbed = (e: Embed): string =>
  `${e.table.trim()}(${e.columns?.length ? e.columns.map((c) => c.trim()).join(',') : '*'})`;

const asList = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/**
 * Taglia i valori troppo lunghi e dice QUALI. Ritorna la riga nuova e i nomi delle colonne tagliate.
 */
export function trimRow(
  row: Record<string, unknown>,
  cap: number = QUERY_MAX_VALUE_CHARS
): {
  row: Record<string, unknown>;
  cut: string[];
} {
  const cut: string[] = [];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    // Anche jsonb/array: si misurano serializzati, che è come pesano nel contesto.
    const text = typeof v === 'string' ? v : v && typeof v === 'object' ? JSON.stringify(v) : null;
    if (text !== null && text.length > cap) {
      out[k] = text.slice(0, cap) + `… [cut, ${text.length} chars total]`;
      cut.push(k);
    } else out[k] = v;
  }
  return { row: out, cut };
}

export type QueryToolDeps = {
  supabase: SupabaseClient;
  brandId: string;
  userId?: string;
  threadId?: string;
};

export function createQueryTool({ supabase, brandId, userId, threadId }: QueryToolDeps) {
  return {
    query: tool({
      description: [
        'Read ANY table in the database directly, as this user.',
        '',
        'It runs with the anon key plus the user JWT, so Postgres RLS gives you exactly what this user would see in the app — no more, no less. There is no SQL: you name a table, columns and filters, and it issues one PostgREST read. That is why there is no way to write, no CTE, no `select into`, no function call — a write has nowhere to go here.',
        '',
        'DISCOVERY: call with no `table` to get every table name. Call with only `table` to get real rows back with all columns — the keys of a row ARE the schema.',
        '',
        'NAME THE COLUMNS YOU NEED. Without `columns` every column comes back, the character cap then drops whole rows to fit, and you get a short answer to a long question. Five named columns return all the rows; `*` returns a fraction of them.',
        '',
        `CAPS, and every one that bites is named in \`limits\` on the way back: ${QUERY_DEFAULT_ROWS} rows by default, ${QUERY_MAX_ROWS} max, ${QUERY_MAX_CHARS} chars max, and the database kills any statement over ${DB_STATEMENT_TIMEOUT_MS / 1000}s. When rows were dropped, \`limits\` gives you the \`offset\` that resumes exactly where it stopped — nothing is unreachable, it is only on the next page.`,
        '',
        `RLS spans every brand this user belongs to, not just the current one. To stay on the brand in this conversation, filter on it: where: [{ column: "brand_id", op: "eq", value: "${brandId}" }].`,
        '',
        `VOCABOLARIO — ${POST_STATUS_VOCABULARY}`,
        '',
        'Examples:',
        `· latest published posts — query({ table: "posts", columns: ["id","caption","status","published_at"], where: [{column:"status",op:"eq",value:"published"}], order: [{column:"published_at",ascending:false}], limit: 50 })`,
        '· how many are waiting — query({ table: "posts", columns: ["id"], where: [{column:"status",op:"eq",value:"pending_user"}], count: "exact", limit: 1 }) → read `total`',
        '· only rows where a column is set — { column: "scheduled_for", op: "is", value: null, negate: true }',
        '· an article with its category and author — query({ table: "brand_articles", columns: ["id","title","body_md"], where:[{column:"id",op:"eq",value:"…"}], embed: [{table:"blog_categories",columns:["name"]},{table:"blog_authors",columns:["name"]}], limit: 1 })',
        '',
        'One row is a document: with `limit: 1` long text comes back whole, so an article can be read and rewritten. With many rows long values are cut at 2,000 chars and `limits` names the columns it cut.'
      ].join('\n'),
      inputSchema: z.object({
        table: z
          .string()
          .optional()
          .describe('Table name. Omit to list every table instead of reading one.'),
        columns: z
          .array(z.string())
          .optional()
          .describe('Column names. Omit for all columns — which is also how you discover them.'),
        where: z
          .array(
            z.object({
              column: z.string(),
              op: z.enum(OPS),
              value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))]),
              negate: z.boolean().optional().describe('Invert this one filter: `is null` becomes `is not null`.')
            })
          )
          .optional()
          .describe('Filters, ANDed together. `in` takes an array; `is` takes null/true/false.'),
        order: z
          .union([
            z.object({ column: z.string(), ascending: z.boolean().optional(), nullsFirst: z.boolean().optional() }),
            z.array(z.object({ column: z.string(), ascending: z.boolean().optional(), nullsFirst: z.boolean().optional() }))
          ])
          .optional()
          .describe('Sort, one column or several in order. Descending unless `ascending` is true.'),
        embed: z
          .array(z.object({ table: z.string(), columns: z.array(z.string()).optional() }))
          .optional()
          .describe('Related tables to bring along, followed through their foreign key. RLS applies to each one.'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Rows to skip. This is the next page: `limits` tells you the offset to resume at.'),
        count: z
          .enum(['estimated', 'exact'])
          .optional()
          .describe('`exact` counts the matching rows for real — ask for it when the number IS the answer.'),
        limit: z.number().int().positive().optional().describe(`Rows to return. Max ${QUERY_MAX_ROWS}.`)
      })
          // `.strict()` non è pedanteria: senza, zod scarta in SILENZIO una chiave che non conosce. Un
          // `filters:` invece di `where:` faceva sparire il filtro, la lettura diventava «tutte le
          // righe» e il tool rispondeva ok.
        .strict(),
      execute: async (input: {
        table?: string;
        columns?: string[];
        where?: Filter[];
        order?: Order | Order[];
        embed?: Embed[];
        offset?: number;
        count?: 'estimated' | 'exact';
        limit?: number;
      }) => {
        const t0 = Date.now();
        const finish = <T extends Record<string, unknown>>(out: T, note: string): T => {
            // provider 'internal' = EVENTO dell'agente: cost_usd resta null, quindi non tocca crediti
            // né rate limit. La riga c'è anche sui RIFIUTI — un tool sempre respinto deve risultare
            // usato e respinto, non silenzioso, o la conclusione è «non lo chiama nessuno».
          logAiCall({
            label: 'db_query',
            provider: 'internal',
            ms: Date.now() - t0,
            ok: !('error' in out),
            error: 'error' in out ? String(out.error) : undefined,
            context: note.slice(0, 400),
            brandId,
            userId: userId || undefined,
            threadId
          });
          return out;
        };

          // Client non marchiato, nessuna lettura. Il marchio lo mette chi COSTRUISCE il client con
          // la chiave anon (`hooks.server.ts` per il browser, `cli-auth.ts` per il percorso JWT),
          // che è l'unico a sapere quale dei due ha in mano; la service role non lo riceve mai. Il
          // default è il rifiuto, quindi un percorso nuovo resta chiuso finché non si dichiara.
        if (!isRlsScoped(supabase)) return finish({ ...NO_SESSION_ERROR }, 'db_query:refused:no_session');

        if (!input.table) {
          return finish(
            {
              tables: QUERY_TABLE_LIST,
              count: QUERY_TABLE_LIST.length,
              note: `Every table in the public schema. RLS still decides which rows you see — most are scoped to the brands this user belongs to. Read one with query({ table: "<name>" }); the keys of the rows you get back are its columns. This list was captured from the database and can lag a newly added table by a deploy.`
            },
            'db_query:tables'
          );
        }

          // Terzo posto in cui vive la regola: il controllo che rifiuta l'imitazione.
        const table = input.table.trim();
        if (!IDENT.test(table)) {
          return finish(
            {
              error: 'not_an_identifier',
              message: `"${table}" is not a table name. \`query\` takes no SQL at all — there is no string here that becomes SQL, so an INSERT, a \`with … as (insert …)\`, a \`select … into\` or an RPC call has nowhere to go. Give a bare table name.`,
              fix: 'Call query with no table to see the valid names.'
            },
            'db_query:refused:bad_table'
          );
        }
        const bad = (input.columns ?? []).find((c) => c !== '*' && !IDENT.test(String(c).trim()));
        if (bad !== undefined) {
          return finish(
            {
              error: 'not_an_identifier',
              message: `"${bad}" is not a column name. Columns are bare identifiers — no expressions, no functions, no subqueries, no SQL.`,
              fix: `Call query({ table: "${table}" }) with no columns to see what this table actually has.`
            },
            'db_query:refused:bad_column'
          );
        }
        const badFilter = (input.where ?? []).find((f) => !IDENT.test(String(f.column).trim()));
        if (badFilter) {
          return finish(
            { error: 'not_an_identifier', message: `"${badFilter.column}" is not a column name.`, fix: 'Filter columns are bare identifiers.' },
            'db_query:refused:bad_filter'
          );
        }
        const orders = asList(input.order);
        const badOrder = orders.find((o) => !IDENT.test(String(o.column).trim()));
        if (badOrder) {
          return finish(
            { error: 'not_an_identifier', message: `"${badOrder.column}" is not a column name.`, fix: 'Order by a bare column name.' },
            'db_query:refused:bad_order'
          );
        }
        const embeds = input.embed ?? [];
        const badEmbed = embeds.find(
          (e) => !IDENT.test(String(e.table).trim()) || (e.columns ?? []).some((c) => !IDENT.test(String(c).trim()))
        );
        if (badEmbed) {
          return finish(
            {
              error: 'not_an_identifier',
              message: `"${badEmbed.table}" and its columns must be bare identifiers — an embed names a table, it does not carry an expression.`,
              fix: 'Call query with no table to see the valid names.'
            },
            'db_query:refused:bad_embed'
          );
        }

        const limit = Math.min(input.limit ?? QUERY_DEFAULT_ROWS, QUERY_MAX_ROWS);
        const offset = Math.max(input.offset ?? 0, 0);
        const countMode = input.count ?? 'estimated';
        const own = input.columns?.length ? input.columns.map((c) => c.trim()).join(',') : '*';
        const withEmbeds = (base: string) => [base, ...embeds.map(wireEmbed)].join(',');
        const cols = withEmbeds(own);

        // Da qui in giù SOLO `.select()`. Nessun .insert/.update/.upsert/.delete/.rpc in questo file,
        // e un test lo verifica leggendo il sorgente.
        // IL CONFINE DEL BRAND SI IMPONE, NON SI RACCOMANDA: la RLS copre ogni brand a cui l'utente
        // appartiene, non solo quello della conversazione, e «quante bozze?» rispondeva con la somma
        // di tutti i brand — per un'agenzia è una lettura che attraversa i clienti. Se il modello ha
        // già filtrato su brand_id lo lasciamo, altrimenti lo aggiungiamo noi; su una tabella che non
        // ha quella colonna PostgREST dà 42703 e si riprova senza (sotto).
        const filtriModello = input.where ?? [];
        const brandGiaFiltrato = filtriModello.some((f) => f.column.trim() === 'brand_id');
        let forzaBrand = !brandGiaFiltrato && Boolean(brandId);
        const run = (selectCols: string, withBrand: boolean) => {
          let q = supabase.from(table).select(selectCols, { count: countMode });
          for (const f of filtriModello) q = q.filter(f.column.trim(), wireOp(f), wireValue(f.op, f.value));
          if (withBrand) q = q.filter('brand_id', 'eq', brandId);
          for (const o of orders) {
            q = q.order(o.column.trim(), { ascending: o.ascending ?? false, nullsFirst: o.nullsFirst });
          }
          return q.range(offset, offset + limit - 1).abortSignal(AbortSignal.timeout(QUERY_ABORT_MS));
        };

        let { data, error, count } = await run(cols, forzaBrand);
        // Non tutte le tabelle hanno `brand_id` (utenti, tabelle di piattaforma): lì il filtro imposto
        // sopra dà 42703 e si riprova senza, con la RLS come unico confine.
        if (error && forzaBrand && error.code === '42703' && String(error.message).includes('brand_id')) {
          forzaBrand = false;
          ({ data, error, count } = await run(cols, false));
        }

        // ── LA COLONNA CHE NON ESISTE NON DEVE COSTARE UNO STEP ──────────────────────────────
        // `column posts.content does not exist` (42703) era rosso in quattro giri su quattro.
        // La descrizione DICE gia' come si scopre lo schema («chiama senza columns e le chiavi
        // della riga SONO le colonne»), e `explainDbError` lo ripete nel messaggio d'errore: il
        // modello continuava a indovinare lo stesso. Aggiungere un terzo paragrafo che dice la
        // stessa cosa una terza volta non e' un rimedio, e' la stessa scommessa rifatta.
        //
        // Allora lo schema non si SPIEGA: si va a prendere. Una riga con tutte le colonne E' lo
        // schema, e costa una GET con limit 1. Da li' due strade, e la differenza fra le due e'
        // quella fra aiutare e falsificare:
        //  - il nome sbagliato stava solo in `columns` → la lettura si rifa' con `*`. Il modello
        //    riceve i DATI che aveva chiesto (piu' colonne di quante ne voleva, mai meno) e in
        //    piu' i nomi veri. Nessuna semantica persa: un `select` piu' largo non cambia quali
        //    righe tornano.
        //  - il nome sbagliato stava in `where` o `order` → NON si ritenta. Togliere un filtro
        //    farebbe tornare righe che l'utente non ha chiesto e il tool direbbe «ok»: e'
        //    esattamente il difetto che `.strict()` e' stato messo li' a impedire. Si risponde
        //    con l'errore E l'elenco vero delle colonne, cosi' il giro dopo e' informato.
        // Se la tabella e' vuota la sonda non insegna niente e si cade sul vecchio errore.
        let schemaNote: string | null = null;
        if (error?.code === '42703') {
          const probe = await supabase
            .from(table)
            .select('*')
            .limit(1)
            .abortSignal(AbortSignal.timeout(QUERY_ABORT_MS));
          const sample = (probe.data ?? [])[0] as Record<string, unknown> | undefined;
          const available = sample ? Object.keys(sample) : [];
          if (available.length) {
            const usedInFilters = [
              ...filtriModello.map((f) => String(f.column).trim()),
              ...orders.map((o) => String(o.column).trim())
            ];
            const badFilterCol = usedInFilters.find((c) => !available.includes(c));
            if (badFilterCol) {
              return finish(
                {
                  error: error.code,
                  message: error.message,
                  fix: `"${badFilterCol}" is not a column of ${table} — it is filtered/ordered on, so nothing was retried: dropping it would have returned rows you did not ask for. Real columns: ${available.join(', ')}.`,
                  columns_available: available
                },
                `db_query:${table}:err:42703`
              );
            }
            const missing = (input.columns ?? [])
              .map((c) => String(c).trim())
              .filter((c) => c !== '*' && !available.includes(c));
            ({ data, error, count } = await run(withEmbeds('*'), forzaBrand));
            if (!error) {
              schemaNote = `${missing.length ? `Column(s) ${missing.join(', ')} do not exist on ${table}` : 'A column you named does not exist'} — the read was redone with EVERY column instead, so these rows are wider than you asked for. Real columns: ${available.join(', ')}.`;
            }
          }
        }

        if (error) {
          return finish(
            {
              error: error.code || 'db_error',
              message: error.message,
              details: error.details ?? undefined,
              fix: explainDbError(error.code, error.message, error.hint)
            },
            `db_query:${table}:err:${error.code ?? '?'}`
          );
        }

        const all = (data ?? []) as unknown as Array<Record<string, unknown>>;
        const valueCap = all.length === 1 ? QUERY_MAX_DOC_CHARS : QUERY_MAX_VALUE_CHARS;
        // Taglio per riga intera. Mezza riga di JSON non è un dato più piccolo, è un dato rotto.
        const rows: Array<Record<string, unknown>> = [];
        const cutCols = new Set<string>();
        let chars = 0;
        for (const r of all) {
          const { row, cut } = trimRow(r, valueCap);
          const size = JSON.stringify(row).length;
          if (chars + size > QUERY_MAX_CHARS && rows.length > 0) break;
          rows.push(row);
          for (const c of cut) cutCols.add(c);
          chars += size;
        }
        const total = count ?? all.length;
        const exact = countMode === 'exact';

        // NIENTE STATO SILENZIOSO: ogni tetto che ha morso lo dice qui, in chiaro, nel risultato.
        const limits: string[] = [];
        limits.push(
          `${rows.length} rows${offset ? ` from offset ${offset}` : ''} of ${exact ? '' : '~'}${total} — narrow with a where filter or raise limit (max ${QUERY_MAX_ROWS}).`
        );
        // IL TRONCAMENTO NON È MUTO, E NON È UNA PERDITA: dice quante righe non ha mostrato e da
        // quale offset si riprende. Prima taceva, e nove righe su cinquanta sembravano cinquanta.
        if (rows.length < all.length) {
          limits.push(
            `Cut at ${QUERY_MAX_CHARS} chars: ${rows.length} of the ${all.length} rows the database returned are shown. Read the rest with offset: ${offset + rows.length}, or ask for fewer columns and they will all fit.`
          );
        } else if (total > offset + rows.length) {
          limits.push(`More rows follow: read them with offset: ${offset + rows.length}.`);
        }
        if (cutCols.size) {
          limits.push(
            `Values cut at ${valueCap} chars in: ${[...cutCols].join(', ')} — you are NOT seeing those fields in full. Read that single row again with limit: 1 and it comes back whole.`
          );
        }
        if (!exact && total > all.length) {
          limits.push(`Row total is the planner estimate — pass count: "exact" when the number is the answer.`);
        }
        if (schemaNote) limits.push(schemaNote);

        return finish(
          { table, rows, returned: rows.length, total, limits: limits.join(' ') },
          `db_query:${table}:cols=${input.columns?.length ?? 0}:where=${input.where?.length ?? 0}:rows=${rows.length}/${total}`
        );
      }
    })
  };
}
