/**
 * L'ORCHESTRATORE UGC — la pagina smette di essere una pipeline e diventa un agente.
 *
 * Com'era. `streamUgcBatchResponse` faceva tre cose in fila e nessuna decisione: pianifica N script
 * con un modello (8 passi, un solo colpo), poi `mapPool` rende tutte le clip in parallelo, poi
 * conta quante ne sono uscite. L'unico pezzo agentico era la pianificazione, e finiva prima che
 * esistesse una sola clip — cioè prima di poter sapere qualcosa. Da lì in poi non c'era nessuno:
 * una clip che esce male viene rifatta una volta dalla QC interna e poi tenuta com'è, una clip che
 * fallisce resta fallita, e un batch di dieci che ne consegna sei consegna sei senza che nessuno
 * abbia deciso che andava bene così.
 *
 * Com'è. Il piano e il setup restano dove sono (grounding, casting, cover, riferimenti condivisi:
 * roba che si fa una volta e non è una decisione). Al posto del `mapPool` c'è un agente che ha in
 * mano le stesse primitive scritte come tool — leggere il piano, correggere uno script, rendere UNA
 * clip — più tutto l'arsenale che ha la pagina Motion: sotto-agenti, la macchina, l'obiettivo.
 *
 * LE TRE COSE CHE QUESTO CAMBIA DAVVERO, e che una pipeline non può fare:
 *
 *  1. **Rifare la clip 7 e basta.** Prima l'unità di ritentativo era il batch.
 *  2. **Correggere lo script PRIMA di ripagare la resa.** Una clip che esce male spesso esce male
 *     per il copione, non per il render: `patch_clip` poi `render_clip` costa una resa, rifare il
 *     batch ne costa dieci.
 *  3. **Scrivere i copioni in parallelo, uno per agente.** `run_parallel_tasks` con ruolo `compose`:
 *     un copione per lavoratore, nessuno dei quali scrive sul piano — il montaggio resta a uno solo.
 *     È lo stesso motivo per cui su Motion i beat si parallelizzano e le patch no.
 *
 * COSA NON PUÒ FARE, di proposito. Non pianifica da zero (il piano arriva già fatto: un agente che
 * riparte dal foglio bianco a ogni turno rifà il lavoro del pianificatore pagandolo due volte) e non
 * tocca il casting né la cover, che sono ancore condivise da tutte le clip: cambiarle a metà batch
 * significa un video in cui la persona cambia faccia allo shot cinque, che è esattamente il difetto
 * che il casting esisteva per chiudere.
 */
import { tool, stepCountIs, hasToolCall } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GEMINI_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import { generateText } from 'ai';
import { createHarnessSession } from '$lib/server/harness/session';
import { persistHarnessSession } from '$lib/server/harness/persist';
import { wrapTools } from '$lib/server/harness/pipeline';
import { applyStewardPrepareStep, createSessionSteward } from '$lib/server/harness/steward';
import { llmDefaultModel, llmLanguageModel } from '$lib/server/llm';
import { createAgentBase } from '$lib/server/agent-base';
import { createBrandContextTools } from '$lib/server/brand-context-tools';
import { createMediaLibraryTools } from '$lib/server/media-library-tools';
import { geminiFast } from '$lib/server/chat/model';
import type { UgcClipPlan } from '$lib/server/media-generator/ugc-batch';

/** Passi dell'orchestratore. Rendere dieci clip una per una ne consuma dieci: il tetto le contiene. */
export const UGC_AGENT_MAX_STEPS = 40;

/** Rese per turno, oltre il numero di clip: il margine per correggere e rifare, non per ricominciare. */
export const UGC_AGENT_RENDER_HEADROOM = 4;

export type UgcAgentClipView = {
	index: number;
	status: 'pending' | 'rendered' | 'failed';
	/** Il PERCHÉ del fallimento — senza, "failed" chiede di ritentare alla cieca. */
	failure?: string;
	hook: string;
	body: string;
	cta: string;
	setting: string;
	format?: string | null;
	hook_visual?: string | null;
	product?: string | null;
	model?: string | null;
};

export function clipView(
	plan: UgcClipPlan,
	finished: Set<number>,
	failed: Map<number, string>
): UgcAgentClipView {
	const failure = !finished.has(plan.index) ? failed.get(plan.index) : undefined;
	return {
		index: plan.index,
		status: finished.has(plan.index) ? 'rendered' : failed.has(plan.index) ? 'failed' : 'pending',
		...(failure ? { failure } : {}),
		hook: plan.script.hook,
		body: plan.script.body,
		cta: plan.script.cta,
		setting: plan.setting,
		format: plan.format ?? null,
		hook_visual: plan.hookVisual ?? null,
		product: plan.product?.name ?? null,
		model: plan.model?.name ?? null
	};
}

/**
 * L'esito di UNA resa, letto dalle due strutture che `runOneUgcClip` riempie.
 *
 * Tre esiti, non due: prima una clip fallita finiva in `finished` e questa lettura diceva
 * `rendered` — il pipeline la contava consegnata e la guardia `already_rendered` bloccava il retry
 * per sempre. E un rinvio per deadline (nessuna delle due strutture toccata) diceva `failed` senza
 * un perché. `failed` si controlla PRIMA di `finished`: su una ri-resa di una clip già uscita,
 * `finished` la contiene ancora e l'esito di QUESTO tentativo sta nella mappa dei fallimenti.
 */
export function renderOutcome(
	index: number,
	finished: Set<number>,
	failed: Map<number, string>
): 'rendered' | 'failed' | 'deferred' {
	if (failed.has(index)) return 'failed';
	if (finished.has(index)) return 'rendered';
	return 'deferred';
}

/**
 * Il brief dell'orchestratore. Sta qui e non inline perché è il testo che decide se l'agente usa
 * davvero i tool nuovi o si limita a chiamare `render_clip` dieci volte — cioè se questa modifica
 * vale qualcosa o è una pipeline con più passaggi.
 */
export function ugcAgentSystemPrompt(opts: {
	brandName: string;
	videoCount: number;
	/** Obiettivo, delega, macchina, consegna: li scrive `agent-base.ts`, uguali per tutte e quattro. */
	sharedBlock: string;
}): string {
	return `You are Anomalia UGC Producer for the "${opts.brandName}" brand. A batch of ${opts.videoCount} UGC clip${opts.videoCount === 1 ? '' : 's'} has been planned and the shared materials (cast portrait, product still, cover) are already shot. You are the producer: you decide what actually gets rendered, in what order, and what to fix before paying for a render.

${opts.sharedBlock}
WHAT A RENDER COSTS. Every render_clip call spends real credits and about a minute. That is the single fact that should shape everything you do: reading the plan is free, fixing a script is free, rendering is not.

HOW TO WORK:
1. read_plan first. Look at the scripts as a SET, not one by one: ${opts.videoCount} clips that all open on the same beat is a batch that looks like one clip rendered ${opts.videoCount} times, and that is the most common way this feature disappoints.
2. Fix what is wrong BEFORE rendering it. patch_clip is free. A hook that states the product instead of a painful moment, a body with no proof, a CTA that is a slogan, two clips with the same opening — patch them now, not after you have paid to see them.
3. Then render. render_clip one at a time when you want to look at how it went; render_pending when the plan is sound and you just want the batch out.
4. A clip that FAILS is not automatically a clip to re-render. Read why. If the script asked for something the renderer cannot stage, patch it and then render — re-rendering an impossible brief buys the same failure twice.
5. finish when every clip is either rendered or explicitly given up on, with the reason. Never finish with clips still pending and no explanation.

SPLITTING A BATCH:
- Rewriting several scripts at once: run_parallel_tasks with role="compose", ONE TASK PER CLIP. Each worker returns its script in its report and writes nothing; you apply them with patch_clip. shared_context must carry what all of them need — the brand, the product, the cast, and what the other clips already cover — because they cannot see each other, and two workers inventing the same hook is the failure mode here.
- Do NOT delegate a single patch: a delegation costs a whole model run and a patch is free.
- The verify sub-agent you owe before finish gets the RENDERED clips to judge, not your account of them.

Write your final message in the user's language, short: what you rendered, what you fixed and why, what you gave up on.`;
}

export type UgcAgentDeps = {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
	threadId?: string;
	brandName: string;
	plans: UgcClipPlan[];
	/** Rende UNA clip: è `runOneUgcClip` col contesto già legato dal chiamante. */
	renderClip: (plan: UgcClipPlan) => Promise<void>;
	/** Le clip riuscite — la riempie `runOneUgcClip`, qui si legge soltanto. */
	finished: Set<number>;
	/** Indice → ragione del fallimento — la riempie `runOneUgcClip`, condivisa col pipeline. */
	failed: Map<number, string>;
	remainingMs?: () => number;
	abortSignal?: AbortSignal;
	/** Quante clip alla volta quando l'agente chiede di rendere il resto. */
	concurrency: number;
	locale?: string;
};

export type UgcAgentOutcome = {
	rendered: number;
	failedIndexes: number[];
	patched: number;
	steps: number;
	calledFinish: boolean;
	summary: string;
};

export async function runUgcOrchestrator(deps: UgcAgentDeps): Promise<UgcAgentOutcome> {
	const { supabase, brandId, userId, plans, finished, failed } = deps;
	let patched = 0;
	let renders = 0;
	let calledFinish = false;
	let summary = '';
	const maxRenders = plans.length + UGC_AGENT_RENDER_HEADROOM;
	/** Clip già uscite ma ripatchate: le uniche già-rese che `render_clip` può ripagare. */
	const repatched = new Set<number>();
	/** Rifiuti della guardia-a-parole di finish: al secondo identico si passa con un avviso. */
	let pendingRefusals = 0;

	const byIndex = new Map(plans.map((p) => [p.index, p]));

	/**
	 * Rende una clip e registra l'esito. `runOneUgcClip` non lancia: segna `finished` sul successo,
	 * `failed` (con la ragione) sul fallimento, NIENTE quando rinvia per deadline — e i tre casi
	 * vanno tenuti distinti, perché un rinvio riportato come fallimento senza perché era l'origine
	 * dei retry alla cieca.
	 */
	async function render(plan: UgcClipPlan): Promise<'rendered' | 'failed' | 'deferred'> {
		renders += 1;
		// Si azzera il fallimento precedente così l'esito letto dopo è di QUESTO tentativo.
		failed.delete(plan.index);
		await deps.renderClip(plan);
		const outcome = renderOutcome(plan.index, finished, failed);
		// Rinviata: nessuna VM aperta, nessun credito speso — il budget non si consuma.
		if (outcome === 'deferred') renders = Math.max(0, renders - 1);
		else repatched.delete(plan.index);
		return outcome;
	}

	const contextTools = createBrandContextTools({ supabase, brandId });
	const libraryTools = createMediaLibraryTools({ supabase, brandId, userId });

	/**
	 * LA BASE COMUNE — la stessa di Motion, della chat e del Media generator. Delega, macchina,
	 * obiettivo, artefatti e le guardie condivise di `finish` non sono di questa pagina.
	 */
	const base = await createAgentBase({
		supabase,
		brandId,
		userId,
		threadId: deps.threadId,
		model: (() => {
			const b = geminiFast();
			const id = llmDefaultModel();
			return id === b.modelId ? b : { ...b, model: llmLanguageModel(id), modelId: id };
		})(),
		defaultAgent: 'ugc',
		// I nomi di QUESTA superficie: senza, lo scope per hub taglia ogni scrittura.
		surfaceWriteKeys: ['patch_clip', 'render_clip', 'render_pending'],
		remainingMs: deps.remainingMs,
		locale: deps.locale,
		// Un batch di clip è un artefatto che qualcuno guarderà: la review non è facoltativa.
		requireReview: true,
		label: 'UGC'
	});

	const tools = base.attach({
		...contextTools,
		...libraryTools,

		read_plan: tool({
			description:
				'The current state of every clip in this batch: script (hook/body/cta), setting, format, which product and cast member it uses, and whether it is still pending, already rendered, or failed. Free — read it before you decide anything, and again after a render.',
			inputSchema: z.object({}),
			execute: async () => ({
				clips: plans.map((p) => clipView(p, finished, failed)),
				rendered: finished.size,
				pending: plans.filter((p) => !finished.has(p.index) && !failed.has(p.index)).length,
				failed: failed.size,
				renders_left: Math.max(0, maxRenders - renders)
			})
		}),

		patch_clip: tool({
			description:
				'Rewrite parts of ONE clip’s script before it is rendered. Free, and the cheapest thing you can do: a clip that comes out wrong is usually wrong in the script, and fixing that costs one render instead of a whole batch. Only affects future renders of that clip.',
			inputSchema: z.object({
				index: z.number().int().min(0).describe('Clip index from read_plan'),
				hook: z.string().max(300).optional().describe('The call-out: a painful moment mid-conversation, never the product’s name'),
				body: z.string().max(600).optional().describe('Cost, then the mechanic out loud, then one proof'),
				cta: z.string().max(300).optional().describe('Qualify the viewer plus a soft action — never a slogan'),
				setting: z.string().max(300).optional().describe('Where it is shot'),
				hook_visual: z.string().max(300).optional().describe('What is on screen in second one'),
				why: z.string().max(300).describe('One line: what was wrong. Kept in the trace.')
			}),
			execute: async (input: {
				index: number;
				hook?: string;
				body?: string;
				cta?: string;
				setting?: string;
				hook_visual?: string;
				why: string;
			}) => {
				const plan = byIndex.get(input.index);
				if (!plan) return { error: 'unknown_index', hint: 'Call read_plan for the valid indexes.' };
				if (input.hook !== undefined) plan.script.hook = input.hook;
				if (input.body !== undefined) plan.script.body = input.body;
				if (input.cta !== undefined) plan.script.cta = input.cta;
				if (input.setting !== undefined) plan.setting = input.setting;
				if (input.hook_visual !== undefined) plan.hookVisual = input.hook_visual;
				patched += 1;
				// Una clip già USCITA si può ripatchare: prima il rifiuto qui, sommato al rifiuto di
				// render_clip sulle già-rese, rendeva "patcha e ri-rendi" — il consiglio dei suoi
				// stessi hint — impossibile da eseguire. Il patch la marca, e render_clip la accetta.
				if (finished.has(input.index)) repatched.add(input.index);
				return {
					ok: true,
					clip: clipView(plan, finished, failed),
					patched_so_far: patched,
					...(finished.has(input.index)
						? {
								note: 'This clip is already out: the patch takes effect only if you re-render it with render_clip, which costs one render. Do it only if the fix is worth another credit.'
							}
						: {})
				};
			}
		}),

		render_clip: tool({
			description:
				'Render ONE clip. Spends credits and about a minute. Use it when you want to act on how a specific clip turns out — a retry after a patch, or the first one of a batch you are unsure about.',
			inputSchema: z.object({
				index: z.number().int().min(0).describe('Clip index from read_plan')
			}),
			execute: async ({ index }: { index: number }) => {
				const plan = byIndex.get(index);
				if (!plan) return { error: 'unknown_index' };
				// Rifiutata solo se già uscita E non ripatchata: una fallita è sempre ritentabile
				// (il tentativo consuma budget), e una uscita-ma-ripatchata è l'unico re-render
				// legittimo di una clip buona. Prima QUALSIASI già-resa era bloccata per sempre —
				// comprese le fallite, che `finished` inghiottiva.
				if (finished.has(index) && !repatched.has(index)) {
					return { error: 'already_rendered', hint: 'Already out and unchanged since. patch_clip it first if something is wrong — do not pay for the same take twice.' };
				}
				if (renders >= maxRenders) {
					return {
						error: 'render_budget_spent',
						hint: `${maxRenders} renders is the ceiling for this turn. Finish with what is out and say what is missing.`
					};
				}
				const outcome = await render(plan);
				return {
					index,
					outcome,
					...(outcome === 'failed' ? { reason: failed.get(index) ?? null } : {}),
					rendered: finished.size,
					renders_left: Math.max(0, maxRenders - renders),
					hint:
						outcome === 'failed'
							? 'Read the reason before re-rendering. If the script asked for something that cannot be staged, patch_clip first — re-rendering an impossible brief buys the same failure twice.'
							: outcome === 'deferred'
								? 'Not rendered and not failed: this slice ran out of time before the render could start. The clip stays pending — a continuation will pick it up; no budget was spent.'
								: 'Out. Move to the next one.'
				};
			}
		}),

		render_pending: tool({
			description:
				'Render every clip that is still pending, several at a time. Use it once the plan is sound and you just want the batch out — it is the fast path, not the careful one.',
			inputSchema: z.object({
				reason: z.string().max(200).describe('One line: why the plan is ready to go out as it stands.')
			}),
			execute: async () => {
				const pending = plans.filter((p) => !finished.has(p.index) && !failed.has(p.index));
				if (!pending.length) return { error: 'nothing_pending', rendered: finished.size };
				const allowed = pending.slice(0, Math.max(0, maxRenders - renders));
				if (!allowed.length) {
					return { error: 'render_budget_spent', rendered: finished.size };
				}
				let cursor = 0;
				const lane = async () => {
					for (;;) {
						const i = cursor++;
						if (i >= allowed.length) return;
						if (deps.abortSignal?.aborted) return;
						await render(allowed[i]);
					}
				};
				await Promise.all(
					Array.from({ length: Math.min(deps.concurrency, allowed.length) }, lane)
				);
				return {
					attempted: allowed.length,
					rendered: finished.size,
					failed: [...failed].map(([index, reason]) => ({ index, reason })),
					skipped_for_budget: pending.length - allowed.length,
					renders_left: Math.max(0, maxRenders - renders)
				};
			}
		}),

		finish: tool({
			description:
				'End the batch. Call it when every clip is either rendered or explicitly given up on with a reason. Never with clips still pending and nothing said about them.',
			inputSchema: z.object({
				summary: z.string().max(600).describe('What went out, what you fixed and why, what you gave up on')
			}),
			execute: async ({ summary: s }: { summary: string }) => {
				// Le guardie condivise: l'obiettivo che l'agente si è scritto, e la review delegata.
				const refusal = await base.guardFinish();
				if (refusal) return refusal;

				const pending = plans.filter((p) => !finished.has(p.index) && !failed.has(p.index));
				// La guardia a parole è un euristico, non un tribunale: al secondo rifiuto identico si
				// passa con un avviso — lo stesso patto di ogni altra guardia di finish in giro (vedi
				// MAX_FINISH_REFUSALS su Motion). Un lessico che il regex non riconosce ("ho deciso di
				// fermarmi qui") non deve poter murare il turno fino al tetto di step.
				if (pending.length && !/\b(salt|skip|rinunc|give up|lasci|non rend|stop|fermo|abandon)/i.test(s)) {
					if (pendingRefusals < 1) {
						pendingRefusals += 1;
						return {
							error: 'clips_pending',
							pending: pending.map((p) => p.index),
							hint: `${pending.length} clip non sono ancora state rese e il tuo riassunto non dice perché. Rendile, o di' esplicitamente a cosa rinunci e per quale motivo.`
						};
					}
				}
				calledFinish = true;
				summary = s.trim();
				return {
					ok: true as const,
					rendered: finished.size,
					failed: [...failed].map(([index, reason]) => ({ index, reason })),
					...(pending.length
						? {
								warning: `${pending.length} clip left pending — tell the user which ones and why they were not rendered.`
							}
						: {}),
					...(base.reviewSkipped()
						? {
								unreviewed: true,
								tell_the_user:
									'Say plainly that there was no time left for an independent review of this batch.'
							}
						: {})
				};
			}
		})
	});

	let steps = 0;
	const system = ugcAgentSystemPrompt({
		brandName: deps.brandName,
		videoCount: plans.length,
		sharedBlock: base.promptBlock
	});
	const prompt = `The batch is planned and the shared materials are shot. Produce it.\n\nStart with read_plan.`;
	const session = createHarnessSession({
		brandId,
		userId,
		agent: 'ugc_producer',
		mode: String(plans.length),
		model: llmDefaultModel(),
		provider: 'llm',
		surface: 'batch'
	});
	session.captureRequest({ system, prompt });

	const steward = createSessionSteward(session, Object.keys(tools));
	const watchedTools = wrapTools(session, tools, steward.pipeline());

	try {
		const res = await generateText({
			model: llmLanguageModel(llmDefaultModel()),
			maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
			system,
			prompt,
			allowSystemInMessages: true,
			tools: watchedTools,
			stopWhen: [hasToolCall('finish'), stepCountIs(UGC_AGENT_MAX_STEPS)],
			abortSignal: deps.abortSignal,
			prepareStep: () => {
				const patched = applyStewardPrepareStep(session, steward, {}, system) ?? {};
				session.capturePrepareStep(patched);
				return patched;
			},
			onStepFinish: (event) => {
				session.recordStep(event);
			}
		});
		session.recordAssistantText(res.text);
		session.recordUsage(res.totalUsage ?? res.usage);
		session.finish('finished');
		steps = Array.isArray(res?.steps) ? res.steps.length : 0;
		if (!summary && typeof res?.text === 'string') summary = res.text.trim();
	} catch (e) {
		session.finish('failed', e);
		console.error('[ugc-agent] orchestrator failed', e);
		// L'orchestratore che muore non deve portarsi dietro il batch: quello che è già reso è reso,
		// e il chiamante decide se continuare in un'altra slice.
	} finally {
		persistHarnessSession(session);
		await base.close();
	}

	return {
		rendered: finished.size,
		failedIndexes: [...failed.keys()],
		patched,
		steps,
		calledFinish,
		summary
	};
}
