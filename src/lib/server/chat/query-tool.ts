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
 * LA CECITÀ, DICHIARATA: `query` funziona solo dove esiste una sessione utente, cioè sui turni
 * interattivi. Nella coda e sulla superficie CLI il client è la service role, che scavalcherebbe la
 * RLS e leggerebbe OGNI brand: lì si RIFIUTA e il rifiuto spiega perché. Un tool che «a volte legge
 * tutto» sarebbe peggio di un tool che a volte non c'è.
 */
import { tool } from 'ai';
import { POST_STATUS_VOCABULARY } from '$lib/server/chat/post-status';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logAiCall } from '$lib/server/ai-log';

/** Righe di default per chiamata quando il modello non chiede un `limit`. */
export const QUERY_DEFAULT_ROWS = 20;
/** Tetto duro sulle righe: nemmeno chiedendolo se ne ottengono di più. */
export const QUERY_MAX_ROWS = 100;
/**
 * Tetto sui caratteri del risultato. `select *` su `brand_documents` ha righe da centinaia di
 * migliaia di caratteri l'una: senza questo, UNA chiamata riempie la finestra di contesto e il
 * turno muore. Il taglio è per riga intera — mezza riga di JSON non è un dato, è spazzatura.
 */
export const QUERY_MAX_CHARS = 20_000;
/**
 * Tetto su UN SINGOLO valore: quello per riga non basta, perché una colonna sola può arrivare a
 * centinaia di migliaia di caratteri e la prima riga si prende sempre (o `select *` su quella tabella
 * non tornerebbe mai niente). Il taglio SI DICHIARA per nome di colonna: il modello deve sapere che
 * quel campo l'ha visto monco, o costruirà una risposta su un testo che crede completo.
 */
export const QUERY_MAX_VALUE_CHARS = 2_000;
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
 * Le tabelle di `public`, lette da `pg_tables`. Qui e NON nella descrizione del tool per costo: nella
 * descrizione si pagherebbero a ogni step di ogni turno di ogni agente, per una lista che serve una
 * volta a conversazione. Qui si pagano solo quando il modello chiama `query` senza `table`.
 *
 * ponytail: lista statica, può invecchiare di una tabella. Non è cieca — PostgREST risponde PGRST205
 * con «Perhaps you meant…» su un nome quasi giusto e `query` passa il suggerimento al modello. Il
 * giorno in cui invecchia sul serio si genera da `pg_tables` in un passo di build.
 *
 * Nomi tolti perché nessuna migration li crea: `asset_projects`, `asset_project_files` (retaggio
 * dell'editor Remotion, frontend rimosso in 5e725399) e `mcp_logs`. In produzione esistono ancora,
 * con 1, 3 e 0 righe; da un'installazione da zero non esistono affatto, e l'agente ci sbatteva.
 */
const TABLES =
  'ad_campaigns ad_metrics admins ads_remix_briefs agent_notifications agent_runs agent_sessions ' +
  'agent_templates ai_calls api_keys app_flags article_views ' +
  'benchmark_runs blog_authors blog_categories blog_integrations blog_month_jobs blog_tags ' +
  'brand_app_connections brand_article_tags brand_article_versions brand_articles ' +
  'brand_backlink_opportunities brand_backlink_orders brand_backlink_placements ' +
  'brand_community_profiles brand_crawl_runs brand_demo_accounts brand_design_templates ' +
  'brand_doc_chunks brand_documents brand_field_posts brand_geo_artifacts brand_geo_audits ' +
  'brand_geo_opportunities brand_geo_prompts brand_gsc_connections brand_gsc_metrics ' +
  'brand_internal_links brand_invites brand_job_optouts brand_kit brand_knowledge_edges ' +
  'brand_knowledge_sources brand_market_references brand_media brand_members brand_memory ' +
  'brand_news_items brand_news_sources brand_pages brand_rank_snapshots ' +
  'brand_seo_keyword_strategy brand_seo_plans brand_site_pages brand_sites brand_social_handles ' +
  'brand_strategy brand_tracked_keywords brand_triggers brand_usage brand_visual_insights ' +
  'brand_webhooks brands chat_artifacts chat_goal_events chat_goals chat_jobs chat_messages ' +
  'chat_thread_reads chat_threads competitors content_plans content_quality_samples credit_grants ' +
  'custom_agent_schedules custom_agent_thread_runs custom_agents disruptive_ideas editorial_plans ' +
  'expert_requests graphic_designs gtm_plans incidents lead_outcomes lifecycle_emails ' +
  'loop_cursors loop_ticks market_account_baselines market_account_fetch_attempts ' +
  'market_harvest_errors market_harvest_runs market_post_observations market_posts ' +
  'market_teardowns market_video_analyses media_generator_items ' +
  'media_generator_prompts motion_craft_scores motion_reference_specs motion_video_prompts ' +
  'motion_video_references motion_videos onboarding_drafts onboarding_errors onboarding_jobs ' +
  'onboarding_step_jobs org_members organizations people post_links post_revisions ' +
  'post_visual_meta posts products profiles publish_logs push_subscriptions radar_feed_cache ' +
  'radar_jobs radar_searches referral_codes referrals rubrics scheduler_runs scrapecreators_cache ' +
  'social_accounts social_post_history social_thumb_cache talent_views talents tool_usage ' +
  'video_renders video_requests video_reviews waitlist webhook_deliveries zernio_ad_accounts';

export const QUERY_TABLE_LIST = TABLES.split(' ');

/** Il rifiuto quando manca la sessione utente. Esportato perché il test lo verifica per contenuto. */
export const NO_SESSION_ERROR = {
  error: 'no_user_session',
  message:
    '`query` reads the database AS THIS USER: anon key + their JWT, so Postgres RLS grants the agent exactly the user permissions and nothing more. This turn has no user session — it is a background/queue turn or a CLI API-key request, and both hold a service-role client that would bypass RLS and read EVERY brand in the database. Refusing to read with it.',
  fix: 'Use the purpose-built read tools (read_posts, read_brand_kit, read_plan, …) — they scope to this brand by construction. `query` works on the interactive chat surface.'
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
      return 'No foreign-key relationship there. `query` reads ONE table at a time — no embeds, no joins. Read the two tables separately and match the ids yourself.';
    case 'PGRST100':
      return 'PostgREST could not parse the filter. `op` must be one of: ' + OPS.join(', ') + '.';
    default:
      return `Unrecognized database error. Call query with no table to see what exists. Raw: ${message}`;
  }
}

type Filter = { column: string; op: Op; value: string | number | boolean | null | Array<string | number> };

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

/**
 * Taglia i valori troppo lunghi e dice QUALI. Ritorna la riga nuova e i nomi delle colonne tagliate.
 */
export function trimRow(row: Record<string, unknown>): {
  row: Record<string, unknown>;
  cut: string[];
} {
  const cut: string[] = [];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    // Anche jsonb/array: si misurano serializzati, che è come pesano nel contesto.
    const text = typeof v === 'string' ? v : v && typeof v === 'object' ? JSON.stringify(v) : null;
    if (text !== null && text.length > QUERY_MAX_VALUE_CHARS) {
      out[k] = text.slice(0, QUERY_MAX_VALUE_CHARS) + `… [cut, ${text.length} chars total]`;
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
        `CAPS, always reported back to you: ${QUERY_DEFAULT_ROWS} rows by default, ${QUERY_MAX_ROWS} max, ${QUERY_MAX_CHARS} chars max, and the database itself kills any statement over ${DB_STATEMENT_TIMEOUT_MS / 1000}s.`,
        '',
        `RLS spans every brand this user belongs to, not just the current one. To stay on the brand in this conversation, filter on it: where: [{ column: "brand_id", op: "eq", value: "${brandId}" }].`,
        '',
        `VOCABOLARIO — ${POST_STATUS_VOCABULARY}`,
        '',
        'Example — the five most recent published posts of this brand:',
        `query({ table: "posts", columns: ["id","caption","status","published_at"], where: [{column:"brand_id",op:"eq",value:"${brandId}"},{column:"status",op:"eq",value:"published"}], order: {column:"published_at",ascending:false}, limit: 5 })`,
        '',
        'Prefer the purpose-built tools (read_posts, read_brand_kit, …) for the usual questions — they are cheaper and already shaped. Reach for `query` when the answer needs a table nothing else exposes, or a count, or a join you do by hand.'
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
              value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))])
            })
          )
          .optional()
          .describe('Filters, ANDed together. `in` takes an array; `is` takes null/true/false.'),
        order: z
          .object({ column: z.string(), ascending: z.boolean().optional() })
          .optional()
          .describe('Sort. Defaults to descending when `ascending` is omitted.'),
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
        order?: { column: string; ascending?: boolean };
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

          // Nessuna sessione utente, nessuna lettura. `getSession()` è locale (cookie → JWT), nessun
          // giro di rete; `createAdminClient()` nasce con persistSession:false, quindi la service role
          // non ha mai una sessione e la coda cade qui per costruzione, non per convenzione.
        const session = await supabase.auth
          .getSession()
          .then((r) => r.data?.session ?? null)
          .catch(() => null);
        if (!session?.access_token) return finish({ ...NO_SESSION_ERROR }, 'db_query:refused:no_session');

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
        if (input.order && !IDENT.test(String(input.order.column).trim())) {
          return finish(
            { error: 'not_an_identifier', message: `"${input.order.column}" is not a column name.`, fix: 'Order by a bare column name.' },
            'db_query:refused:bad_order'
          );
        }

        const limit = Math.min(input.limit ?? QUERY_DEFAULT_ROWS, QUERY_MAX_ROWS);
        const cols = input.columns?.length ? input.columns.map((c) => c.trim()).join(',') : '*';

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
          let q = supabase.from(table).select(selectCols, { count: 'estimated' });
          for (const f of filtriModello) q = q.filter(f.column.trim(), f.op, wireValue(f.op, f.value));
          if (withBrand) q = q.filter('brand_id', 'eq', brandId);
          if (input.order) q = q.order(input.order.column.trim(), { ascending: input.order.ascending ?? false });
          return q.limit(limit).abortSignal(AbortSignal.timeout(QUERY_ABORT_MS));
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
              ...(input.order ? [String(input.order.column).trim()] : [])
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
            ({ data, error, count } = await run('*', forzaBrand));
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
        // Taglio per riga intera. Mezza riga di JSON non è un dato più piccolo, è un dato rotto.
        const rows: Array<Record<string, unknown>> = [];
        const cutCols = new Set<string>();
        let chars = 0;
        for (const r of all) {
          const { row, cut } = trimRow(r);
          const size = JSON.stringify(row).length;
          if (chars + size > QUERY_MAX_CHARS && rows.length > 0) break;
          rows.push(row);
          for (const c of cut) cutCols.add(c);
          chars += size;
        }
        const total = count ?? all.length;

        // NIENTE STATO SILENZIOSO: ogni tetto che ha morso lo dice qui, in chiaro, nel risultato.
        const limits: string[] = [];
        limits.push(
          `${rows.length} rows of ~${total} — narrow with a where filter or raise limit (max ${QUERY_MAX_ROWS}).`
        );
        if (rows.length < all.length) {
          limits.push(
            `Cut at ${QUERY_MAX_CHARS} chars: ${rows.length} of the ${all.length} rows the database returned are shown. Ask for fewer columns.`
          );
        }
        if (cutCols.size) {
          limits.push(
            `Values cut at ${QUERY_MAX_VALUE_CHARS} chars in: ${[...cutCols].join(', ')} — you are NOT seeing those fields in full. Read one row with read_file/the dedicated tool if you need the whole text.`
          );
        }
        if (total > all.length) {
          limits.push(`Row total is the planner estimate, not an exact count.`);
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
