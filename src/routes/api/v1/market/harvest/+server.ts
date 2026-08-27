import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { recordHarvestRun, refreshVelocity, runMarketHarvest } from '$lib/server/market-harvest';
import { reportHarvestErrors, reportHarvestFatal } from '$lib/server/market-errors';
import { catalogueMarketPosts } from '$lib/server/market-categorise';
import { categoriesForTick, parseCategories, type DiscoveryCategory } from '$lib/server/market-discovery';

export const config = { maxDuration: 800 };

/** Categorie per giro. L'ampiezza viene dalla rotazione, non dal fare tutto ogni ora. */
const CATEGORIES_PER_TICK = Number(env.MARKET_CATEGORIES_PER_TICK ?? '') || 2;

/**
 * La fetta di categorie che tocca a questo giro, contata in ESECUZIONI e non in ore.
 *
 * Indicizzare sull'ora sembra giusto finché il cron è orario e si rompe in silenzio appena non lo
 * è: un cron giornaliero parte a un'ora fissa, quindi l'indice non si muove mai e le stesse due
 * categorie vengono raccolte per sempre. Contare le esecuzioni avanza a ogni giro, qualunque sia
 * la pianificazione. Ripiego sull'ora UTC se il conteggio non si legge: una rotazione imperfetta
 * batte un tick che si rifiuta di girare.
 */
async function tickIndex(url: URL, admin: SupabaseClient): Promise<number> {
  const explicit = url.searchParams.get('tick');
  if (explicit !== null && explicit.trim() !== '') return Number(explicit) || 0;
  try {
    const { count, error } = await admin
      .from('market_harvest_runs')
      .select('id', { count: 'exact', head: true });
    if (error || count == null) return new Date().getUTCHours();
    return count;
  } catch {
    return new Date().getUTCHours();
  }
}

async function planFrom(url: URL, admin: SupabaseClient): Promise<{
  categories: DiscoveryCategory[];
  freshDays: number;
  limit: number;
  perCategoryLimit: number;
  maxBaselineFetches?: number;
}> {
  const all = parseCategories(env.MARKET_DISCOVERY_CATEGORIES);

  const pinned = String(url.searchParams.get('cat') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const selected = pinned.length
    ? all.filter((c) => pinned.includes(c.id))
    : categoriesForTick(
        all,
        await tickIndex(url, admin),
        Number(url.searchParams.get('per') ?? '') || CATEGORIES_PER_TICK
      );

  return {
    categories: selected,
    freshDays: Number(url.searchParams.get('days') ?? '') || 2,
    limit: Number(url.searchParams.get('limit') ?? '') || 600,
    perCategoryLimit: Number(url.searchParams.get('percat') ?? '') || 80,
    // Ogni fetch di profilo vale ~24 post etichettati: è la manopola che conta finché il bacino è vuoto.
    maxBaselineFetches: Number(url.searchParams.get('fetches') ?? '') || undefined
  };
}

async function drain(request: Request): Promise<Record<string, unknown>> {
  const startedAt = new Date().toISOString();
  const admin = createAdminClient();
  const plan = await planFrom(new URL(request.url), admin);
  if (!plan.categories.length) {
    console.warn('[market/harvest] nessuna categoria selezionata per questo tick');
    return { skipped: 'nessuna categoria selezionata' };
  }

  const ids = plan.categories.map((c) => c.id);
  try {
    const result = await runMarketHarvest(admin, plan);
    // Si interpola all'età di riferimento, così il confronto è fra post della stessa età e non
    // dell'età a cui sono stati osservati. Velocità, non normalizzazione per età: quella non
    // potrebbe mai scattare, perché ogni post entra nel bacino già maturo.
    const velocities = await refreshVelocity(admin);

    // Il catalogo è di Gemini, mai della query: "food" tira su un personal trainer che parla di
    // meal prep, e archiviarlo sotto food dà una risposta sicura da un mucchio misto — peggio
    // che non raggruppare affatto.
    const catalogue = await catalogueMarketPosts(admin, { deadline: Date.parse(startedAt) + 770_000 });
    result.errors.push(...catalogue.errors);

    const runId = await recordHarvestRun(admin, result, { startedAt, categories: ids });

    // Righe per interrogare dopo, e UN evento Sentry aggregato per (stadio, motivo): un cron
    // orario non deve poterlo allagare.
    if (result.errors.length) {
      const { groups } = await reportHarvestErrors(admin, result.errors, { runId, categories: ids });
      console.warn(
        `[market/harvest] ${result.errors.length} errori non fatali:`,
        JSON.stringify(groups.slice(0, 10))
      );
    }
    const summary = {
      categories: ids,
      ...result,
      errors: result.errors.length,
      velocities,
      catalogue
    };
    console.log('[market/harvest]', JSON.stringify(summary));
    return summary;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[market/harvest]', message);
    reportHarvestFatal(e, { categories: ids });
    await recordHarvestRun(
      admin,
      {
        discovered: 0,
        stored: 0,
        baselinesFromHistory: 0,
        baselinesFromDiscovery: 0,
        labelled: 0,
        yields: [],
        errors: [],
        postsNew: 0,
        postsReobserved: 0,
        analyzedNew: 0,
        analyzedAgain: 0,
        mediaArchived: 0,
        mediaBytes: 0,
        mediaFailed: 0,
        historyPosts: 0,
        fetchesDeferred: 0
      },
      { startedAt, categories: ids, error: message.slice(0, 500) }
    );
    return { categories: ids, error: message };
  }
}

/**
 * Il lavoro si ASPETTA, non si passa a waitUntil: appena la risposta esce, l'istanza smette di
 * essere schedulata, le `fetch` pendenti non avanzano e i timer di abort non scattano mai. Un cron
 * non ha bisogno di una risposta veloce, ha bisogno che la function finisca.
 */
async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  try {
    return json({ ok: true, ...(await drain(request)) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[market/harvest]', message);
    return json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
