/**
 * La base comune delle superfici che PRODUCONO e poi tacciono (Motion, UGC, Media generator):
 * delega, macchina, obiettivo, consegna, e l'impossibilità di dichiararsi finite da sole.
 *
 * **La chat NON passa di qui**, pur essendo la quarta: monta le stesse capacità componendo
 * `withSubagentTools` + `withSandboxTools`, non ha un tool `finish` da guardare e il suo giudice è
 * la persona con cui parla. Passarcela costringeva la base a due opzioni scritte solo per lei, e
 * una di quelle ha prodotto un bug (`surfaceWriteKeys: []` letto come "perimetro vuoto", perché
 * `[]` è truthy).
 *
 * `requireReview` è una GUARDIA, non una raccomandazione: con la delega facoltativa nel prompt il
 * modello non l'ha chiamata nemmeno una volta in 64 step — ha renderizzato, si è riletto e ha detto
 * che andava bene. E non gli si crede sulla parola: `onRun` conta le run di verifica davvero
 * girate, perché "ho fatto rivedere" detto da chi doveva farlo rivedere non è un'informazione.
 */
import { swallow } from '$lib/server/swallow';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentId } from '$lib/server/chat/agents';
import { GROUNDING_BLOCK } from '$lib/server/chat/agents';
import type { ChatModelResolved } from '$lib/server/chat/model';
import {
	MIN_SUBAGENT_RUN_MS,
	createSubagentTools,
	type SubagentRole
} from '$lib/server/chat/subagents';
import { createSandboxTools, type SandboxSession } from '$lib/agent/tools/sandbox-tools';
import { createGoalTools } from '$lib/agent/tools/goal-tools';
import { createArtifactTools } from '$lib/agent/tools/artifact-tools';
import { goalBriefing, loadOpenGoal, openCriteria } from '$lib/server/chat/goal';
import { isSandboxConfigured } from '$lib/server/sandbox';

export type AgentBaseOpts = {
	supabase?: SupabaseClient;
	brandId?: string;
	userId?: string;
	/** Obiettivo e artefatti appartengono a una conversazione: senza thread quei tool spariscono. */
	threadId?: string;
	/** Il modello su cui girano i delegati. Di norma quello del turno. */
	model: ChatModelResolved;
	/** L'hub a cui i delegati appartengono, per il contesto del loro system prompt. */
	defaultAgent: AgentId | null;
	/**
	 * I tool di SCRITTURA di questa superficie: lo scope per hub della chat non conosce
	 * `replace_source` né `patch_clip`, e senza questa lista un esecutore torna a mani vuote.
	 */
	surfaceWriteKeys: string[];
	remainingMs?: () => number;
	locale?: string;
	/** La macchina. `false` la spegne su una superficie dove un terminale non ha senso. */
	sandbox?: boolean;
	/** Se `finish` deve pretendere una review delegata prima di accettare. */
	requireReview?: boolean;
	/** Etichetta per i log della sandbox. */
	label?: string;
};

/** Il rifiuto che `finish` deve restituire tale e quale al modello. */
export type FinishRefusal = { error: string; hint: string } & Record<string, unknown>;

export type AgentBase = {
	/**
	 * Il set completo. Il tipo resta `T` e NON l'unione con i condivisi: intersecare con un
	 * `Record<string, unknown>` porta dentro l'index signature, e da lì `streamText` non infersce
	 * più i tipi di `onFinish`/`onError`. A runtime le chiavi ci sono tutte.
	 */
	attach<T extends Record<string, unknown>>(surfaceTools: T): T;
	/** I blocchi di prompt condivisi: obiettivo, delega, macchina. Da mettere nel system prompt. */
	promptBlock: string;
	/** Le guardie condivise di `finish`. `null` = si può chiudere. */
	guardFinish: () => Promise<FinishRefusal | null>;
	/** Rilascia i file della run nella VM. Da chiamare in `onFinish` e in `onError`. */
	close: () => Promise<void>;
	/** Quante run di verifica sono girate davvero in questo turno. */
	reviewRuns: () => number;
	/** `finish` passato senza review: chi chiude il turno deve DIRLO all'utente. */
	reviewSkipped: () => boolean;
};

const REVIEW_ROLES: SubagentRole[] = ['verify'];

/**
 * Il tetto ai rifiuti di `finish` per review mancante — e senza di lui la guardia butta il lavoro
 * invece di proteggerlo. `onRun` conta solo le run partite DAVVERO, e `runSubagent` esce prima
 * quando il tempo è finito: l'agente veniva rifiutato, delegava a vuoto, richiamava `finish`, e
 * bruciava gli step senza consegnare (due video vuoti in produzione). Dopo due rifiuti si passa, e
 * il risultato di `finish` lo dichiara.
 */
export const MAX_REVIEW_REFUSALS = 2;

export async function createAgentBase(opts: AgentBaseOpts): Promise<AgentBase> {
	const { supabase, brandId, userId, threadId, model, defaultAgent, surfaceWriteKeys } = opts;
	const full = !!(supabase && brandId && userId);
	const label = opts.label ?? defaultAgent ?? 'agent';

	/** Le run di verifica davvero girate, non quelle raccontate. */
	const reviews: Array<{ role: SubagentRole; verdict?: string; error?: string }> = [];
	let reviewRefusals = 0;
	let reviewWasSkipped = false;

	/**
	 * I sotto-agenti devono vedere il set dell'orchestratore, che li include: il giro si chiude
	 * passando l'oggetto vuoto e riempiendolo in `attach`. La factory legge i nomi a ogni run.
	 */
	const container: Record<string, unknown> = {};

	const subagentTools = full
		? createSubagentTools({
				supabase: supabase!,
				brandId: brandId!,
				userId,
				threadId,
				tools: container,
				model,
				locale: opts.locale,
				defaultAgent,
				hubToolKeys: surfaceWriteKeys,
				remainingMs: opts.remainingMs,
				// Inline, non accodate: la guardia di `finish` legge i verdetti ON BANDA — una verifica
				// che rientrasse come nuovo turno arriverebbe dopo che il giro si è già chiuso.
				mode: 'inline',
				onRun: (info) => {
					if (REVIEW_ROLES.includes(info.role)) {
						reviews.push({ role: info.role, verdict: info.verdict, error: info.error });
					}
				}
			})
		: {};

	let sandboxSession: SandboxSession | null = null;
	if (full && opts.sandbox !== false && isSandboxConfigured()) {
		sandboxSession = createSandboxTools({
			supabase: supabase!,
			brandId: brandId!,
			userId,
			threadId,
			// La macchina è dell'agente: è quella che il pannello mostra, ed è lì che l'utente
			// guarda mentre il turno lavora.
			agentId: defaultAgent ?? undefined,
			// `compute` ovunque: "internet aperto + dati del brand su disco" è la combinazione che il
			// sotto-agente `sandbox` tiene separata di proposito. Chi deve navigare delega.
			mode: 'compute',
			remainingMs: opts.remainingMs,
			onLog: (line) => console.log(`[${label} sandbox] brand=${brandId} ${line}`)
		});
	}

	const goalTools =
		full && threadId ? createGoalTools({ supabase: supabase!, brandId: brandId!, userId, threadId }) : {};
	const artifactTools =
		full && threadId
			? createArtifactTools({ supabase: supabase!, brandId: brandId!, userId, threadId })
			: {};
	const openGoal =
		supabase && threadId ? await loadOpenGoal(supabase, threadId).catch((error) => { swallow('load open goal', error); return null; }) : null;

	const en = bilingualNoticeLocale(opts.locale) === 'en';
	const blocks: string[] = [];

	// Non condizionato a niente: è l'unica regola qui che non dipende da quali tool sono montati.
	blocks.push(GROUNDING_BLOCK);

	// Le regole dell'obiettivo stanno nelle descrizioni dei tool; qui solo il DATO che una
	// descrizione non può portare: l'obiettivo aperto in questa conversazione.
	if (Object.keys(goalTools).length && openGoal) {
		blocks.push(goalBriefing(openGoal, en ? 'en' : 'it'));
	}

	if (Object.keys(subagentTools).length) {
		blocks.push(
			[
				'DELEGATION — you are a lead, not only a maker:',
				'- run_task_pipeline splits a long job into research → execution → verification, each with a clean context. run_parallel_tasks fans the SAME role out over pieces that do not know about each other (role="compose": each worker returns its piece in its report and writes nothing, you assemble). delegate_task is one sub-agent for one step.',
				'- The rule of thumb is context, not size: delegate what would fill your window with material you only need once — reading a wall of references, reading the brand, drafting several independent pieces.',
				'- A sub-agent cannot talk to the user and cannot delegate further. What it produces is yours to reconcile before you finish.',
				opts.requireReview
					? '- A REVIEW IS NOT OPTIONAL: before finish you must have run at least one role="verify" sub-agent over the finished work. It reads the real result with a clean context and reports defects. finish is refused until it has run — the point is precisely that the judgement does not come from you.'
					: ''
			]
				.filter(Boolean)
				.join('\n')
		);
	}

	if (sandboxSession) {
		blocks.push(
			'MACHINE — sandbox_exec / sandbox_write_file / sandbox_read_file are a real Linux terminal (Node, Python, package installs), for the times when running something beats reasoning about it. No internet beyond the package registries: to read the web, delegate a role="sandbox" sub-agent with network="research".'
		);
	}

	if (Object.keys(artifactTools).length) {
		blocks.push(
			'DELIVERY — publish_artifact attaches a file to this conversation permanently, for something the user will want to reopen (a report, a spec, a CSV you assembled) instead of a wall of text in your reply.'
		);
	}

	return {
		attach<T extends Record<string, unknown>>(surfaceTools: T): T {
			const set = {
				...subagentTools,
				...goalTools,
				...artifactTools,
				...(sandboxSession?.tools ?? {}),
				// La superficie vince ogni collisione di nome: il mestiere batte la base.
				...surfaceTools
			};
			Object.assign(container, set);
			return set as unknown as T;
		},

		promptBlock: blocks.length ? `${blocks.join('\n\n')}\n` : '',

		async guardFinish(): Promise<FinishRefusal | null> {
			// 1. L'obiettivo che l'agente si è scritto: l'unica cosa nel turno che sa cosa aveva
			//    chiesto l'utente — le guardie di mestiere guardano il prodotto, non la richiesta.
			if (supabase && threadId) {
				const goal = await loadOpenGoal(supabase, threadId).catch((error) => { swallow('load open goal', error); return null; });
				const still = goal ? openCriteria(goal.criteria) : [];
				if (still.length) {
					return {
						error: 'goal_open',
						open: still.map((c) => ({ id: c.id, text: c.text })),
						hint: en
							? `${still.length} criteria of your own goal are still open. Close them with work, or drop the unreachable ones with update_goal and a reason. Then close_goal, then finish.`
							: `${still.length} criteri del tuo obiettivo sono ancora aperti. Chiudili col lavoro, o scarta con update_goal quelli irraggiungibili spiegando perché. Poi close_goal, poi finish.`
					};
				}
			}

			// 2. La review, quando è pretesa E quando è ancora POSSIBILE farla: senza tempo per aprire
			//    una delega, chiederla è un vicolo cieco — non si può obbedire né finire.
			const canStillReview =
				Object.keys(subagentTools).length > 0 &&
				(opts.remainingMs?.() ?? Number.POSITIVE_INFINITY) >= MIN_SUBAGENT_RUN_MS;
			if (opts.requireReview && !reviews.length && canStillReview) {
				if (reviewRefusals < MAX_REVIEW_REFUSALS) {
					reviewRefusals++;
					return {
						error: 'review_missing',
						refusals_left: MAX_REVIEW_REFUSALS - reviewRefusals,
						hint: en
							? 'Nothing has reviewed this work but you, and you are the one who made it. Run delegate_task with role="verify" over the finished result — give it what "done" was supposed to mean — then act on what it reports and call finish again.'
							: 'Questo lavoro non l\'ha guardato nessuno tranne te, che l\'hai fatto. Lancia delegate_task con role="verify" sul risultato finito — passagli cosa doveva voler dire "fatto" — poi agisci su quello che riporta e richiama finish.'
					};
				}
			}
			// Passato senza review: non è un errore, ma non è nemmeno un lavoro verificato.
			if (opts.requireReview && !reviews.length) reviewWasSkipped = true;

			return null;
		},

		close: async () => {
			await sandboxSession?.close().catch((error) => { swallow('close failed', error); return undefined; });
		},

		reviewRuns: () => reviews.length,
		reviewSkipped: () => reviewWasSkipped
	};
}
