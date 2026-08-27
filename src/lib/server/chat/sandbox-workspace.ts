/**
 * IL WORKSPACE: i dati del brand come file, dentro la sandbox.
 *
 * La domanda a cui questo file risponde è "se l'agente ha una sua macchina, gli mettiamo dentro i
 * dati del brand?". Sì — ma non un dump del database, e non una volta sola.
 *
 * ## Perché file e non tool
 *
 * L'agente ha già `read_posts`, `read_strategy`, `read_market_references`. Vanno benissimo per
 * "dimmi come sta andando". Vanno male per l'unica cosa che la sandbox aggiunge: **calcolare**.
 * Duecento righe di storico lette a colpi di tool sono duecento righe che occupano la finestra di
 * contesto e su cui il modello poi fa aritmetica a mente. Le stesse righe in `history.csv` sono un
 * `groupby` di tre righe di pandas, con il risultato esatto e il contesto ancora libero.
 *
 * Quindi la regola è: **CSV per quello che si conta, JSON per quello che si legge**.
 *
 * ## Perché riscritti a ogni run
 *
 * La sandbox è persistente (ci vive Chromium, vedi sandbox.ts) e la tentazione ovvia è lasciare lì
 * anche i dati. È esattamente l'errore da non fare: un agente che analizza lo storico di tre
 * settimane fa credendolo di oggi produce una raccomandazione sbagliata **con sicurezza**, e non
 * c'è modo di accorgersene leggendo il suo rapporto. Rigenerare costa qualche centinaio di
 * millisecondi di query. Lo scambio non è nemmeno vicino.
 *
 * ## Perché una selezione e non tutto
 *
 * Ogni tabella in più è superficie: byte che finiscono su una VM, e una riga di README che il
 * modello legge invece di lavorare. Qui stanno i dati su cui si fanno domande quantitative —
 * storico, post, piano, mercato, competitor, SEO — e basta. Il resto resta dietro ai tool.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { WORKSPACE_DIR } from '$lib/server/sandbox';
import { dedupeSocialHistory, type SocialHistoryRow } from '$lib/server/social-history-metrics';

export type WorkspaceFile = { path: string; content: string };

/** Tetti per file. Una sandbox non è un data warehouse: è il tavolo di lavoro di un turno. */
export const MAX_HISTORY_ROWS = 500;
export const MAX_POSTS = 200;
export const MAX_JSON_CHARS = 200_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/**
 * CSV con le regole vere: virgolette raddoppiate, campi con virgola/virgolette/a-capo quotati,
 * `null` come cella vuota. Un CSV fatto a mano che sbaglia l'escaping produce un file che pandas
 * legge senza errore e **con le colonne sbagliate**, che è il modo peggiore di fallire.
 */
export function toCsv(rows: AnyRec[], columns: string[]): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c])).join(','));
  return `${lines.join('\n')}\n`;
}

/** JSON leggibile, con un tetto: meglio un file troncato e dichiarato che una VM piena. */
export function toJson(value: unknown, max = MAX_JSON_CHARS): string {
  const s = JSON.stringify(value ?? null, null, 2);
  if (s.length <= max) return s;
  return JSON.stringify(
    { truncated: true, reason: `payload over ${max} chars — use the matching read_* tool for the full object`, preview: s.slice(0, max) },
    null,
    2
  );
}

/** Le metriche stanno in un JSON: qui diventano colonne, che è tutto il punto di avere un CSV. */
function metricColumns(m: AnyRec | null | undefined) {
  const met = (m ?? {}) as AnyRec;
  return {
    likes: met.likes ?? '',
    comments: met.comments ?? '',
    shares: met.shares ?? '',
    views: met.views ?? met.plays ?? '',
    saves: met.saves ?? '',
    reach: met.reach ?? '',
    engagement_rate: met.engagementRate ?? met.engagement_rate ?? ''
  };
}

const HISTORY_COLUMNS = [
  'published_at',
  'platform',
  // La colonna che mancava e senza la quale il file non è verificabile dalla VM: le due fonti
  // hanno metriche incompatibili, e senza `source` non c'è modo di accorgersene da dentro.
  'source',
  'likes',
  'comments',
  'shares',
  'views',
  'saves',
  'reach',
  'engagement_rate',
  'chars',
  'url',
  'content'
];

/** Le metriche: esistono solo se una fonte le porta. Vedi `describeColumns`. */
const HISTORY_METRIC_COLUMNS = ['likes', 'comments', 'shares', 'views', 'saves', 'reach', 'engagement_rate'] as const;

const POST_COLUMNS = ['id', 'status', 'platform', 'format', 'scheduled_for', 'created_at', 'chars', 'caption'];

/**
 * UNA COLONNA VUOTA NON È UNA COLONNA A ZERO.
 *
 * `social_post_history` ha due fonti con metriche incompatibili, misurato in produzione:
 * `engagementRate` e `saves` stanno su 376/376 righe `zernio` e su **0/3.131** righe
 * `scrapecreators`; `reach` su **0/3.507**, cioè su nessuna fonte e nessun brand; e 22 brand su 29
 * non hanno una sola riga `zernio`. Il CSV scriveva l'intestazione comunque, quindi uno script che
 * fa `float(r['engagement_rate'] or 0)` — quello di una run vera — restituiva **mediana 0,0 su
 * ogni piattaforma** e la riportava come misura, con metodo citabile. Dalla VM non c'era modo di
 * accorgersene: la colonna che l'avrebbe detto non era nel file.
 *
 * Quindi una colonna che NESSUNA riga valorizza non viene scritta: in pandas/`csv.DictReader`
 * leggerla alza `KeyError`, che è rumoroso, mentre una cella vuota diventa zero in silenzio. E una
 * colonna valorizzata solo da una parte delle righe si porta dietro la sua copertura, dichiarata
 * nel README accanto al file.
 */
export function describeColumns(
  rows: AnyRec[],
  columns: string[],
  optional: readonly string[]
): { columns: string[]; note: string } {
  const filled = (c: string) =>
    rows.reduce((n, r) => n + (r[c] === '' || r[c] === null || r[c] === undefined ? 0 : 1), 0);
  const kept: string[] = [];
  const missing: string[] = [];
  const partial: string[] = [];
  for (const c of columns) {
    if (!optional.includes(c)) {
      kept.push(c);
      continue;
    }
    const n = filled(c);
    if (n === 0) {
      missing.push(c);
      continue;
    }
    kept.push(c);
    if (n < rows.length) partial.push(`${c} ${n}/${rows.length}`);
  }
  const parts: string[] = [];
  if (missing.length)
    parts.push(`colonne NON scritte perché nessuna riga le porta (non sono zeri, sono assenti): ${missing.join(', ')}`);
  if (partial.length) parts.push(`valorizzate solo in parte, raggruppa per \`source\` prima di mediare: ${partial.join(', ')}`);
  return { columns: kept, note: parts.join(' — ') };
}

export type WorkspaceOptions = {
  /** Il Web hub è a pagamento: senza, i file SEO non esistono, come i tool. */
  webHubEnabled?: boolean;
  historyRows?: number;
  posts?: number;
};

/**
 * Costruisce i file del workspace. Ogni query è indipendente e fallisce da sola: un market
 * reference mancante non deve togliere all'agente lo storico.
 */
export async function buildBrandWorkspace(
  supabase: SupabaseClient,
  brandId: string,
  opts: WorkspaceOptions = {}
): Promise<WorkspaceFile[]> {
  const historyLimit = Math.min(opts.historyRows ?? MAX_HISTORY_ROWS, MAX_HISTORY_ROWS);
  const postLimit = Math.min(opts.posts ?? MAX_POSTS, MAX_POSTS);
  const files: WorkspaceFile[] = [];
  const present: string[] = [];
  const add = (name: string, content: string, note: string) => {
    files.push({ path: `${WORKSPACE_DIR}/${name}`, content });
    present.push(`- \`${WORKSPACE_DIR}/${name}\` — ${note}`);
  };
  /**
   * NIENTE STATO SILENZIOSO: un file mancante per BUG e un file mancante per assenza di dati devono
   * leggersi diversi.
   *
   * supabase-js non lancia, risolve con `{data: null, error}`: il `catch` di `attempt()` non si
   * accende mai, a ingoiare è la destrutturazione seguita da `if (!data) return`. Il README è
   * onesto per costruzione — elenca solo ciò che è riuscito — quindi l'agente leggeva «questo brand
   * non ha una strategia» davanti a un 42703. È già costato due file su otto: `posts.content` e
   * `brand_strategy.gtm_plan`/`.status` non esistono, e `posts.csv` e `strategy.json` non si
   * scrivevano da quando questo file è nato.
   */
  const failed = (name: string, error: { code?: string; message?: string } | null): boolean => {
    if (!error) return false;
    present.push(
      `- ⚠ \`${WORKSPACE_DIR}/${name}\` NON caricato: errore del database (${error.code ?? 'sconosciuto'}). ` +
        `È un GUASTO, non l'assenza del dato — non concludere che il brand non ce l'abbia.`
    );
    return true;
  };
  const attempt = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      /* un file mancante è un file mancante, non un turno perso */
    }
  };

  await Promise.all([
    attempt(async () => {
      const [{ data: brand, error: e1 }, { data: kit, error: e2 }] = await Promise.all([
        supabase.from('brands').select('name, slug, website, timezone, plan, status').eq('id', brandId).maybeSingle(),
        supabase.from('brand_kit').select('*').eq('brand_id', brandId).maybeSingle()
      ]);
      if (failed('brand.json', e1 ?? e2)) return;
      if (!brand && !kit) return;
      add('brand.json', toJson({ brand, kit }), 'identità, voce, colori, pilastri, contesto');
    }),

    attempt(async () => {
      // `gtm_plan` e `status` NON esistono su questa tabella (verificato: id, brand_id, report,
      // benchmark, positioning, citations, created_at, updated_at). PostgREST rispondeva 42703 e
      // `strategy.json` non si è mai materializzato. Il piano GTM sta in `gtm_plans`, non qui.
      const { data, error } = await supabase
        .from('brand_strategy')
        .select('report, benchmark, positioning, citations, updated_at')
        .eq('brand_id', brandId)
        .maybeSingle();
      if (failed('strategy.json', error)) return;
      if (!data) return;
      add('strategy.json', toJson(data), 'posizionamento, benchmark, report di strategia (il piano GTM sta dietro `read_gtm_plan`)');
    }),

    attempt(async () => {
      const { data, error } = await supabase
        .from('editorial_plans')
        .select('status, cadence, weeks, platform_mix, strategy, updated_at')
        .eq('brand_id', brandId)
        .eq('status', 'active')
        .maybeSingle();
      if (failed('editorial_plan.json', error)) return;
      if (!data) return;
      add('editorial_plan.json', toJson(data), 'piano editoriale attivo: cadenza, mix, temi settimanali');
    }),

    attempt(async () => {
      // ALIAS, non rinomina: la colonna vera è `caption`, `posts.content` non esiste e la query
      // rispondeva 42703 — `posts.csv` non si è mai scritto. Rinominare solo la select avrebbe
      // materializzato il file con `chars = 0` e caption vuota su 200 righe (`p.content` è letto
      // due volte più sotto), cioè da «assente e visibile» a «presente e silenziosamente a zero».
      const { data, error } = await supabase
        .from('posts')
        .select('id, status, platform, format, content:caption, scheduled_for, created_at')
        .eq('brand_id', brandId)
        .order('created_at', { ascending: false })
        .limit(postLimit);
      if (failed('posts.csv', error)) return;
      if (!data?.length) return;
      const rows = data.map((p: AnyRec) => ({
        id: p.id,
        status: p.status,
        platform: p.platform,
        format: p.format ?? '',
        scheduled_for: p.scheduled_for ?? '',
        created_at: p.created_at ?? '',
        chars: String(p.content ?? '').length,
        caption: String(p.content ?? '').replace(/\s+/g, ' ').slice(0, 500)
      }));
      add('posts.csv', toCsv(rows, POST_COLUMNS), `gli ultimi ${rows.length} post di questo brand (bozze incluse)`);
    }),

    attempt(async () => {
      const { data, error } = await supabase
        .from('social_post_history')
        .select('source, platform, content, platform_post_url, published_at, metrics')
        .eq('brand_id', brandId)
        .order('published_at', { ascending: false })
        .limit(historyLimit);
      if (failed('history.csv', error)) return;
      if (!data?.length) return;
      // Lo stesso post esiste due volte fra le fonti (26 gruppi duplicati misurati): senza dedup un
      // `count(*)` per piattaforma conta due volte lo stesso contenuto. La regola sta già scritta in
      // `social-history-metrics.ts` — chiave per shortcode dell'URL, vince `zernio` — e non se ne
      // scrive una seconda qui.
      const deduped = dedupeSocialHistory(data as SocialHistoryRow[]);
      const rows = deduped.map((h) => ({
        published_at: h.published_at ?? '',
        platform: h.platform ?? '',
        source: h.source ?? '',
        ...metricColumns(h.metrics),
        chars: String(h.content ?? '').length,
        url: h.platform_post_url ?? '',
        content: String(h.content ?? '').replace(/\s+/g, ' ').slice(0, 800)
      }));
      const { columns, note } = describeColumns(rows, HISTORY_COLUMNS, HISTORY_METRIC_COLUMNS);
      add(
        'history.csv',
        toCsv(rows, columns),
        `${rows.length} post pubblicati con le metriche in colonne — **è il file su cui si contano le cose**. ` +
          `${data.length - rows.length} righe duplicate fra le fonti rimosse. \`source\`: \`zernio\` = pubblicato da qui ` +
          `(porta engagement_rate e saves), \`scrapecreators\` = scrape organico (non li porta). Le due fonti NON hanno ` +
          `le stesse metriche: una media che le mescola non è una media.${note ? ` ${note}.` : ''}`
      );
    }),

    attempt(async () => {
      const { data, error } = await supabase
        .from('brand_market_references')
        .select('references, catalog, summary, field_playbook, updated_at')
        .eq('brand_id', brandId)
        .maybeSingle();
      if (failed('market.json', error)) return;
      if (!data) return;
      add('market.json', toJson(data), 'cosa gira nel campo: formati, hook, teardown dei post che stanno performando');
    }),

    attempt(async () => {
      const { data, error } = await supabase
        .from('competitors')
        .select('name, website, kind, rationale, source')
        .eq('brand_id', brandId);
      if (failed('competitors.json', error)) return;
      if (!data?.length) return;
      add('competitors.json', toJson(data), 'competitor tracciati');
    }),

    attempt(async () => {
      if (opts.webHubEnabled === false) return;
      const [{ data: audit, error: e1 }, { data: plan, error: e2 }] = await Promise.all([
        supabase
          .from('brand_geo_audits')
          .select('tech_score, tech, search, backlinks, created_at')
          .eq('brand_id', brandId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('brand_seo_plans')
          .select('grade, evaluation, initiatives, created_at')
          .eq('brand_id', brandId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      ]);
      if (failed('seo.json', e1 ?? e2)) return;
      if (!audit && !plan) return;
      add('seo.json', toJson({ audit, plan }), 'ultimo audit SEO/GEO e piano di crescita');
    })
  ]);

  files.unshift({ path: `${WORKSPACE_DIR}/README.md`, content: workspaceReadme(present, new Date()) });
  return files;
}

/**
 * La mappa. Va scritta dal codice e non dal prompt: il prompt direbbe sempre le stesse cose, questo
 * dice **quali file esistono davvero adesso**, che è l'unica versione utile.
 */
export function workspaceReadme(present: string[], generatedAt: Date = new Date()): string {
  return `# Dati del brand — ${WORKSPACE_DIR}/

generato: ${generatedAt.toISOString()}

Rigenerati all'inizio di QUESTA run. Sono uno snapshot: non scrivere qui per "salvare" qualcosa —
le modifiche restano nella VM e spariscono. Per cambiare lo stato del brand servono i tool (o un
sotto-agente \`execute\`), non questi file.

## Cosa c'è

${present.length ? present.join('\n') : '- (nessun dato disponibile per questo brand)'}

## Come usarli

- I \`.csv\` esistono per essere **contati**: pandas, duckdb, o anche awk. \`history.csv\` ha le
  metriche già in colonne — niente JSON da spacchettare.
- I \`.json\` sono gli oggetti come li vede il prodotto: stessa forma dei tool \`read_*\`.
- Un dato che qui non c'è probabilmente esiste dietro un tool di lettura. Non inventarlo, e non
  dedurlo da un file che non lo contiene.
- I numeri che riporti devono venire da un comando che hai eseguito, non da un'occhiata al file.
- **Una colonna che non c'è nel CSV non vale zero: non esiste.** Le colonne metriche vuote per
  questo brand non vengono scritte apposta, così leggerle rompe invece di restituire 0. Le righe
  che ti servono si riconoscono da \`source\`, e le fonti non portano le stesse metriche: prima di
  fare una media, guarda quante righe la valorizzano davvero.
`;
}
