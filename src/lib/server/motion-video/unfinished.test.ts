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
 * i dati della tabella chiesta — è tutto quello che serve per esercitare le tre porte.
 */
function fakeDb(opts: {
	video?: Record<string, unknown> | null;
	scores?: Array<{ overall: number; verdict: string }>;
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
				if (table === 'motion_craft_scores')
					return chain(() => ({ data: opts.scores ?? [], error: null }));
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

describe('la definizione di "finito": un MP4 con verdetto ship, e nient\'altro', () => {
	it('verdetto ship: si chiude, e senza avvisi', async () => {
		const d = await decideMotionContinuation(fakeDb({ scores: [{ overall: 8.1, verdict: 'ship' }] }), {
			...base,
			steps: RENDER_STEP
		});
		expect(d).toMatchObject({ continue: false, reason: 'shipped' });
		// Un avviso su un lavoro riuscito è rumore.
		expect(motionUnfinishedNotice(d, 'it')).toBeNull();
	});

	it('nessun giudizio e nessuna anteprima: il sorgente c’è e il video no — si riprende', async () => {
		const d = await decideMotionContinuation(fakeDb({ scores: [] }), { ...base, steps: RENDER_STEP });
		expect(d).toMatchObject({ continue: true, reason: 'never_rendered' });
		expect(d!.prompt).toContain('render_motion_video');
		// Il turno riprende da solo: nessuna riga di chiusura, la ripresa parla da sé.
		expect(motionUnfinishedNotice(d, 'it')).toBeNull();
	});

	it('verdetto fix al primo giro: si riprende, ed è la prima correzione', async () => {
		const d = await decideMotionContinuation(
			fakeDb({
				video: { id: 'v1', title: 'T', preview_url: 'https://x/y.mp4', created_at: '2026-08-22T00:00:00Z' },
				scores: [{ overall: 4.2, verdict: 'fix' }]
			}),
			{ ...base, steps: RENDER_STEP }
		);
		expect(d).toMatchObject({ continue: true, reason: 'verdict_open' });
		expect(d!.prompt).toContain('4.2/10');
	});

	it('un create senza id è comunque lavoro a metà: si riprende', async () => {
		const steps = [{ toolCalls: [{ toolName: 'create_motion_video', input: { title: 'X' } }] }];
		const d = await decideMotionContinuation(fakeDb({}), { ...base, steps });
		expect(d).toMatchObject({ continue: true, reason: 'never_rendered', videoId: null });
	});
});

describe('i tre freni, che stanno in codice e non nel prompt', () => {
	it('il voto che non sale ferma la lucidatura, e lo dice', async () => {
		const d = await decideMotionContinuation(
			fakeDb({
				scores: [
					{ overall: 5.5, verdict: 'fix' },
					{ overall: 5.5, verdict: 'fix' }
				]
			}),
			{ ...base, steps: RENDER_STEP }
		);
		expect(d).toMatchObject({ continue: false, reason: 'not_improving' });
		const line = motionUnfinishedNotice(d, 'it')!;
		expect(line).toContain('due giri');
		expect(line).toContain('5.5/10');
	});

	it('un voto che sale non ferma niente', async () => {
		const d = await decideMotionContinuation(
			fakeDb({
				scores: [
					{ overall: 4, verdict: 'fix' },
					{ overall: 6, verdict: 'fix' }
				]
			}),
			{ ...base, steps: RENDER_STEP }
		);
		expect(d!.continue).toBe(true);
	});

	it('il tetto di spesa per video ferma il giro, con la cifra', async () => {
		const d = await decideMotionContinuation(
			fakeDb({ scores: [{ overall: 4, verdict: 'fix' }], spendUsd: MOTION_CHAIN_USD_CAP + 0.4 }),
			{ ...base, steps: RENDER_STEP }
		);
		expect(d).toMatchObject({ continue: false, reason: 'budget_spent' });
		expect(motionUnfinishedNotice(d, 'it')).toContain('3.40');
	});

	it('registro delle spese illeggibile: il tetto non blocca, gli altri due restano', async () => {
		// Un freno che non sa contare non deve fermare il lavoro.
		const d = await decideMotionContinuation(
			fakeDb({ scores: [{ overall: 4, verdict: 'fix' }], spendError: 'boom' }),
			{ ...base, steps: RENDER_STEP }
		);
		expect(d!.continue).toBe(true);
	});

	it('il tetto sulle riprese: 24 e poi basta, comunque vada il giudizio', async () => {
		const d = await decideMotionContinuation(fakeDb({ scores: [{ overall: 2, verdict: 'kill' }] }), {
			...base,
			steps: RENDER_STEP,
			depth: MOTION_MAX_CONTINUATIONS
		});
		expect(d).toMatchObject({ continue: false, reason: 'laps_spent' });
		expect(motionUnfinishedNotice(d, 'it')).toContain(String(MOTION_MAX_CONTINUATIONS));
	});
});

describe('IL TEST CHE CONTA: il giro finisce sempre', () => {
	it('un giudice che boccia sempre allo stesso voto si ferma al secondo giro', async () => {
		// Il caso peggiore vero: ogni giro rende, ogni giro viene bocciato allo stesso voto.
		const scores: Array<{ overall: number; verdict: string }> = [];
		let laps = 0;
		for (let attempt = 0; attempt <= MOTION_MAX_CONTINUATIONS + 5; attempt++) {
			scores.push({ overall: 3.5, verdict: 'kill' });
			const d = await decideMotionContinuation(fakeDb({ scores: [...scores] }), {
				...base,
				steps: RENDER_STEP,
				depth: laps
			});
			if (!d!.continue) {
				expect(d!.reason).toBe('not_improving');
				expect(laps).toBeLessThanOrEqual(2);
				return;
			}
			laps += 1;
		}
		throw new Error('il giro di rilavorazione non si è mai fermato');
	});

	it('un voto che sale di un pelo a ogni giro si ferma comunque, sul tetto delle riprese', async () => {
		// Nessuna porta sul merito lo fermerebbe: lo ferma il contatore, che è il freno stupido —
		// ed è esattamente il motivo per cui c'è.
		const scores: Array<{ overall: number; verdict: string }> = [];
		let laps = 0;
		for (let attempt = 0; attempt <= MOTION_MAX_CONTINUATIONS + 5; attempt++) {
			scores.push({ overall: 3 + attempt * 0.1, verdict: 'fix' });
			const d = await decideMotionContinuation(fakeDb({ scores: [...scores] }), {
				...base,
				steps: RENDER_STEP,
				depth: laps
			});
			if (!d!.continue) {
				expect(d!.reason).toBe('laps_spent');
				expect(laps).toBe(MOTION_MAX_CONTINUATIONS);
				return;
			}
			laps += 1;
		}
		throw new Error('il giro di rilavorazione non si è mai fermato');
	});
});
