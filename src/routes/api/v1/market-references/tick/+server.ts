import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import {
	FRESH_DAYS,
	isMarketRefsFresh,
	refreshMarketReferences
} from '$lib/server/market-references';
import { withBrandContext } from '$lib/server/ai-log';
import { hasWebHub } from '$lib/server/plans';
import { jobPausedForBrand } from '$lib/server/job-roster';
import { reportToAgentThread } from '$lib/server/team-ignition';
import { recordLoopTick, nextRunBudgetMs, type LoopSkipReason } from '$lib/server/loop-ticks';
import { queueForLoop, markServed } from '$lib/server/loop-fairness';

// Weekly market-reference refresh: cron hits Mondays; we only regenerate when the row is older
// than FRESH_DAYS (7). Paid plans with ≥1 competitor that has handles. Same auth gate as
// geo/keywords ticks. Supports ?brand=<slug>. Bounded batch to stay under maxDuration.
//
// L'ordine è una decisione, non ciò che restituisce il pianificatore (`loop_cursors`, migration
// 0213): prima erano tre brand a settimana presi sempre dalla stessa cima. Misurato il 2026-08-22
// su 13 brand attivi: quattro non avevano MAI ricevuto un refresh e tre erano fermi al 10 agosto.

export const config = { maxDuration: 300 };

/** Brands REFRESHED per tick — each refresh scrapes a few handles + one AI call. */
const MAX_PER_TICK = 3;
/**
 * Quanti brand il tick si degna di GUARDARE. È più alto di MAX_PER_TICK perché i gate qui costano
 * una query e niente più (piano, competitor con handle, freschezza): camminare oltre un brand
 * fresco è gratis, e fermarsi al terzo *guardato* invece che al terzo *rinfrescato* significherebbe
 * non rinfrescare più nessuno appena metà flotta è fresca.
 */
const MAX_SCAN_PER_TICK = 50;

async function run(request: Request): Promise<Response> {
	if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
	const admin = createAdminClient();
	const only = new URL(request.url).searchParams.get('brand');

	const t0 = Date.now();
	let q = admin.from('brands').select('id, name, slug, plan').eq('status', 'active');
	if (only) q = q.eq('slug', only);
	const { data: brands } = await q;

	// La coda: chi aspetta da più tempo per primo. `?brand=` è diagnostico e non passa dalla coda.
	const queue = only
		? (brands ?? [])
		: await queueForLoop(admin, 'market_refs', brands ?? [], MAX_SCAN_PER_TICK);

	let refreshed = 0;
	let skipped = 0;
	let refs = 0;
	const skip = (brandId: string, reason: LoopSkipReason) => {
		skipped++;
		recordLoopTick({ loop: 'market_refs', brandId, outcome: 'skipped', reason });
	};

	for (const brand of queue) {
		if (refreshed >= MAX_PER_TICK && !only) break;
		// La finestra decide quanti, non quali: chi non ci sta non viene claimato e resta in testa
		// alla coda del giro dopo.
		if (!only && nextRunBudgetMs({ elapsedMs: Date.now() - t0 }) === null) break;

		// IL CLAIM, prima di ogni gate. Un brand il cui refresh fallisce o torna null non scrive
		// `updated_at`, quindi non diventa mai fresco: prima di questa riga restava in cima e si
		// riprendeva lo stesso posto ogni settimana, per sempre.
		if (!only) await markServed(admin, 'market_refs', brand.id);

		// Roster: dopo il claim, prima delle query sui competitor e del refresh AI.
		if (await jobPausedForBrand('market_refs', brand.id)) {
			skipped++;
			continue;
		}
		if (!hasWebHub(brand.plan)) {
			skip(brand.id, 'no_plan');
			continue;
		}

		const { data: comps } = await admin
			.from('competitors')
			.select('id, handles')
			.eq('brand_id', brand.id)
			.not('handles', 'is', null);
		// Empty arrays [] are NOT NULL — require at least one usable handle entry.
		const withHandles = (comps ?? []).filter((c) => {
			const h = c.handles;
			if (!Array.isArray(h)) return false;
			return h.some((x) => {
				if (!x || typeof x !== 'object') return false;
				const rec = x as { username?: string; handle?: string; profileUrl?: string };
				return Boolean(rec.username || rec.handle || rec.profileUrl);
			});
		});
		if (!withHandles.length) {
			skip(brand.id, 'no_own_signal');
			continue;
		}

		const { data: row } = await admin
			.from('brand_market_references')
			.select('updated_at')
			.eq('brand_id', brand.id)
			.maybeSingle();
		if (row && isMarketRefsFresh(row.updated_at, FRESH_DAYS) && !only) {
			skip(brand.id, 'fresh');
			continue;
		}

		const result = await withBrandContext(brand.id, async () => {
			return refreshMarketReferences(admin, brand.id, { force: true });
		}).catch((e) => {
			console.warn(`[market-refs] ${brand.slug}:`, e instanceof Error ? e.message : e);
			return null;
		});

		if (!result) {
			skip(brand.id, 'empty_result');
			continue;
		}
		refreshed++;
		refs += result.references.length;
		// Il resoconto nel thread dell'agente. Non alza mai; i giri saltati non scrivono.
		// Il tick 'ok' che mancava: /agents legge SOLO loop_ticks, e senza questa riga un
		// lavoro che gira ogni settimana resta "mai girato" per sempre sulla sua card.
		recordLoopTick({ loop: 'market_refs', brandId: brand.id, outcome: 'ok' });
		await reportToAgentThread(admin, brand.id, { job: 'market_refs', references: result.references.length });
	}

	return new Response(
		JSON.stringify({ ok: true, refreshed, refs, skipped, freshDays: FRESH_DAYS, elapsedMs: Date.now() - t0 }),
		{ headers: { 'content-type': 'application/json' } }
	);
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
