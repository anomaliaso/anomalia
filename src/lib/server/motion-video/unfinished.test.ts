import { describe, it, expect } from 'vitest';
import {
	MOTION_CHAIN_USD_CAP,
	MOTION_MAX_CONTINUATIONS,
	decideMotionContinuation,
	motionUnfinishedNotice,
	motionVideoIdsTouched,
	touchedMotion
} from './unfinished';

/**
 * Una Supabase finta che risponde per tabella. Ogni filtro torna sé stesso; l'attesa risolve con
 * i dati della tabella chiesta — è tutto quello che serve per esercitare le porte.
 */
function fakeDb(opts: {
	video?: Record<string, unknown> | null;
	spendUsd?: number;
	spendError?: string;
}) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const chain = (resolve: () => unknown): any => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const q: any = {
			eq: () => q,
			gte: () => q,
			limit: () => q,
			order: () => q,
			maybeSingle: async () => resolve(),
			then: (r: (v: unknown) => void) => r(resolve())
		};
		return q;
	};
	return {
		from: (table: string) => ({
			select: () => {
				if (table === 'motion_videos')
					return chain(() => ({
						data:
							opts.video === undefined
								? { id: 'v1', title: 'Trailer', preview_url: null, created_at: '2026-08-22T00:00:00Z' }
								: opts.video,
						error: null
					}));
				// ai_calls
				return chain(() =>
					opts.spendError
						? { data: null, error: { message: opts.spendError } }
						: { data: [{ cost_usd: opts.spendUsd ?? 0 }], error: null }
				);
			}
		})
	} as never;
}

const RENDER_STEP = [{ toolCalls: [{ toolName: 'render_motion_video', input: { video_id: 'v1' } }] }];
const base = { brandId: 'b1', threadId: 't1', depth: 0, locale: 'it' };

describe('cosa conta come "aver toccato un motion video"', () => {
	it('legge gli id dai tool di entrambe le nomenclature, senza duplicati', () => {
		const steps = [
			{ toolCalls: [{ toolName: 'replace_motion_source', input: { video_id: 'v1' } }] },
			{ toolCalls: [{ toolName: 'read_posts', input: {} }] },
			{ toolCalls: [{ toolName: 'render_motion_video', input: { video_id: 'v1' } }] }
		];
		expect(motionVideoIdsTouched(steps)).toEqual(['v1']);
		expect(touchedMotion(steps)).toBe(true);
	});

	it('un turno che non ha toccato il motion non è affar suo', async () => {
		const steps = [{ toolCalls: [{ toolName: 'read_posts', input: {} }] }];
		expect(touchedMotion(steps)).toBe(false);
		expect(await decideMotionContinuation(fakeDb({}), { ...base, steps })).toBeNull();
	});
});

describe('la definizione di "finito": un MP4 di anteprima sulla riga, e nient\'altro', () => {
	it('preview_url c\'è: si chiude, e senza avvisi', async () => {
		const d = await decideMotionContinuation(
			fakeDb({ video: { id: 'v1', title: 'T', preview_url: 'https://x/y.mp4', created_at: '2026-08-22T00:00:00Z' } }),
			{ ...base, steps: RENDER_STEP }
		);
		expect(d).toMatchObject({ continue: false, reason: 'shipped' });
		// Un avviso su un lavoro riuscito è rumore.
		expect(motionUnfinishedNotice(d, 'it')).toBeNull();
	});

	it('nessuna anteprima: il sorgente c’è e il video no — si riprende', async () => {
		const d = await decideMotionContinuation(fakeDb({}), { ...base, steps: RENDER_STEP });
		expect(d).toMatchObject({ continue: true, reason: 'never_rendered' });
		expect(d!.prompt).toContain('render_motion_video');
		// Il turno riprende da solo: nessuna riga di chiusura, la ripresa parla da sé.
		expect(motionUnfinishedNotice(d, 'it')).toBeNull();
	});

	it('un create senza id è comunque lavoro a metà: si riprende', async () => {
		const steps = [{ toolCalls: [{ toolName: 'create_motion_video', input: { title: 'X' } }] }];
		const d = await decideMotionContinuation(fakeDb({}), { ...base, steps });
		expect(d).toMatchObject({ continue: true, reason: 'never_rendered', videoId: null });
	});
});

describe('i freni, che stanno in codice e non nel prompt', () => {
	it('il tetto di spesa per video ferma il giro, con la cifra', async () => {
		const d = await decideMotionContinuation(
			fakeDb({ spendUsd: MOTION_CHAIN_USD_CAP + 0.4 }),
			{ ...base, steps: RENDER_STEP }
		);
		expect(d).toMatchObject({ continue: false, reason: 'budget_spent' });
		expect(motionUnfinishedNotice(d, 'it')).toContain('3.40');
	});

	it('registro delle spese illeggibile: il tetto non blocca', async () => {
		// Un freno che non sa contare non deve fermare il lavoro.
		const d = await decideMotionContinuation(
			fakeDb({ spendError: 'boom' }),
			{ ...base, steps: RENDER_STEP }
		);
		expect(d!.continue).toBe(true);
	});

	it('il tetto sulle riprese: 24 e poi basta', async () => {
		const d = await decideMotionContinuation(fakeDb({}), {
			...base,
			steps: RENDER_STEP,
			depth: MOTION_MAX_CONTINUATIONS
		});
		expect(d).toMatchObject({ continue: false, reason: 'laps_spent' });
		expect(motionUnfinishedNotice(d, 'it')).toContain(String(MOTION_MAX_CONTINUATIONS));
	});
});
