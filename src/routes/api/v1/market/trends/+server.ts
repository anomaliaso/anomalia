import { swallow } from '$lib/server/swallow';
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { runTrendSweep } from '$lib/server/market-trends';
import {
  BASELINE_TIME_BUDGET_MS,
  MAX_BASELINE_FETCHES,
  ensureBaselines,
  fetchTargets,
  pendingAccounts,
  relabelMarketPosts,
  storeTrendVideos
} from '$lib/server/market-harvest';
import { catalogueMarketPosts } from '$lib/server/market-categorise';
import { reportHarvestErrors, reportHarvestFatal } from '$lib/server/market-errors';

export const config = { maxDuration: 800 };

const csv = (raw: string | null | undefined): string[] =>
  String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Hashtag e non parole chiave: su Instagram e TikTok l'hashtag È la verticale, cioè il modo in cui
 * le piattaforme stesse partizionano i contenuti. Si sovrascrive senza deploy con
 * `MARKET_TREND_HASHTAGS`.
 */
const DEFAULT_HASHTAGS = [
  // food
  'ristorante', 'pizzeria', 'foodbusiness',
  // fitness
  'personaltrainer', 'palestra',
  // beauty
  'parrucchiere', 'estetista', 'nailartist',
  // fashion / retail
  'boutique', 'negozioabbigliamento',
  // interiors / realestate
  'arredamento', 'agenteimmobiliare',
  // professional / saas / ecommerce
  'commercialista', 'ecommercetips', 'marketingtips', 'smallbusiness',
  // coaching / travel / automotive
  'businesscoach', 'bedandbreakfast', 'concessionaria'
];

/** Quanti hashtag per giro. L'ampiezza viene dalla rotazione, non dal fare tutto ogni ora. */
const HASHTAGS_PER_TICK = Number(env.MARKET_HASHTAGS_PER_TICK ?? '') || 6;

/**
 * La fetta di hashtag che tocca a questo giro, indicizzata sull'ORA UTC.
 *
 * Va bene QUI e non altrove: questo cron parte a ore fisse, quindi l'ora avanza fra un giro e
 * l'altro. L'harvest conta le righe invece, perché parte una volta al giorno e un indice
 * sull'ora si congelerebbe su un valore solo affamando ogni altra categoria per sempre.
 *
 * Venti hashtag per due piattaforme sono quaranta chiamate: farle tutte ogni ora costerebbe circa
 * mille crediti al giorno su un saldo di tredicimila. Sei per giro coprono la lista in meno di
 * quattro ore e costano un terzo.
 */
function hashtagsForTick(all: string[], perTick: number, hour: number): string[] {
  if (!all.length) return [];
  const n = Math.max(1, Math.min(perTick, all.length));
  const start = (hour * n) % all.length;
  return Array.from({ length: n }, (_, i) => all[(start + i) % all.length]);
}

/**
 * Una regione sola, per misura e non per gusto: il feed trending restituisce un payload molto più
 * magro della ricerca per hashtag (0 video su 16 con `text_extra`, profilo o caption, contro 20 su
 * 20) allo stesso costo di un credito, e per giunta fuori bersaglio. Il feed generale resta un
 * segnale sottile; il budget va sulla superficie che porta davvero dati.
 */
const DEFAULT_REGIONS = ['IT'];

async function drain(request: Request): Promise<Record<string, unknown>> {
  const url = new URL(request.url);
  const admin = createAdminClient();

  const configured = csv(url.searchParams.get('tags')).length
    ? csv(url.searchParams.get('tags'))
    : csv(env.MARKET_TREND_HASHTAGS).length
      ? csv(env.MARKET_TREND_HASHTAGS)
      : DEFAULT_HASHTAGS;
  // Un `?tags=` esplicito è un giro manuale e si prende intero: la rotazione è per il cron.
  const hashtags = csv(url.searchParams.get('tags')).length
    ? configured
    : hashtagsForTick(
        configured,
        Number(url.searchParams.get('per') ?? '') || HASHTAGS_PER_TICK,
        Number(url.searchParams.get('tick') ?? '') || new Date().getUTCHours()
      );
  const regions = csv(url.searchParams.get('regions')).length
    ? csv(url.searchParams.get('regions'))
    : DEFAULT_REGIONS;

  // Un muro solo (800s) diviso fra quattro stadi, quindi scadenze ASSOLUTE e non cronometri
  // indipendenti: uno sweep lento deve mangiare il budget di chi viene dopo, non spingere l'intero
  // giro oltre il muro — là non si registra nulla.
  //
  // L'ordine delle fette segue ciò che scarseggia: le fetch dei profili sono il collo di bottiglia,
  // il catalogo è a lotti ed è a buon mercato, e l'analisi dei clip è limitata dal suo tetto molto
  // prima che dal tempo. Gli ultimi 30s restano liberi, così scritture e log del giro atterrano sempre.
  const t0 = Date.now();
  const BASELINE_BY = t0 + BASELINE_TIME_BUDGET_MS;
  const CATALOGUE_BY = t0 + 560_000;

  try {
    const sweep = await runTrendSweep({
      hashtags,
      regions,
      includeInstagramTrending: url.searchParams.get('ig') !== '0',
      limit: Number(url.searchParams.get('limit') ?? '') || 300
    });

    const stored = await storeTrendVideos(admin, sweep.videos);

    // Gli account dei video appena trovati si prendono in QUESTO giro, non si accodano: un video
    // di tendenza senza la mediana del suo account non è un dato, è un numero senza termine di
    // paragone. La ricerca che l'ha trovato vale il suo prezzo solo se l'etichetta atterra con lui.
    const accounts = [
      ...new Map(
        sweep.videos
          .filter((v) => v.accountHandle)
          .map((v) => [`${v.platform}:${v.accountHandle}`, { platform: v.platform, handle: v.accountHandle as string }])
      ).values()
    ];
    const queued = await pendingAccounts(admin, { limit: MAX_BASELINE_FETCHES, now: t0 }).catch((error) => { swallow('pending baseline accounts', error); return []; });
    const { fetchable } = fetchTargets(accounts, queued);
    const baselines = await ensureBaselines(admin, fetchable, { deadline: BASELINE_BY });
    const labelled = await relabelMarketPosts(admin, accounts);

    const catalogue = await catalogueMarketPosts(admin, { deadline: CATALOGUE_BY });

    const problems = [
      ...sweep.errors.map((e) => ({ stage: 'discovery' as const, target: e.source, message: e.message })),
      ...baselines.errors,
      ...catalogue.errors
    ];
    if (problems.length) {
      await reportHarvestErrors(admin, problems, { categories: hashtags });
    }
    const summary = {
      hashtags,
      regions,
      found: sweep.videos.length,
      yields: sweep.yields,
      errors: problems.length,
      ...stored,
      accounts: accounts.length,
      baselines: baselines.fetched,
      historyPosts: baselines.historyPosts,
      deferred: baselines.deferred,
      // Nome diverso da `stored.transcripts`: sono due superfici con coperture molto diverse, e
      // sotto una chiave sola verrebbe riportata in silenzio solo l'ultima scritta.
      transcriptsFromHistory: baselines.transcripts,
      labelled,
      catalogue,
      ms: Date.now() - t0
    };
    console.log('[market/trends]', JSON.stringify(summary));
    return summary;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[market/trends]', message);
    reportHarvestFatal(e, { categories: hashtags });
    return { error: message, ms: Date.now() - t0 };
  }
}

/**
 * Il lavoro si ASPETTA, non si passa a waitUntil.
 *
 * Con la forma 202-poi-waitUntil (quella degli altri scraper) l'istanza smette di essere schedulata
 * appena la risposta esce: le `fetch` pendenti non avanzano più e i timer di abort non scattano
 * mai. Tutto si risolve solo allo smontaggio dell'istanza — un'intera notte di giri orari che non
 * ha scritto niente. Un cron non ha bisogno di una risposta veloce: ha bisogno che la function
 * finisca, e `maxDuration` è il budget per quello.
 */
async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  try {
    return json({ ok: true, ...(await drain(request)) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[market/trends]', message);
    return json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
