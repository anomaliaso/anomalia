/**
 * Il tick della coda recensioni, dal lato che costa soldi: un brand a crediti zero non deve
 * fermare la coda di tutti gli altri, e un giro in cui non è avanzato niente non deve dire al
 * suo endpoint di richiamarsi (era la ricetta per un hot loop a spese di Vercel).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const reviewVideo = vi.fn();

vi.mock('$lib/server/ai-log', () => ({
	withBrandContext: <T>(_brandId: string, fn: () => T) => fn(),
	logAiCall: vi.fn(),
	isCreditExempt: () => false
}));
vi.mock('$lib/server/video-review', () => ({
	reviewVideo: (...args: unknown[]) => reviewVideo(...args),
	inferVideoStandard: () => 'organic',
	visualUrlsFromPost: () => []
}));
vi.mock('$lib/server/video-review-report', () => ({
	reportMediaReviewError: vi.fn()
}));

import { CreditsExhaustedError, type CreditsUsage } from './credits';
import { runVideoReviewTick } from './video-review-store';

function exhausted(): CreditsExhaustedError {
	const now = new Date();
	return new CreditsExhaustedError({
		used: 100,
		quota: 100,
		bonus: 0,
		remaining: 0,
		periodStart: now,
		periodEnd: now,
		percent: 100
	} as CreditsUsage);
}

/** Tabelle in memoria: quel tanto di PostgREST che il tick usa davvero. */
function makeDb(seed: Record<string, Row[]>) {
	const tables: Record<string, Row[]> = {};
	for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));

	function build(name: string, mode: 'select' | 'update', patch?: Row) {
		const table = (tables[name] ??= []);
		const filters: Array<(r: Row) => boolean> = [];
		let limit = Infinity;
		let sort: ((a: Row, b: Row) => number) | null = null;

		const run = () => {
			let hits = table.filter((r) => filters.every((f) => f(r)));
			if (sort) hits = [...hits].sort(sort);
			hits = hits.slice(0, limit);
			if (mode === 'update') hits.forEach((r) => Object.assign(r, patch));
			return hits;
		};

		const api: Row = {
			eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
			neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), api),
			in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), api),
			lt: (c: string, v: string) => (filters.push((r) => r[c] != null && r[c] < v), api),
			not: (c: string, op: string, v: string) => {
				if (op === 'in') {
					const set = new Set(v.replace(/^\(|\)$/g, '').split(','));
					filters.push((r) => !set.has(String(r[c])));
				} else if (op === 'is') {
					filters.push((r) => r[c] != null);
				}
				return api;
			},
			order: (c: string, o?: { ascending?: boolean }) => {
				const dir = o?.ascending === false ? -1 : 1;
				sort = (a, b) => (String(a[c] ?? '') < String(b[c] ?? '') ? -dir : String(a[c] ?? '') > String(b[c] ?? '') ? dir : 0);
				return api;
			},
			limit: (n: number) => ((limit = n), api),
			select: () => api,
			maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
			then: (res?: (v: { data: Row[]; error: null; count: number }) => unknown) => {
				const hits = run();
				const value = { data: hits, error: null, count: hits.length };
				return Promise.resolve(res ? res(value) : value);
			}
		};
		return api;
	}

	return {
		tables,
		client: {
			from: (name: string) => ({
				select: () => build(name, 'select'),
				update: (patch: Row) => build(name, 'update', patch),
				insert: async (row: Row) => {
					(tables[name] ??= []).push({ id: `row-${tables[name].length + 1}`, ...row });
					return { data: null, error: null };
				},
				upsert: async (row: Row) => {
					const t = (tables[name] ??= []);
					const hit = t.find(
						(r) =>
							r.brand_id === row.brand_id &&
							r.url_hash === row.url_hash &&
							r.standard === row.standard
					);
					if (hit) Object.assign(hit, row);
					else t.push({ id: `row-${t.length + 1}`, ...row });
					return { data: null, error: null };
				}
			})
		}
	};
}

function reviewRow(over: Row = {}): Row {
	return {
		id: 'rev-1',
		brand_id: 'brand-broke',
		post_id: null,
		media_url: 'https://cdn.example/broke.mp4',
		url_hash: 'h-broke',
		standard: 'organic',
		status: 'pending',
		attempts: 0,
		kind: 'video',
		progress: null,
		created_at: '2026-08-01T00:00:00.000Z',
		updated_at: '2026-08-01T00:00:00.000Z',
		...over
	};
}

const BRANDS = [
	{ id: 'brand-broke', name: 'Broke', slug: 'broke', content_prefs: null },
	{ id: 'brand-ok', name: 'Ok', slug: 'ok', content_prefs: null }
];

const READY = {
	ok: true,
	review: { overall: 8, verdict: 'ship', scores: {}, summary: 'fine', issues: [] }
};

beforeEach(() => {
	reviewVideo.mockReset();
});

describe('runVideoReviewTick — brand senza crediti', () => {
	it('non blocca la coda degli altri brand e non conta come lavoro fatto', async () => {
		reviewVideo.mockImplementation((url: string) => {
			if (url.includes('broke')) throw exhausted();
			return READY;
		});
		const db = makeDb({
			video_reviews: [
				reviewRow(), // il più vecchio: sta in testa alla coda FIFO
				reviewRow({
					id: 'rev-2',
					brand_id: 'brand-ok',
					media_url: 'https://cdn.example/good.mp4',
					url_hash: 'h-good',
					created_at: '2026-08-02T00:00:00.000Z'
				})
			],
			posts: [],
			media_generator_items: [],
			brands: BRANDS
		});

		const res = await runVideoReviewTick(db.client as never, { deadlineMs: Date.now() + 300_000 });

		// Prima: la riga bloccata veniva ripescata a ogni giro, bruciava entrambi gli slot e
		// nessun altro brand avanzava mai.
		expect(res.ok).toBe(1);
		expect(res.creditsBlocked).toBe(1);
		expect(res.processed).toBe(1);
		expect(reviewVideo).toHaveBeenCalledTimes(2);

		const broke = db.tables.video_reviews.find((r) => r.id === 'rev-1')!;
		expect(broke.status).toBe('pending'); // torna in coda, al suo posto
		expect(broke.attempts).toBe(0); // non è un errore del video: non consuma tentativi
		expect(broke.created_at).toBe('2026-08-01T00:00:00.000Z'); // resta il primo servito
		expect(
			db.tables.video_reviews.some((r) => r.media_url.includes('good') && r.status === 'ready')
		).toBe(true);
	});

	it('con solo brand a zero crediti il tick chiude a processed 0 (l’endpoint non si ri-kicka)', async () => {
		reviewVideo.mockImplementation(() => {
			throw exhausted();
		});
		const db = makeDb({
			video_reviews: [reviewRow(), reviewRow({ id: 'rev-2', url_hash: 'h-2', created_at: '2026-08-02T00:00:00.000Z' })],
			posts: [],
			media_generator_items: [],
			brands: BRANDS
		});

		const res = await runVideoReviewTick(db.client as never, { deadlineMs: Date.now() + 300_000 });

		expect(res.processed).toBe(0); // `remaining > 0 && processed > 0` → nessun self-POST
		expect(res.remaining).toBeGreaterThan(0);
		// Il brand esce dalla selezione dopo il primo colpo: una sola gateCredits, non una per riga.
		expect(reviewVideo).toHaveBeenCalledTimes(1);
	});
});
