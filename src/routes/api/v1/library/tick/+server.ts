import { swallow } from '$lib/server/swallow';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import {
	crawlBrandSite,
	getLibraryLastScannedAt,
	isLibraryScanFresh,
	LIBRARY_FRESH_DAYS
} from '$lib/server/content-library';
import { withBrandContext } from '$lib/server/ai-log';
import { hasWebHub } from '$lib/server/plans';
import { jobPausedForBrand } from '$lib/server/job-roster';
import { reportToAgentThread } from '$lib/server/team-ignition';
import { recordLoopTick, nextRunBudgetMs, type LoopSkipReason } from '$lib/server/loop-ticks';
import { queueForLoop, markServed } from '$lib/server/loop-fairness';

// Monthly content-library refresh: cron hits daily; we only re-crawl when the brand's last scan
// is older than LIBRARY_FRESH_DAYS (30), or never scanned. Free matches Go (Web hub unlocked). Same auth gate as
// geo/keywords ticks. Supports ?brand=<slug>. Bounded batch so one invocation stays under maxDuration.
//
// IL CASO PIÙ CARO DELLA FLOTTA, prima del 2026-08-22. Il cursore era `brand_pages.last_scanned_at`,
// scritto solo se il crawl riusciva: un brand con il sito irraggiungibile faceva lanciare
// `crawlBrandSite`, il `.catch(() => -1)` lo assorbiva, nessuna riga veniva scritta, e quindi il
// brand restava "mai scansionato" — riprovato ogni singolo giorno, 1-2 minuti di finestra bruciati
// per niente, senza nemmeno consumare uno dei due slot di successo. Adesso il claim
// (`loop_cursors`, migration 0213) precede il crawl: chi non produce avanza lo stesso.

export const config = { maxDuration: 300 };

/** Brands CRAWLED per tick — each crawl can take ~1–2 min. */
const MAX_PER_TICK = 2;
/**
 * Quanti brand il tick GUARDA. Più alto di MAX_PER_TICK perché i gate qui sono una query o meno
 * (roster, piano, sito, freschezza): fermarsi al secondo brand *guardato* invece che al secondo
 * *scansionato* significherebbe non scansionare più nessuno appena due brand freschi finiscono in
 * cima alla coda.
 */
const MAX_SCAN_PER_TICK = 50;

async function run(request: Request): Promise<Response> {
	if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
	const admin = createAdminClient();
	const only = new URL(request.url).searchParams.get('brand');

	const t0 = Date.now();
	let q = admin
		.from('brands')
		.select('id, name, slug, website, plan')
		.eq('status', 'active');
	if (only) q = q.eq('slug', only);
	const { data: brands } = await q;

	// La coda: chi aspetta da più tempo per primo. `?brand=` è diagnostico e non passa dalla coda.
	const queue = only ? (brands ?? []) : await queueForLoop(admin, 'library', brands ?? [], MAX_SCAN_PER_TICK);

	let scanned = 0;
	let skipped = 0;
	let pages = 0;
	const skip = (brandId: string, reason: LoopSkipReason) => {
		skipped++;
		recordLoopTick({ loop: 'library', brandId, outcome: 'skipped', reason });
	};

	for (const brand of queue) {
		if (scanned >= MAX_PER_TICK && !only) break;
		// La finestra decide quanti, non quali: un crawl dura 1-2 minuti, e iniziarne uno che non
		// può finire spende la rete e non scrive niente. Chi non ci sta non viene claimato.
		if (!only && nextRunBudgetMs({ elapsedMs: Date.now() - t0 }) === null) break;

		// IL CLAIM, prima di ogni gate e prima del crawl. È la riga che chiude il caso del sito
		// irraggiungibile ritentato ogni giorno per sempre.
		if (!only) await markServed(admin, 'library', brand.id);

		// Roster: dopo il claim, prima del crawl (che è la parte cara).
		if (await jobPausedForBrand('library', brand.id)) {
			skipped++;
			continue;
		}
		if (!hasWebHub(brand.plan)) {
			skip(brand.id, 'no_plan');
			continue;
		}
		if (!brand.website) {
			skip(brand.id, 'no_own_signal');
			continue;
		}
		const last = await getLibraryLastScannedAt(admin, brand.id);
		if (isLibraryScanFresh(last, LIBRARY_FRESH_DAYS)) {
			skip(brand.id, 'fresh');
			continue;
		}
		const startedAt = Date.now();
		const count = await withBrandContext(brand.id, async () => {
			return crawlBrandSite(admin, brand);
		}).catch((error) => { swallow('crawl brand site', error); return -1; });
		if (count < 0) {
			// Il crawl ha lanciato (sito giù, DNS, timeout). Adesso lascia una traccia leggibile
			// invece di un silenzio identico a «non è mai stato il suo turno».
			skipped++;
			recordLoopTick({
				loop: 'library',
				brandId: brand.id,
				outcome: 'failed',
				reason: 'crawl_failed',
				durationMs: Date.now() - startedAt
			});
			continue;
		}
		scanned++;
		pages += count;
		// Il resoconto nel thread dell'agente. Non alza mai; i giri saltati non scrivono.
		// Il tick 'ok' che mancava: /agents legge SOLO loop_ticks, e senza questa riga un
		// lavoro che gira ogni settimana resta "mai girato" per sempre sulla sua card.
		recordLoopTick({ loop: 'library', brandId: brand.id, outcome: 'ok', durationMs: Date.now() - startedAt });
		await reportToAgentThread(admin, brand.id, { job: 'library', pages: count });
	}

	return new Response(
		JSON.stringify({ ok: true, scanned, pages, skipped, freshDays: LIBRARY_FRESH_DAYS, elapsedMs: Date.now() - t0 }),
		{ headers: { 'content-type': 'application/json' } }
	);
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
