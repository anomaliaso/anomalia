/**
 * IL PONTE VERSO LA CHAT VERA — l'UNICO file che sa come il sistema nuovo (`src/lib/agent/`)
 * si innesta nel motore esistente (`src/routes/app/[brand]/chat/+server.ts`). Tutto il resto
 * di quel file resta esattamente com'è: qui dentro c'è la logica, là fuori solo il ramo che
 * decide se chiamarla (vedi `shouldUseKit`).
 *
 * Perché `startHarnessTurn` e non `AiRuntime.run()` (l'AsyncIterable del runtime): il motore
 * esistente parla al client con `result.toUIMessageStreamResponse(...)`, e quel metodo esiste
 * sullo STESSO `StreamTextResult` che l'harness restituisce. Passare per l'AsyncIterable del
 * runtime significherebbe ricostruire da zero il formato SSE che il client già sa leggere — la
 * traduzione `ToolSpec[]` → `ToolSet` resta condivisa (`buildTools`, esportata da
 * `runtime/ai-runtime.ts` per questo).
 *
 * IL RIPIEGO ONESTO quando il turno finisce senza `reply` NON è cosa di questo file: la priorità
 * (reply esplicito > testo del turno, SOLO se la reason è 'completed' > `honestNotice`) è
 * centralizzata in `turn.ts` per non farla divergere per superficie — qui si IMPORTA
 * `honestNotice`, non se ne riscrive una copia. Lo stream dell'harness non invoca callback di
 * fine turno: è il consumo server-side qui sotto a chiamare `handleFinish` con `result.steps`
 * e `result.text` — `text` = testo dell'ultimo step, come faceva `streamText.onFinish`.
 */
import { isStepCount, type ModelMessage } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	CHAT_HEARTBEAT_INTERVAL_MS,
	KIT_RUN_STOPPED_BY_USER,
	chatTokenBudget,
	chatTurnDeadline,
	kitRunIsAlive,
	turnTruncatedNotice,
	harnessStartTimeoutMs,
	HARNESS_SILENCE_TIMEOUT_MS,
	HARNESS_ABORT_FORCE_CLOSE_MS,
	type KitRunLiveness
} from '$lib/server/chat/turn-limits';
import { DM_REPLY_STEP_CAP, dmBrief } from '$lib/chat-dm';
import { agentDesktopEnabled } from '$lib/server/agent-desktop';
import { UNATTENDED_TOOL_EXCLUSIONS, UNATTENDED_KIT_TOOL_EXCLUSIONS } from '$lib/server/chat/unattended';
import { logAiCall, extractSdkUsage } from '$lib/server/ai-log';
import { filesIndexFor } from '$lib/server/chat/agent-files';
import { resolveAgent, teamBlock } from '$lib/server/chat/agents';
import { assistantContentFromSteps, messagesFromRow, touchThread } from '$lib/server/chat/persistence';
import { assistantContentFromPartial, type ChatPartialSnapshot } from '$lib/server/chat/partial-persist';
import { createQueryTool, type QueryToolDeps } from '$lib/server/chat/query-tool';
import { CHAT_USER_ERROR } from '$lib/server/chat/report-error';
import { enqueueTurnContinuation, kickChatQueueWork } from '$lib/server/chat/queue';
import { applyChatStreamEvent, closeDanglingToolCalls, emptyStreamState, readSseEvents, toolsForMirror } from '$lib/chat-stream-events';
import { isChatMode, modeBlock, toolsForMode, type ChatMode } from '$lib/chat-modes';
import { broadcastToBrand } from '$lib/server/realtime';
import { specById } from '../specs';
import type { AgentSpec } from '../contracts';
import { createApplyTool, buildSystemPrompt } from '../executor';
import { chatReplyLanguageBlock } from '$lib/i18n/locale';
import { honestNotice } from '../turn';
import { loadMemoryContext } from '../memory-context';
import { closeTurnVerdict, MAX_VERDICT_LAPS } from './verdict';
import {
	createChatLoopGuard,
	isRepeatedReply,
	repeatedReplyContinuation,
	repeatedReplyNotice,
	turnLoopNotice
} from '$lib/server/chat/loop-guard';

/**
 * Ogni quanto lo specchio riscrive `agent_kit_runs.partial`. Chi ricarica la pagina vede il testo
 * fino all'ultima scrittura: a 1000ms perdeva fino a un secondo di risposta e, su un turno breve,
 * tutto. v1 scriveva ogni 300ms e funzionava; qui si sta a 100 perché il costo è una riga
 * riscritta, e il beneficio è entrare in una chat viva nel punto esatto in cui sta.
 */
const PARTIAL_MIRROR_MS = 100;

/**
 * GLI EVENTI CHE NON POSSONO ASPETTARE IL THROTTLE.
 *
 * Lo specchio scrive quando arriva un chunk, e con la strozzatura a 100ms l'evento che apre una
 * tool call — che arriva a ridosso degli argomenti appena emessi — veniva quasi sempre saltato.
 * Poi il tool parte, il modello tace per minuti, e nessun chunk arriva piu` a far scrivere:
 * `partial` resta senza la chiamata in corso. Chi ricarica la pagina non vede nessuna invocazione
 * viva e legge la chat come bloccata, che e` esattamente cio` che sta succedendo tranne che non
 * e` vero.
 *
 * Sono tre eventi rari e sono i soli che la UI deve vedere subito: non e` un firehose.
 */
const PARTIAL_FLUSH_EVENTS = new Set(['tool-input-available', 'tool-output-available', 'tool-output-error']);

const TURN_MAX_STEPS = 75;

/** Il turno vivo di ogni thread, per i tool che una sessione riusata ha cotto in un turno prima. */
const liveTurnByThread = new Map<string, { stopped: boolean; closedBy: string }>();
import { attachForChat } from './attach';
import { buildTools } from '@anomalia/agent-adapters/runtime/ai-runtime';
import { createCheckpointStorage } from '@anomalia/agent-adapters/checkpoint-storage';
import { markComputerRunning, touchComputer } from '@anomalia/agent-core/computer';
import { createEffectsLedger } from '@anomalia/agent-core/effects-store';
import {
	createServerBrandFs,
	createPostgresMemoryStore,
	createVercelSandboxProvider,
	graphicalBootstrapDeps,
	openBrandHarnessSession,
	dropLiveHarnessSession,
	hasLiveHarnessSession,
	resolveHarnessModelRef,
	startHarnessTurn
} from './adapters';
import { reportChatError } from '$lib/server/chat/report-error';
import { BUILTIN_TOOLS } from '../tools/builtin';
import { createRun, transition, finish, resume, closeRunSaving, type CloseMessage, type CloseOutcome, type RunRow } from '../run-store';
import type { AdapterContext, RunStopReason, ToolResult } from '../kit/types';
import { createMotionPlugin } from '../plugins/motion';
import { createContentPlugin } from '../plugins/content';
import { createUgcPlugin } from '../plugins/ugc';
import { createWebPlugin } from '../plugins/web';
import { createTeamPlugin } from '../plugins/team';
import { createDelegationPlugin } from '../plugins/delegation';
import { createSubagentTools, SUBAGENT_TOOL_KEYS } from '$lib/server/chat/subagents';
import { resolveChatModel } from '$lib/server/chat/model';
import { createGoalPlugin, withKitToolNames } from '../plugins/goal';
import { kitPluginsFor } from '../plugins/registry';
import { GOAL_TOOL_KEYS } from '$lib/server/chat/goal-tools';
import { CHAT_MAX_CONTINUATIONS } from '$lib/server/chat/turn-limits';
import {
	goalBriefing,
	goalNudge,
	goalWorthyRequest,
	loadOpenGoal,
	settleGoalForTurn,
	trackGoalSettlement,
	type ChatGoal
} from '$lib/server/chat/goal';

/**
 * La condizione pura che il ramo nel motore esistente valuta: flag ON *E* uno specialista
 * riconosciuto sul thread. Pura — nessun accesso a `$env` qui dentro — così il test la chiama
 * con un oggetto env finto invece di dover mockare un modulo SvelteKit.
 */
export function shouldUseKit(
	env: { AGENT_KIT?: string },
	agentId: string | null | undefined
): AgentSpec | null {
	if (env.AGENT_KIT !== 'on') return null;
	if (!agentId) return null;
	return specById(agentId);
}

export interface RunKitTurnInput {
	/** Client con la sessione dell'utente (anon key + JWT): RLS vera per `query`/brand-fs/memoria. */
	supabase: SupabaseClient;
	/** Client service-role: SOLO per lo stato del run in `agent_kit_runs` (mai per i dati del brand). */
	admin: SupabaseClient;
	brand: { id: string; slug?: string | null };
	user: { id: string };
	threadId: string;
	spec: AgentSpec;
	/** Storia + il turno utente già persistito — pronta per il turno dell'harness. */
	messages: ModelMessage[];
	locale: 'en' | 'it';
	/** Giri del giudice di chiusura già fatti su questa catena (verdict.ts). */
	verdictLaps?: number;
	/** La modalità scelta nel composer (agent|plan|ask). Senza, l'accesso pieno di sempre. */
	mode?: unknown;
	/** Il tier scelto dall'utente nel composer (auto|fast|pro…). Senza, il bridge cablava 'auto'. */
	tier?: unknown;
	modelFamily?: unknown;
	/** Lo sforzo di ragionamento scelto dall'utente. */
	reasoning?: unknown;
	/**
	 * Il testo dell'ultimo messaggio utente: è ciò che alimenta la scalata Auto→Pro
	 * (`isHeavyProductionAsk` in model.ts apre con `if (!text) return false`, quindi senza
	 * questo la scalata NON scatta MAI e ogni specialista che non sia motion cade sul default).
	 */
	escalationText?: string;
	/**
	 * Riprese automatiche già fatte su QUESTA catena — lo stesso contatore del motore classico
	 * (`chat_jobs.input_params.continuation_depth`), che è anche dove vive fra un turno e l'altro:
	 * il run kit non ha una colonna sua e non gliene serve una, perché la catena la porta avanti
	 * la coda. Zero su un turno avviato da una persona.
	 */
	continuationDepth?: number;
	/**
	 * Il tempo che questo turno può bruciare. Vuoto = il budget del muro serverless. Il drain
	 * passa la propria fetta, che si accorcia man mano che macina job.
	 */
	budgetMs?: number;
	/**
	 * `platform.context.waitUntil` di Vercel. SENZA, la piattaforma considera finita
	 * l'invocazione appena la Response è consegnata e UCCIDE il lavoro in corso: il turno
	 * moriva a metà quando l'utente ricaricava o perdeva la rete (visto in produzione il
	 * 23/8: run vissuto 107 secondi, poi silenzio, `onFinish` mai eseguito). Dichiarare il
	 * lavoro di sfondo è l'unico modo di farlo sopravvivere alla disconnessione del client.
	 */
	waitUntil?: (p: Promise<unknown>) => void;
	/**
	 * Origin della richiesta, per svegliare il drain della coda quando il run finisce. Il percorso
	 * classico kicka su OGNI uscita del turno; il kit non lo faceva, e un follow-up accodato (che
	 * il drain salta finché il run kit è vivo) restava fermo fino al giro del cron — due minuti di
	 * attesa morta dopo un turno già concluso.
	 */
	origin?: string;
	/**
	 * Il contesto del DM fra agenti: chi parla, per chi. Il turno nasce DM — blocco in testa al
	 * prompt, niente tool che presuppongono una persona, risposta firmata, nessuna ripresa
	 * automatica. Senza, è un normale turno kit.
	 */
	dm?: { speaker: string; meName: string; otherName: string };
}

/**
 * La storia ricaricata porta `providerOptions`/`providerMetadata` con gli `itemId` della
 * risposta precedente: il provider Responses li ritraduce in `item_reference`, che kie
 * rifiuta con un 422 («unknown item type "item_reference"») — successo davvero alle 13:06
 * del 23/8, turno morto. La storia riparte pulita: il contenuto resta, i riferimenti no.
 * (Vedi provider-refs.ts per il perché delle parti immagine.)
 */
import { stripProviderRefs, carryImagesToContinuation } from './provider-refs';

/** L'ultima tool call del turno, su tutti gli step — decide come si chiude il run. */
type StepLike = { toolCalls?: ReadonlyArray<{ toolName: string; input?: unknown }> };
function lastToolCall(steps: readonly StepLike[]): { toolName: string; input?: unknown } | null {
	for (let i = steps.length - 1; i >= 0; i--) {
		const calls = steps[i]?.toolCalls ?? [];
		if (calls.length) return calls[calls.length - 1];
	}
	return null;
}

/**
 * Un chunk UI message per lo specchio Realtime: piccolo così com'è (text-delta è già solo un
 * delta). L'unico caso grasso è un tool-output-available con un risultato voluminoso — lì si
 * butta via il payload e si tiene solo l'identità dell'evento, mai il testo del turno.
 */
function shrinkChunkForBroadcast(chunk: unknown): unknown {
	if (!chunk || typeof chunk !== 'object') return chunk;
	const { output: _output, input: _input, ...rest } = chunk as Record<string, unknown>;
	return rest;
}

/**
 * Le parti del turno → le colonne della riga assistant, la STESSA sagoma dell'assistant branch di
 * `saveMessages` (persistence.ts): qui si replica perché l'insert non passa più di lì — lo fa la
 * RPC `agent_kit_close_run`, nella stessa transazione che chiude il run. Se cambia la sagoma là,
 * va cambiata anche qui.
 */
function closeMessageFields(
	content: Array<{ type: string; text?: string }>,
	attachments: string[]
): CloseMessage {
	const text = content.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n\n');
	const reasoning = content.filter((p) => p.type === 'reasoning').map((p) => p.text ?? '').join('\n');
	const hasToolCalls = content.some((p) => p.type === 'tool-call');
	return {
		content: text,
		reasoning: reasoning || undefined,
		toolCalls: hasToolCalls ? content.filter((p) => p.type === 'tool-call' || p.type === 'text') : undefined,
		attachments: attachments.length ? [...attachments] : undefined
	};
}

/** `createQueryTool` (un `tool()` dell'SDK, Zod) → la forma che l'executor del kit si aspetta. */
function queryToolAdapter(deps: QueryToolDeps) {
	const { query } = createQueryTool(deps);
	return async (args: Record<string, unknown>, ctx: AdapterContext): Promise<ToolResult> => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const out = (await query.execute!(args as any, {
			toolCallId: `query:${ctx.runId}`,
			messages: [],
			abortSignal: ctx.signal
		})) as Record<string, unknown>;
		return { content: [{ type: 'text', text: JSON.stringify(out) }], isError: 'error' in out };
	};
}

/**
 * Un run `running` ANCORA VIVO su questo thread. Dopo un refresh la sessione client è vuota e
 * niente lato client impedisce un secondo invio: senza questo check si creava un secondo run
 * concorrente sullo stesso thread. Uno zombie oltre soglia NON blocca, lo chiude il reaper.
 */
async function liveRunningRun(db: SupabaseClient, threadId: string): Promise<boolean> {
	const { data } = await db
		.from('agent_kit_runs')
		.select('state, heartbeat_at, created_at')
		.eq('thread_id', threadId)
		.eq('state', 'running')
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	return !!data && kitRunIsAlive(data as KitRunLiveness);
}

/**
 * Chiamarli non è aver fatto qualcosa: parlano, chiedono o tengono i conti dell'obiettivo. Il
 * lavoro NUOVO di un turno è tutto il resto — è la lista che il giudice degli obiettivi e la
 * guardia anti-ripetizione guardano per non scambiare la contabilità per una consegna.
 */
const BOOKKEEPING_TOOLS = new Set<string>(['reply', 'ask_user', ...GOAL_TOOL_KEYS]);

function lastUserText(messages: ModelMessage[]): string {
	const last = [...messages].reverse().find((m) => m.role === 'user');
	if (typeof last?.content === 'string') return last.content;
	return JSON.stringify(last?.content ?? '').slice(0, 1200);
}

function historyTail(messages: ModelMessage[]): string {
	return messages
		.slice(-16)
		.map((m) => `${String(m.role).toUpperCase()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content).slice(0, 400)}`)
		.join('\n')
		.slice(-8_000);
}

function lastAssistantText(messages: ModelMessage[]): string {
	const prev = [...messages].reverse().find((m) => m.role === 'assistant');
	const c = prev?.content as unknown;
	if (typeof c === 'string') return c;
	if (Array.isArray(c)) {
		return c
			.map((p) => (p && typeof p === 'object' && (p as { type?: string }).type === 'text' ? String((p as { text?: string }).text ?? '') : ''))
			.filter(Boolean)
			.join('\n');
	}
	return '';
}

/** Un run `waiting_input` per questo thread, se c'è — il turno corrente ne è la risposta. */
async function currentWaitingRun(db: SupabaseClient, threadId: string): Promise<string | null> {
	const { data } = await db
		.from('agent_kit_runs')
		.select('id')
		.eq('thread_id', threadId)
		.eq('state', 'waiting_input')
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	return (data as { id: string } | null)?.id ?? null;
}

/** Fa girare UN turno sul sistema nuovo e restituisce la `Response` che il client già sa leggere. */
export async function runKitTurn(input: RunKitTurnInput): Promise<Response> {
	const { supabase, admin, brand, user, threadId, spec, messages, locale } = input;
	const mode: ChatMode = isChatMode(input.mode) ? input.mode : 'agent';
	const isDm = !!input.dm;

	let run: RunRow;
	const waitingId = await currentWaitingRun(admin, threadId);
	if (waitingId) {
		// DOPPIO RESUME: due dispositivi rispondono insieme a una `waiting_input`. Il primo vince
		// il compare-and-swap di `resume()`; il secondo lo trova già spostato e riceverebbe il
		// 500 grezzo di `run: stato cambiato sotto le mani` — un'azione legittima (ha solo perso
		// la corsa), non un errore di sistema. Risposta pulita, stesso 409 ritentabile del busy
		// qui sotto, con un messaggio che l'utente capisce.
		try {
			({ run } = await resume(admin, waitingId));
		} catch (e) {
			if (e instanceof Error && e.message.includes('stato cambiato sotto le mani')) {
			// API payload, non chat: nessuna persona la legge in un fumetto. In inglese comunque,
			// come ogni nota che il backend consegna fuori dal proprio turno.
			return new Response(
				JSON.stringify({ error: 'resume_conflict', message: 'Someone else already replied in this conversation.' }),
				{ status: 409, headers: { 'Content-Type': 'application/json' } }
			);
			}
			throw e;
		}
	} else {
		// Un turno alla volta per thread: 409 (ritentabile) invece di un secondo run concorrente.
		if (await liveRunningRun(admin, threadId)) {
			// `user_message_saved`: questo busy arriva DOPO che il POST ha già persistito il
			// messaggio dell'utente (chat/+server.ts salva prima di chiamare qui). Il client
			// ripiega sull'enqueue, e senza questo flag il drain non riconosce la riga già a terra
			// — confronta solo il TAIL della history, che intanto è la risposta del run vincente —
			// e la salva una seconda volta.
			return new Response(JSON.stringify({ error: 'busy', user_message_saved: true }), {
				status: 409,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		run = await createRun(admin, { brandId: brand.id, threadId, agentId: spec.id, userId: user.id });
		run = await transition(admin, run.id, 'queued', 'running', { heartbeat_at: new Date().toISOString() });
	}

	const ctx: AdapterContext = { brandId: brand.id, userId: user.id, runId: run.id, locale, agentId: spec.id };

	// Il run è finito (bene o male): sveglia il drain, che finché `state='running'` saltava ogni
	// follow-up accodato su questo thread. Sempre DOPO `finish`/`closeRun`, altrimenti vede il run
	// ancora vivo e riscarta il job.
	const kickQueue = () => {
		if (input.origin) void kickChatQueueWork(input.origin);
	};

	let turnHeartbeat: ReturnType<typeof setInterval> | null = null;
	const stopTurnHeartbeat = () => {
		if (turnHeartbeat) clearInterval(turnHeartbeat);
		turnHeartbeat = null;
	};

	try {
		const modelRef = resolveHarnessModelRef({ family: input.modelFamily, tier: input.tier });
		if (!modelRef) throw new Error('harness_model_missing: nessun modello configurato per il provider attivo');
		console.log(
			`[AGENT_KIT] run ${run.id} start — agente=${spec.id}, modello=${modelRef.label} (${modelRef.provider}), thread=${threadId}`
		);

		// La computer del brand: `shell` accende/ripristina la VM da solo (ensureComputer) e ogni
		// uso riprogramma il sonno; il cron sweep la spegne dopo 10' di quiete col checkpoint su
		// Storage. Sembra sempre accesa, si paga solo quando lavora.
		const sandbox = createVercelSandboxProvider();
		// I plugin si dichiarano UNA volta: entrano nei deps dell'executor (che li esegue) E nel
		// catalogo dei tool (che li fa conoscere al modello). Dichiarare senza esporre era il buco
		// segnalato dal cantiere motion: l'executor sapeva rispondere a motion_*, il modello non
		// sapeva di poterlo chiedere.
		// I FATTI del turno (per il giudice di chiusura e per l'obiettivo) + il battito: ogni tool
		// riuscito aggiorna heartbeat_at sulla riga del run — è ciò che distingue «vivo e al lavoro»
		// da «zombie ucciso dall'HMR» (il reaper guarda questo).
		const succeededTools: string[] = [];

		const turnT0 = Date.now();
		// La scadenza PRIMA dei plugin: i worker di delega la ereditano (`remainingMs`), così una
		// pipeline non parte quando non farebbe in tempo a tornare. `budgetMs` si INIETTA: un test
		// fa scadere un turno in millisecondi invece di mezz'ora — in produzione non si tocca.
		const deadline = chatTurnDeadline(Date.now(), input.budgetMs);

		/**
		 * LA DELEGA — gli stessi tool di subagents.ts che usa il motore classico. Il set dei worker
		 * si riempie DOPO `buildTools` (i plugin stanno nel catalogo che buildTools stesso produce),
		 * quindi qui nasce vuoto: `createSubagentTools` legge `tools` a ogni esecuzione, non alla
		 * costruzione. Senza modello configurato la delega non si monta: meglio un orchestratore
		 * senza aiutanti che un turno morto alla prima delega.
		 */
		const scopedTools: Record<string, unknown> = {};
		const kitHubKeys: string[] = [];
		let subagentModel: ReturnType<typeof resolveChatModel> | null = null;
		try {
			subagentModel = resolveChatModel(undefined, undefined, { agentId: spec.id });
		} catch {
			subagentModel = null;
		}
		const delegationPlugin = subagentModel
			? createDelegationPlugin({
					tools: createSubagentTools({
						supabase,
						brandId: brand.id,
						userId: user.id,
						threadId,
						locale,
						// Il set dei worker: vuoto qui, riempito dopo buildTools (vedi sotto).
						tools: scopedTools,
						defaultAgent: resolveAgent(spec.id),
						model: subagentModel,
						// Il perimetro di scrittura degli `execute` sono i nomi VERO del kit, non quelli
						// dell'hub di chat (qui si chiama content_create_post, là create_post).
						hubToolKeys: kitHubKeys,
						remainingMs: deadline.remainingMs,
						// `inline` + specchio: la run gira nel turno (i verdetti in banda restano leggibili)
						// ma lascia la riga `chat_jobs` con il partial vivo — è ciò che fa comparire il
						// lavoro tra i processi in background e lo rende leggibile a `check_subagent`.
						// La durabilità la dà il run kit, che ha già heartbeat e resume.
						mode: 'inline',
						mirror: true
					})
				})
			: null;

		// Il mestiere dal registro (più il grounding comune), l'obiettivo del thread e la squadra:
		// message_agent sta accanto a ogni specialista, o un motion che finisce un video non ha modo
		// di passarlo al Web perché ne scriva l'articolo.
		const plugins = [
			...kitPluginsFor(spec.id, {
				supabase,
				brandId: brand.id,
				userId: user.id,
				threadId,
				locale,
				remainingMs: deadline.remainingMs
			,
				origin: input.origin}),
			createGoalPlugin({
				supabase,
				brandId: brand.id,
				userId: user.id,
				threadId,
				succeededThisTurn: () => succeededTools
			}),
			createTeamPlugin({ supabase, brandId: brand.id, userId: user.id, threadId, origin: input.origin, locale }),
			...(delegationPlugin ? [delegationPlugin] : [])
		];

		/** Gli url allegati in QUESTO turno via `attach`: finiscono sulla riga salvata. */
		const turnAttachments: string[] = [];
		let lastBeat = 0;
		const rawApplyTool = createApplyTool({
			brandFs: createServerBrandFs(supabase, spec.id),
			sandbox,
			sandboxRef: null,
			computer: { db: admin, home: createCheckpointStorage(sandbox, admin) },
			memory: createPostgresMemoryStore(supabase),
			queryTool: queryToolAdapter({ supabase, brandId: brand.id, userId: user.id, threadId }),
			attach: async (a, c) => attachForChat(a, c, { supabase, admin, sandbox, brandId: brand.id, userId: user.id, collect: turnAttachments }),
			graphicalBootstrap: graphicalBootstrapDeps,
			// Adesso un post creato/schedulato in un turno abortito NON viene ricreato al resume: il
			// ledger ha già la chiave e il gate congelare invece di rieseguire.
			effects: createEffectsLedger(admin),
			plugins
		});
		// LO STOP DELL'UTENTE arriva da un'ALTRA invocazione (`cancelKitRun`, chiamata dall'endpoint
		// di chat): flippa la riga fuori da `running`. Questo processo se ne accorge solo
		// rileggendola — e la rilegge già, a ogni battito e a ogni scrittura del parziale. Un solo
		// punto decide che il turno è finito, così non c'è una seconda regola che diverge.
		let stoppedByUser = false;
		let runClosedBy = '';
		/**
		 * I TOOL SONO DEL THREAD, LE BANDIERE SONO DEL TURNO.
		 *
		 * `startHarnessTurn` cuoce il ToolSet una volta per `sessionKey` (il thread) e riusa quello
		 * a ogni turno successivo: il recinto dentro `applyTool` chiuderebbe sulle bandiere del
		 * turno che li ha cotti, e il secondo messaggio dello stesso thread si vedrebbe rifiutare
		 * OGNI tool con «turno chiuso dal sistema (done)» — il primo turno è finito, e i suoi tool
		 * lo sanno per sempre. Il recinto guarda qui, dove c'è sempre il turno vivo del thread.
		 */
		const liveTurn = { stopped: false, closedBy: '' };
		liveTurnByThread.set(threadId, liveTurn);
		/**
		 * STOP DEVE FERMARE IL LOOP, non solo marcare la riga.
		 *
		 * `cancelKitRun` scrive `agent_kit_runs`, e questo processo lo scopriva al battito dopo —
		 * ma tutto cio` che ne seguiva era rifiutare i TOOL. Il modello continuava a generare, a
		 * battere e a depositare: il 26/8 un run e` rimasto a battere 21 minuti dopo essere stato
		 * chiuso, e l'utente ha visto scrivere nel thread una sessione che aveva gia` fermato.
		 * Ora lo stato che esce da `running` aborta il turno in volo.
		 */
		const turnAbort = new AbortController();
		const noteRunState = (state: unknown) => {
			if (!state || state === 'running') return;
			if (state === KIT_RUN_STOPPED_BY_USER) stoppedByUser = true;
			runClosedBy = String(state);
			liveTurn.stopped = stoppedByUser;
			liveTurn.closedBy = runClosedBy;
			if (!turnAbort.signal.aborted) turnAbort.abort();
		};
		/**
		 * IL RECINTO PRIMA DI OGNI RILANCIO, in un punto solo.
		 *
		 * Tre percorsi fanno ripartire il lavoro — l'anti-ripetizione, la ripresa per tempo
		 * scaduto e la continuazione del goal — e nessuno guardava se questo run fosse ancora
		 * suo. Il CAS di `closeRunSaving` e` un recinto per il MESSAGGIO e arriva dopo: la
		 * continuazione era gia` in coda. Cosi` uno Stop faceva partire il turno successivo.
		 *
		 * Legge le stesse bandiere del battito invece di rifare una lettura: `beat()` gira a
		 * orologio e prima e dopo ogni tool, quindi a fine turno sono fresche — e da quando lo
		 * stato che esce da `running` aborta il loop, uno Stop non arriva nemmeno fin qui.
		 */
		const stillOurs = (): boolean => !stoppedByUser && !runClosedBy;
		/**
		 * IL CHECKPOINT VIVO — il parziale promosso a riga assistant VERA, riscritta a ogni battito.
		 *
		 * `agent_kit_runs.partial` è una colonna che il transcript non legge: finché il turno non
		 * chiude, ricaricare la pagina mostra il thread com'era prima, e diciassette minuti di
		 * lavoro si leggono come cancellati dall'agente. Era descritto in un commento e misurato
		 * (25/8: 29 run su 61 senza un solo `partial`, uno da 674 secondi) e lasciato lì.
		 *
		 * Sta sul BATTITO e non sullo specchio dello stream apposta: il battito è un timer del
		 * server, quindi continua anche quando il browser se ne va — che è esattamente il momento
		 * in cui lo specchio smetteva di scrivere.
		 *
		 * `partial_saved_msg_id` sulla riga del run è il legame fra le due: la prima volta inserisce,
		 * poi aggiorna sempre quella. Ed è lo stesso campo che `cancelKitRun` guarda per non
		 * scrivere un secondo parziale allo Stop.
		 */
		let checkpointMsgId: string | null = null;
		let checkpointedAt = '';
		const checkpointPartial = async (partial: ChatPartialSnapshot | null, savedId: string | null) => {
			const at = String((partial as { updatedAt?: string } | null)?.updatedAt ?? '');
			if (!at || at === checkpointedAt) return;
			const content = assistantContentFromPartial(partial);
			if (!content.length) return;
			const fields = closeMessageFields(content, turnAttachments);
			checkpointedAt = at;
			const id = checkpointMsgId ?? savedId;
			if (id) {
				checkpointMsgId = id;
				await admin
					.from('chat_messages')
					.update({
						content: fields.content,
						reasoning: fields.reasoning ?? null,
						tool_calls: fields.toolCalls ?? null
					})
					.eq('id', id);
				return;
			}
			const { data } = await admin
				.from('chat_messages')
				.insert({
					brand_id: brand.id,
					user_id: user.id,
					thread_id: threadId,
					role: 'assistant',
					content: fields.content,
					...(fields.reasoning ? { reasoning: fields.reasoning } : {}),
					...(fields.toolCalls ? { tool_calls: fields.toolCalls } : {})
				})
				.select('id')
				.maybeSingle();
			const fresh = (data as { id?: string } | null)?.id;
			if (!fresh) return;
			checkpointMsgId = fresh;
			await admin.from('agent_kit_runs').update({ partial_saved_msg_id: fresh }).eq('id', run.id);
		};
		const beat = async () => {
			lastBeat = Date.now();
			// `select('*')` e non i nomi delle colonne: i deploy non eseguono le migration, e
			// nominare `partial` (0218) o `partial_saved_msg_id` (0219) dove non sono applicate
			// prende un 42703 che azzera la lettura — cioè spegne in silenzio anche il
			// riconoscimento dello Stop, che passa da qui. Stessa ragione di `cancelKitRun`.
			await admin
				.from('agent_kit_runs')
				.update({ heartbeat_at: new Date().toISOString() })
				.eq('id', run.id)
				.select('*')
				.then(async ({ data }) => {
					const row = (data as Array<Record<string, unknown>> | null)?.[0];
					noteRunState(row?.state);
					// Best-effort: il turno non si ferma perché un checkpoint è inciampato.
					await checkpointPartial(
						(row?.partial as ChatPartialSnapshot | null) ?? null,
						(row?.partial_saved_msg_id as string | null) ?? null
					).catch(() => {});
				}, () => {});
		};
		// A TIMER, non solo sugli eventi: il battito è ciò che dice «vivo», quindi non può
		// dipendere dal fatto che il modello stia producendo qualcosa. Un turno che pensa a lungo
		// prima del primo chunk verrebbe dichiarato morto da vivo — è la stessa ragione per cui
		// il motore classico batte a orologio (queue.ts, +server.ts).
		turnHeartbeat = setInterval(beat, CHAT_HEARTBEAT_INTERVAL_MS);
		/**
		 * IL CANE DA GUARDIA DEL SILENZIO — e perche` non bastano dieci secondi.
		 *
		 * Il silenzio da solo non e` un guasto: un modello che ragiona su un prompt grosso non
		 * emette nulla per un po', e un tool lungo (un render motion: dieci minuti, UNA chiamata)
		 * non emette nulla per definizione. Il segnale vero e` il silenzio MENTRE NON si sta
		 * eseguendo un tool — quindi il cane si mette in pausa quando un tool e` in volo.
		 *
		 * Il battito NON e` un segno di vita: e` un timer, e batteva regolare mentre il turno era
		 * appeso a non fare niente. Qui contano solo gli eventi dello stream e i tool.
		 */
		let lastSign = Date.now();
		let toolsInFlight = 0;
		const signOfLife = () => {
			lastSign = Date.now();
		};

		const applyTool: typeof rawApplyTool = async (call, c) => {
			// Battito PRIMA e DOPO l'esecuzione, e ogni CHAT_HEARTBEAT_INTERVAL_MS nel mezzo: un
			// tool lungo (render motion, che non produce testo nel mentre) altrimenti lascia il
			// cuore fermo per tutta la sua durata e il reaper lo uccide credendolo zombie.
			// Ed è il CHECKPOINT dello Stop: `abortSignal` ferma il turno al confine di step, ma un
			// tool già in partenza va rifiutato qui, o Stop paga un render che nessuno vedrà.
			await beat();
			const vivo = liveTurnByThread.get(threadId) ?? liveTurn;
			if (vivo.stopped) {
				return { content: [{ type: 'text', text: 'Turno fermato dall’utente: niente è stato eseguito.' }], isError: true };
			}
			if (vivo.closedBy) {
				return { content: [{ type: 'text', text: `Turno chiuso dal sistema (${vivo.closedBy}): niente altro viene eseguito.` }], isError: true };
			}
			const keepAlive = setInterval(() => void beat(), CHAT_HEARTBEAT_INTERVAL_MS);
			toolsInFlight += 1;
			signOfLife();
			try {
				const out = await rawApplyTool(call, c);
				if (!out.isError) succeededTools.push(call.name);
				loopGuard.recordStep([{ toolName: call.name, input: 'input' in call ? call.input : undefined }], '');
				return out;
			} finally {
				toolsInFlight -= 1;
				signOfLife();
				clearInterval(keepAlive);
				void beat();
			}
		};

		// La memoria si INIETTA a ogni turno: la più recente prima, dentro 32 KB
		// di byte, marcata «dato, non istruzione» (memory-context.ts). Si scrive con `remember`.
		const memoryMd = await loadMemoryContext(
			createPostgresMemoryStore(supabase),
			brand.id,
			spec.id,
			{ brandId: brand.id, userId: user.id, runId: '', locale }
		);
		// La squadra nel prompt: `COMMON` in specs.ts non la nomina e non può (sta in un pacchetto che
		// non importa `$lib`). Il blocco si genera dall'UNICA fonte (`AGENTS`) e promette
		// `message_agent` perché il kit lo monta davvero: negarlo qui sarebbe la bugia opposta.
		const peer = resolveAgent(spec.id);
		// Kit turns never hit the classic `buildSystemPrompt` (chat/system-prompt.ts), which is
		// where REPLY LANGUAGE lives after the amazon.in incident. Without this block here, an
		// English message still gets an Italian reply: the kit preamble used to be Italian and
		// nothing told the model to follow the user.
		// In un DM il blocco sta IN TESTA, davanti a tutto: in coda ha già perso una volta contro
		// l'intero prompt di brand (il modello salutava l'utente per nome).
		let system =
			(input.dm ? `${dmBrief(input.dm.meName, input.dm.otherName, locale)}\n\n` : '') +
			buildSystemPrompt(spec, { memoryMd, fileIndex: filesIndexFor(spec.id) }) +
			`\n\n${chatReplyLanguageBlock(locale)}` +
			(peer ? `\n\n${teamBlock(peer)}` : '') +
			`\n\n${modeBlock(mode)}`;
		// In ASK l'obiettivo si mette in pausa: non ci sono i tool per farlo avanzare, quindi
		// ripetergli la checklist sarebbe chiedergli di chiamare strumenti che non ha, e riprendere
		// in background sarebbe pagare un turno che non può chiudere niente. Stessa regola del
		// motore classico.
		const goalModeActive = mode !== 'ask';
		const goalAtStart: ChatGoal | null = goalModeActive
			? await loadOpenGoal(supabase, threadId).catch(() => null)
			: null;
		if (goalAtStart) {
			system += `\n\n${withKitToolNames(goalBriefing(goalAtStart, locale))}`;
		} else if (goalModeActive && goalWorthyRequest(lastUserText(messages))) {
			system += `\n\n${goalNudge(locale)}`;
		}
		const tokenBudget = chatTokenBudget();
		let settled = false;
		const loopGuard = createChatLoopGuard();
		const turnTools = toolsForMode(
			[
				// Il desktop grafico è fuori dal prodotto: l'agente vede il web con `browse`, non
				// pilotando uno schermo. Con AGENT_DESKTOP_ENABLED=1 tornano com'erano.
				...(agentDesktopEnabled() ? BUILTIN_TOOLS : BUILTIN_TOOLS.filter((t) => t.name !== 'observe' && t.name !== 'act')),
				...plugins.flatMap((p) => p.tools)
			],
			mode
		);
		// Le esclusioni del turno non presidiato valgono per entrambi i cataloghi: nel kit la sola
		// voce che ricade è `ask_user` — una domanda senza nessuno che possa rispondere lascerebbe
		// il run in waiting_input per sempre.
		const turnToolsFinal = isDm
			? turnTools.filter(
					(t) => !UNATTENDED_TOOL_EXCLUSIONS.includes(t.name) && !UNATTENDED_KIT_TOOL_EXCLUSIONS.includes(t.name)
				)
			: turnTools;
		const toolNames = turnToolsFinal.map((t) => t.name);
		const toolSet = buildTools(turnToolsFinal, applyTool, ctx);

		// Il set che i worker di delega ricevono: gli STESSI oggetti tool dell'orchestratore, quindi
		// ogni chiamata di un worker passa dall'applyTool qui sopra — battito, Stop e
		// succeededTools compresi. Il perimetro di scrittura degli `execute` si riempie qui.
		Object.assign(scopedTools, toolSet);
		kitHubKeys.push(...toolNames.filter((n) => !(SUBAGENT_TOOL_KEYS as readonly string[]).includes(n)));

		let savedResume: unknown = null;
		// `process.env` e non il globale di Vite: questo file lo impacchetta anche il worker, che
		// gira su Node puro dove quel globale non esiste — leggerne un campo era un TypeError che
		// uccideva il turno prima di cominciare. Vedi `no-vite-globals.test.ts`.
		if (process.env.NODE_ENV !== 'test') {
		try {
			const { data: th } = await admin
				.from('chat_threads')
				.select('harness_resume')
				.eq('id', threadId)
				.maybeSingle();
			savedResume = (th as { harness_resume?: unknown } | null)?.harness_resume ?? null;
		} catch {
			savedResume = null;
		}
		}
		const brandSandbox = savedResume ? null : await openBrandHarnessSession(brand.id, run.id, spec.id);
		try {
		const startTurnOnce = (fresh: boolean) => {
			const startedTurn = startHarnessTurn({
			runId: run.id,
			agentId: spec.id,
			model: modelRef,
			system,
				historyMd: savedResume
                    ? undefined
                    : messages
                            .slice(-16)
                            .map((m) => `${String(m.role).toUpperCase()}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content).slice(0, 400)}`)
                            .join('\n')
                            .slice(-8_000),
				resumeFrom: savedResume ?? undefined,
			messages: stripProviderRefs(messages),
			tools: toolSet,
			abortSignal: turnAbort.signal,
			// Un DM è un consulto fra colleghi, non una produzione: il tetto tiene il suo costo lì,
			// come DM_REPLY_STEP_CAP fa sul motore classico.
			stopWhen: [isStepCount(isDm ? DM_REPLY_STEP_CAP : TURN_MAX_STEPS)],
			sessionKey: threadId,
				...(fresh ? { freshSession: true } : {}),
				sandboxSession: brandSandbox?.session
		});
			return Promise.race([
				startedTurn,
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error('harness_start_timeout: la sessione non e` partita')),
						harnessStartTimeoutMs()
					).unref?.()
				)
			]);
		};
		/**
		 * PARTIRE NON E` INFERENZA. Un run e` rimasto sei minuti `running` con zero caratteri, zero
		 * ragionamento, `partial` mai scritto e NESSUNA chiamata al modello: appeso qui dentro,
		 * prima che esistesse uno stream. Il battito e` un timer e continuava a battere, quindi il
		 * reaper lo credeva vivo e la chat diceva «sta generando» finche` qualcuno non uccideva la
		 * sessione a mano. Se non parte, la sessione se ne va e il turno lo dice.
		 *
		 * E SE NON PARTE LA SESSIONE RIUSATA: dopo un turno FINITO, pi la riprende e muore dentro
		 * («Request was aborted») — msg1 ok, msg2 morto con 500 dopo il timeout. Un solo tentativo
		 * con sessione fresca: il riuso e` un'ottimizzazione, la risposta dell'utente no.
		 */
		let turn: Awaited<ReturnType<typeof startTurnOnce>>;
		// Lo stato PRIMA del tentativo: un avvio riuscito popola la cache, e il retry deve
		// decidere se c'era qualcosa da riusare alla partenza, non se una sessione esiste adesso.
		const hadReusableSession = hasLiveHarnessSession(threadId);
		try {
			turn = await startTurnOnce(false);
		} catch (firstStartError) {
			// Il retry è per la sessione RIUSATA che non parte. Su un thread NUOVO non c'è nulla
			// di riusato: `startTurnOnce(false)` ha già creato una sessione fresca, e ritentare
			// ne crea una seconda identica — due avvii a freddo, due minuti, e un log che accusa
			// una «sessione riusata» mai esistita. Senza cache il retry non salva niente.
			if (!hadReusableSession) throw firstStartError;
			await dropLiveHarnessSession(threadId).catch(() => undefined);
			try {
				turn = await startTurnOnce(true);
			} catch {
				throw firstStartError;
			}
			console.warn(`[AGENT_KIT] run ${run.id} la sessione riusata non partiva: ripreso con sessione fresca`);
		}
		const result = turn.result;
		const silenceWatch = setInterval(() => {
			if (toolsInFlight > 0 || turnAbort.signal.aborted) return;
			if (Date.now() - lastSign < HARNESS_SILENCE_TIMEOUT_MS) return;
			console.error(
				`[AGENT_KIT] run ${run.id} muto da ${Math.round((Date.now() - lastSign) / 1000)}s senza tool in volo: lo fermo`
			);
			turnAbort.abort();
			// CHIUSURA FORZATA — l'abort del watchdog non è garantito venga onorato dal trasporto:
			// il gateway può lasciare la chiamata appesa per sempre e `consumeStream` non torna.
			// Senza questo, la riga resta `running` col battito vivo e il reaper la raccoglie
			// solo quando l'istanza serverless congela — l'utente intanto vede «sta generando»
			// per sempre. Se nel frattempo il turno ha finito ONESTAMENTE (`settled`), CAS e
			// guardia non fanno nulla di doppio.
			const forceCloseAbortedTurn = setTimeout(() => {
				if (settled) return;
				console.error(`[AGENT_KIT] run ${run.id} il trasporto non ha onorato l'abort: chiusura forzata della riga`);
				closeRunSaving(
					admin,
					run.id,
					{ kind: 'finish', reason: 'aborted' },
					closeMessageFields([{ type: 'text', text: '_(turno chiuso: il modello non ha risposto in tempo)_' }], [])
				).catch(() => finish(admin, run.id, 'aborted').catch(() => undefined));
				kickQueue();
			}, HARNESS_ABORT_FORCE_CLOSE_MS);
			forceCloseAbortedTurn.unref?.();
			stopForceClose = () => clearTimeout(forceCloseAbortedTurn);
		}, CHAT_HEARTBEAT_INTERVAL_MS);
		silenceWatch.unref?.();
		const stopSilenceWatch = () => { clearInterval(silenceWatch); stopForceClose?.(); };
		let stopForceClose: (() => void) | null = null;

		const handleFinish = async ({ steps, text }: { steps: Awaited<typeof result.steps>; text: string }) => {
			if (settled) return;
				settled = true;
				if (stoppedByUser) {
					kickQueue();
					return;
				}
				const last = lastToolCall(steps);
				const args = (last?.input ?? {}) as Record<string, unknown>;
				let visibleText: string;
				let outcome: CloseOutcome;
				/**
				 * La riga sul tempo scaduto va SPINTA nel contenuto, non passata come `fallbackText`:
				 * `assistantContentFromSteps` scarta il ripiego appena uno step ha lasciato del testo
				 * proprio (`sawText`), e un turno che finisce il tempo quasi sempre ne ha lasciato.
				 * Passandola di lì, la promessa «riprendo in background» non arrivava mai a chi legge.
				 * Stesso gesto del motore classico (queue.ts: `content.push(turnTruncatedNotice(...))`).
				 */
				let truncatedNotice: string | null = null;
				let endedNaturally = false;
				let continued = false;
				let timeRanOut = false;
				if (last?.toolName === 'ask_user') {
					visibleText = String(args.question ?? '');
					outcome = { kind: 'ask_user', question: args };
				} else if (last?.toolName === 'reply') {
					visibleText = String(args.message ?? '');
					outcome = { kind: 'finish', reason: 'reply' };
					endedNaturally = true;
				} else {
					deadline.reached();
					tokenBudget.reached({ steps });
					const reason: RunStopReason = deadline.expired
						? 'deadline'
						: tokenBudget.exceeded
						? 'token_budget'
						: loopGuard.stalled || steps.length >= 20
							? 'step_limit'
							: 'completed';
					if (loopGuard.stalled) truncatedNotice = turnLoopNotice(locale);
					timeRanOut = reason === 'deadline';
					// ── LA RIPRESA AUTOMATICA ────────────────────────────────────────────────
					// Stessa identica macchina del motore classico — `enqueueTurnContinuation`,
					// non una seconda copia: stesso tetto ai rilanci (una catena che continua a
					// finire il tempo è un compito troppo grosso per una chat) e stessa regola di
					// non impilarsi dietro un messaggio che l'utente ha già accodato. La profondità
					// vive in `chat_jobs`, e il drain la ripassa qui come `continuationDepth`.
					// SOLO su 'deadline': riprendere un turno fermato dal tetto sui token
					// raddoppierebbe esattamente il costo che quel tetto esiste per fermare, e su
					// 'step_limit' il modello sta girando a vuoto, non lavorando. È la stessa
					// scelta del classico (queue.ts, `shouldContinue`). Un DM non si continua da
					// solo: chi ha scritto, o l'utente, decide il passo dopo.
					// Senza `origin` non si accoda niente: il drain va svegliato via HTTP.
					if (reason === 'deadline' && !isDm && input.origin && stillOurs()) {
						continued = !!(await enqueueTurnContinuation(admin, {
							brandId: brand.id,
							userId: user.id,
							threadId,
							origin: input.origin,
							locale,
							mode,
							tier: typeof input.tier === 'string' ? input.tier : undefined,
							reasoning: typeof input.reasoning === 'string' ? input.reasoning : undefined,
							depth: input.continuationDepth ?? 0
						}).catch((e) => {
							console.error(`[AGENT_KIT] run ${run.id} continuation enqueue failed`, e);
							return null;
						}));
					}
					// Stessa regola di turn.ts (import, non copia): il testo del turno vince SOLO su
					// 'completed' — un turno tagliato da un tetto non promuove la prosa a messaggio.
					// Sul tempo scaduto la riga la scrive `turnTruncatedNotice`, che dice anche il
					// FATTO: la ripresa è già in coda, o non c'è. È la stessa riga del classico.
					visibleText = reason === 'completed' && text?.trim() ? text.trim() : honestNotice(reason, locale);
					endedNaturally = reason === 'completed';
					// Un fatto, non una previsione: la ripresa è già in coda, o non c'è.
					if (reason === 'deadline') truncatedNotice = turnTruncatedNotice(locale, continued);
					outcome = { kind: 'finish', reason };
				}
				const laps = input.verdictLaps ?? 0;
				const newWorkTools = succeededTools.filter((t) => !BOOKKEEPING_TOOLS.has(t));
				const repeatsPreviousReplyWithoutNewWork =
					endedNaturally &&
					succeededTools.length === 0 &&
					isRepeatedReply(visibleText, lastAssistantText(messages));
				if (repeatsPreviousReplyWithoutNewWork && laps < MAX_VERDICT_LAPS) {
					console.log(`[AGENT_KIT] risposta ripetuta senza lavoro nuovo (run ${run.id}, giro ${laps + 1}) — rilancio correttivo`);
					const { closed } = await closeRunSaving(admin, run.id, outcome, null);
					if (!closed) {
						console.log(`[AGENT_KIT] run ${run.id} sfrattato prima della chiusura: nessun rilancio`);
						kickQueue();
						return;
					}
					if (!stillOurs()) {
						console.log(`[AGENT_KIT] run ${run.id} sfrattato: nessun rilancio anti-ripetizione`);
						kickQueue();
						return;
					}
					try {
						const contResponse = await runKitTurn({
							...input,
							messages: [
								...messages,
								carryImagesToContinuation(messages, repeatedReplyContinuation(locale)) as ModelMessage
							],
							verdictLaps: laps + 1
						});
						void contResponse.body?.cancel().catch(() => {});
					} catch (e) {
						console.error(`[AGENT_KIT] rilancio anti-ripetizione fallito (run ${run.id})`, e);
					}
					kickQueue();
					return;
				}
				if (repeatsPreviousReplyWithoutNewWork) visibleText = repeatedReplyNotice(locale);
				// AUTO-ATTACH: se la risposta nomina un url media VERO, quel file va nella bolla —
				// senza aspettare che l'agente si ricordi di `attach`. Visto in produzione (23/8):
				// video renderizzato davvero, url vivo, ripetuto tre volte come TESTO e mai
				// mostrato. Non inventiamo niente: l'artefatto esiste, lo si rende visibile.
				for (const url of visibleText.match(/https?:\/\/\S+\.(?:mp4|webm|mov|png|jpe?g|gif|webp)/gi) ?? []) {
					const clean = url.replace(/[)\]`.,]+$/, '');
					if (!turnAttachments.includes(clean)) turnAttachments.push(clean);
				}

				// L'OBIETTIVO A FINE TURNO — stessa macchina condivisa del motore classico
				// (`settleGoalForTurn`): registra le chiusure raccontate ma provate, riapre quelle
				// spuntate senza lavoro dietro, consuma il giro e decide se il lavoro riparte da solo.
				// I fatti sono i tool che hanno DAVVERO restituito qualcosa in questo turno.
				const goalSettled = goalModeActive
					? await settleGoalForTurn(supabase, {
							threadId,
							goalAtStart,
							awaitingAnswer: last?.toolName === 'ask_user',
							turnText: visibleText,
							succeededTools: newWorkTools,
							knownTools: toolNames,
							timeRanOut,
							loopStalled: loopGuard.stalled,
							aborted: stoppedByUser,
							failed: !!runClosedBy && !stoppedByUser,
							depth: input.continuationDepth ?? 0,
							maxDepth: CHAT_MAX_CONTINUATIONS,
							locale
						}).catch((e) => {
							console.error(`[AGENT_KIT] run ${run.id} goal settle failed`, e);
							return null;
						})
					: null;
				// La ripresa per tempo scaduto è già in coda qui sopra: qui si accoda solo quella che
				// il tempo non aveva chiesto — criteri ancora aperti — e col prompt che li nomina, o
				// il turno che riparte ricomincerebbe dal primo elemento della lista.
				if (goalSettled?.decision.continue && !isDm && !continued && input.origin && stillOurs()) {
					continued = !!(await enqueueTurnContinuation(admin, {
						brandId: brand.id,
						userId: user.id,
						threadId,
						origin: input.origin,
						locale,
						mode,
						tier: typeof input.tier === 'string' ? input.tier : undefined,
						reasoning: typeof input.reasoning === 'string' ? input.reasoning : undefined,
						depth: input.continuationDepth ?? 0,
						...(goalSettled.continuationPrompt
							? { prompt: withKitToolNames(goalSettled.continuationPrompt) }
							: {})
					}).catch((e) => {
						console.error(`[AGENT_KIT] run ${run.id} goal continuation enqueue failed`, e);
						return null;
					}));
				}

				const content = repeatsPreviousReplyWithoutNewWork
					? [{ type: 'text' as const, text: visibleText }]
					: assistantContentFromSteps(steps, visibleText);
				if (truncatedNotice) content.push({ type: 'text', text: truncatedNotice });
				// MESSAGGIO E STATO IN UNA TRANSAZIONE (agent_kit_close_run, 0222), col CAS su
				// `state='running'` come recinto: un run già sfrattato non deposita NIENTE.
				if (goalSettled?.notice) content.push({ type: 'text', text: goalSettled.notice });
				const { closed, messageId } = await closeRunSaving(
					admin,
					run.id,
					outcome,
					content.length ? closeMessageFields(content, turnAttachments) : null
				);
				if (!closed) {
					console.log(`[AGENT_KIT] run ${run.id} sfrattato prima della chiusura: nessun messaggio salvato`);
					kickQueue();
					return;
				}
				if (messageId) {
					// La firma della battuta: l'RPC che inserisce non porta `chat_messages.name`,
					// quindi la firma arriva subito dopo la chiusura — come `speaker` nella
					// `saveMessages` del motore classico.
					if (input.dm) {
						try {
							await admin.from('chat_messages').update({ name: input.dm.speaker }).eq('id', messageId);
						} catch (e) {
							console.warn(`[AGENT_KIT] run ${run.id} firma DM non applicata`, e);
						}
					}
					// Il checkpoint ha finito il suo mestiere: la riga definitiva è a terra, quindi la
					// provvisoria va via. DOPO la chiusura e non prima — se il processo muore in
					// mezzo resta un doppione, visibile e riparabile, invece di cancellare l'unica
					// copia del lavoro. Fra i due modi di sbagliare si sceglie questo.
					// try/catch e non solo il ramo di rifiuto: se il client non sa fare `delete` la
					// chiamata alza PRIMA di diventare una promessa, e da lì il throw si portava via
					// tutto il resto della chiusura — thread in cima, broadcast, verdetto. Un
					// doppione che resta costa una riga di troppo in chat; questo costava il turno.
					if (checkpointMsgId) {
						try {
							await admin.from('chat_messages').delete().eq('id', checkpointMsgId);
							checkpointMsgId = null;
						} catch (e) {
							console.warn(`[AGENT_KIT] run ${run.id} checkpoint non rimosso`, e);
						}
					}
					// Il best-effort post-insert di `saveMessages`: thread in cima e badge nelle tab
					// aperte. La riga è già a terra — un inciampo qui non vale una seconda risposta.
					try {
						await touchThread(supabase, threadId);
						void broadcastToBrand(brand.id, { event: 'thread-changed', payload: { threadId } });
					} catch (e) {
						console.warn(`[AGENT_KIT] run ${run.id} post-save best-effort failed`, e);
					}
				}

				if (goalSettled) {
					trackGoalSettlement(supabase, goalSettled, {
						brandId: brand.id,
						userId: user.id,
						threadId,
						depth: input.continuationDepth ?? 0,
						queued: continued
					});
				}

				// IL GIUDICE DI CHIUSURA (verdict.ts): ha fatto, o ha promesso? Non gira quando
				// qualcosa sta GIÀ facendo ripartire questo lavoro — la ripresa dell'obiettivo o
				// quella per tempo scaduto — perché due rilanci sullo stesso turno sono due turni
				// pagati che si pestano i piedi. Un obiettivo APERTO da solo non lo disattiva più:
				// prima bastava trovarne uno per spegnere l'unica guardia anti-fabbricazione del
				// kit, su un motore che quell'obiettivo non poteva nemmeno chiudere. La
				// continuazione è SILENZIOSA: nessun messaggio in chat (la regola del 23/8), un run
				// nuovo che l'utente vede solo come «sta ancora lavorando» e poi come risultato.
				if (last?.toolName !== 'ask_user' && !repeatsPreviousReplyWithoutNewWork && !loopGuard.stalled && !continued) {
					try {
						const verdict = await closeTurnVerdict({
							userAsk: lastUserText(messages),
							replyText: visibleText,
							// SOLO i tool davvero riusciti in QUESTO turno. L'auto-attach NON conta come
							// fatto: un url vecchio ripescato dal testo non è lavoro nuovo — contarlo
							// disinnescava il guard, e l'agente ha ripetuto «Fatto» a mani vuote per
							// ore (23/8, regressione mia, trovata leggendo il run 676b8c94).
							succeededTools,
							laps
						});
						if (!verdict.finished) {
							console.log(`[AGENT_KIT] verdict: promessa senza fatto (run ${run.id}, giro ${laps + 1}) — rilancio: ${verdict.missing}`);
							// IL RILANCIO deve vedere quello che il turno ha già fatto, non solo il suo
							// testo finale: prima qui c'era `{ role: 'assistant', content: visibleText }`,
							// che butta via ogni tool call del turno appena chiuso — il modello ripartiva
							// senza sapere di aver già letto/scritto/chiamato niente, e RIFACEVA da capo
							// invece di completare (autopsia: un rilancio diventava una ripetizione). Stessa
							// ricostruzione tool-call/tool-result di un vero reload di thread — `content` è
							// lo stesso oggetto già passato a `saveMessages` qui sopra.
							const turnMessages: ModelMessage[] = content.length
								? messagesFromRow({
										role: 'assistant',
										content: content
											.filter((p) => p.type === 'text')
											.map((p) => p.text ?? '')
											.join('\n\n'),
										tool_calls: content
									})
								: [{ role: 'assistant', content: visibleText } as ModelMessage];
							const contResponse = await runKitTurn({
								...input,
								messages: [
									...messages,
									...turnMessages,
									carryImagesToContinuation(messages, verdict.continuation) as ModelMessage
								],
								verdictLaps: laps + 1
							});
							// Nessuno legge questo stream: l'esecuzione la guida il suo consumeStream.
							void contResponse.body?.cancel().catch(() => {});
						}
					} catch (e) {
						// Un giudice rotto non deve mai rompere un turno già riuscito.
						console.error(`[AGENT_KIT] verdict skipped (run ${run.id})`, e);
					}
				}
				kickQueue();
		};

		// Consumo SERVER-SIDE dello stream: senza questo l'unico consumatore è il browser, e
		// un refresh a metà turno lascia handleFinish mai chiamato — run inchiodato su 'running'
		// e risposta mai salvata (successo davvero alle 12:53 del 23/8, tre turni persi).
		// Resta il DRIVER: `consumeSseStream` qui sotto è SOLO uno specchio (una copia tee'd
		// dell'SSE già incapsulato, letta senza bloccare il client) — se lo specchio si rompe o
		// va più lento, questo continua a far avanzare il turno.
		const consumed = Promise.resolve(
			result.consumeStream({
				onError: (e) => console.error(`[AGENT_KIT] run ${run.id} consume error`, e)
			})
		).then(async () => {
			try {
				await handleFinish({ steps: await result.steps, text: await result.text });
			} catch (error) {
				/**
				 * UN ABORT CHE ABBIAMO CHIESTO NOI NON E` UN GUASTO.
				 *
				 * Da quando Stop aborta il turno davvero, lo stream muore perche` glielo abbiamo
				 * detto — e l'harness lo segnala come «terminal finish with unclosed step
				 * content», che e` vero e non e` una notizia. Prima di questa guardia il catch
				 * faceva tre cose sbagliate in fila: scriveva «Errore del turno» in chat, svegliava
				 * ops, e RILANCIAVA il turno con un messaggio correttivo. Cioe` premevi Stop e
				 * ripartiva: il quarto percorso di rilancio, trovato dopo aver recintato gli altri
				 * tre (run `d075b203`, 26/8, `aborted` e messaggio rosso alla stessa ora).
				 *
				 * Cio` che era arrivato lo ha gia` depositato `cancelKitRun`.
				 */
				if (turnAbort.signal.aborted || stoppedByUser || runClosedBy) {
					await dropLiveHarnessSession(threadId).catch(() => undefined);
					console.log(
						`[AGENT_KIT] run ${run.id} interrotto da noi (${runClosedBy || 'abort'}): niente errore, niente rilancio`
					);
					kickQueue();
					return;
				}
				console.error(`[AGENT_KIT] run ${run.id} finish error`, error);
				// La sessione se ne va col turno che l'ha rotta: senza, il messaggio dopo eredita un
				// turno non chiuso e muore uguale, e il FE non mostra niente perche` il run e` gia`
				// chiuso. Vedi `dropLiveHarnessSession`.
				await dropLiveHarnessSession(threadId).catch(() => undefined);
				const why = error instanceof Error ? error.message : String(error);
				// English unless this chat is actually Italian — missing/en-IN/es used to dump
				// Italian into an English thread (amazon.in, 27/8/2026). Keep the Italian template
				// literal in this file so the abort-guard tests can still find it.
				const turnErrorText =
					locale === 'it'
						? `Errore del turno: ${why.slice(0, 400)}`
						: `Turn error: ${why.slice(0, 400)}`;
				try {
					await closeRunSaving(
						admin,
						run.id,
						{ kind: 'finish', reason: 'aborted' },
						closeMessageFields([{ type: 'text', text: turnErrorText }], [])
					);
				} catch {}
				reportChatError(supabase, error, {
					brandId: brand.id,
					brandSlug: brand.slug ?? null,
					userId: user.id,
					threadId,
					tier: String(input.tier ?? ''),
					provider: modelRef.provider,
					model: modelRef.label,
					kind: 'agent_kit_stream',
					detail: `run ${run.id} · agente ${spec.id}`
				}).catch((e) => console.error('[AGENT_KIT] report fallito', e));
				if (brandSandbox) {
				// Nota al MODELLO, mai all'utente: inglese, tag <system-reminder> (la convenzione di fatto:
				// Claude Code e simili), TRANSITORIA —
				// vive solo nella request del turno di retry e non finisce mai né in chat né nel DB.
				// Le alternative peggio:
				// - `role: 'system'` a metà conversazione → Google la rifiuta
				//   ("only supported at the beginning", convertToGoogleMessages);
				// - appenderla al system del turno di retry → cambia il primo blocco del prompt e
				//   invalida la cache dell'intero prefisso proprio sul giro che rilegge più storia.
				// Una user-role transitoria e marcata paga solo i token della nota.
				const corrective = `<system-reminder>This is an automated backend note, NOT from the user. Your previous attempt failed with this error: ${why.slice(0, 300)}. Tell the user in one sentence, in the language of their last real message, what went wrong and retry the original action.</system-reminder>`;
				try {
					const retryTurn = await startHarnessTurn({
						runId: `${run.id}-retry`,
						model: modelRef ?? undefined,
						system,
						messages: stripProviderRefs([...messages, { role: 'user', content: corrective } as ModelMessage]),
						tools: toolSet,
						stopWhen: [isStepCount(TURN_MAX_STEPS)],
						sandboxSession: brandSandbox?.session,
						sessionKey: threadId
					});
					await retryTurn.result.consumeStream({
						onError: (e) => console.error(`[AGENT_KIT] run ${run.id} retry consume error`, e)
					});
					await handleFinish({ steps: await retryTurn.result.steps, text: await retryTurn.result.text });
				} catch (retryError) {
					console.error(`[AGENT_KIT] run ${run.id} retry failed`, retryError);
					await finish(admin, run.id, 'aborted').catch(() => {});
					await turn.destroy();
				}
			} else {
				await turn.destroy();
			}
			}
			try {
				const usage = extractSdkUsage(await result.totalUsage);
				logAiCall({
					label: 'chat',
					provider: modelRef.provider,
					model: modelRef.id,
					ms: Date.now() - turnT0,
					ok: true,
					...usage,
					brandId: brand.id,
					userId: user.id,
					threadId,
					context: 'agent_kit'
				});
				console.log(
					`[AGENT_KIT] run ${run.id} done — ${Math.round((Date.now() - turnT0) / 1000)}s, modello=${modelRef.label}, ${usage.inputTokens ?? '?'} in / ${usage.outputTokens ?? '?'} out`
				);
			} catch (e) {
				console.error(`[AGENT_KIT] run ${run.id} usage log error`, e);
			}
		}).finally(() => {
			stopSilenceWatch();
			stopTurnHeartbeat();
		});
		// Il turno vive finché il consumo finisce, NON finché il client resta collegato.
		if (input.waitUntil) input.waitUntil(Promise.resolve(consumed));
		else void consumed;

		return result.toUIMessageStreamResponse({
			sendReasoning: true,
			onError: () => '',
			// IL RIAGGANCIO — stesso pattern già in produzione per chat_jobs (surface-turn.ts
			// collectSurfaceReply, src/routes/app/[brand]/chat/+server.ts): `consumeSseStream`
			// è l'API che `ai` v6 offre DAVVERO per leggere una copia tee'd dell'SSE senza
			// competere col client. Ogni chunk parsato va sul canale Realtime del brand
			// (`kit_stream`, topic brand:<uuid>, migration 0137) COSÌ COM'È — i client connessi
			// vedono il testo crescere token per token. Il parziale accumulato (stesso reducer
			// `applyChatStreamEvent` di chat-stream-events.ts, condiviso client/server) va sulla
			// riga del run ogni ~1s (0218, `partial` jsonb): il fallback per chi ha perso il
			// canale Realtime — poll da 4s, testo a scatti invece che fluido, degradazione
			// dichiarata, non un bug.
			consumeSseStream({ stream }) {
				// DICHIARATO ALLA PIATTAFORMA, come il turno. L'SDK invoca questa callback senza
				// attenderla («no await (do not block the response)»): e' una promessa che fluttua,
				// e su serverless una promessa non dichiarata muore quando l'invocazione chiude.
				//
				// Il turno sopravviveva gia' (riga ~841, `waitUntil(consumed)`); lo specchio no. Al
				// refresh la connessione cade, il turno continua a lavorare e `partial` smette di
				// essere scritto: la pagina ricaricata non trova NIENTE da mostrare, per sempre.
				// Misurato il 25/8 su 24 ore: 29 run su 61 senza un solo `partial`, uno dei quali
				// ha lavorato 674 secondi. Con il motore v1 non succedeva -- li' lo specchio gira
				// nel ciclo del server, non appeso alla risposta HTTP.
				const mirror = mirrorSseToRun(stream);
				input.waitUntil?.(mirror);
				return mirror;
			}
		});

		function mirrorSseToRun(stream: ReadableStream<string | Uint8Array>): Promise<void> {
			return (async () => {
				const state = emptyStreamState();
				const reader = stream.getReader();
				const decoder = new TextDecoder();
				let sseBuf = '';
				let lastWrite = 0;
				/** Lo stream è finito per cosa sua (finish/error), non per un client andato via. */
				let sawTerminal = false;
				/** Un evento di ciclo di vita di una tool call: si scrive comunque, vedi PARTIAL_FLUSH_EVENTS. */
				let mustWrite = false;
				/** La scrittura in volo: una alla volta, e MAI attesa dal ciclo di lettura (v1). */
				let inFlight: Promise<void> | null = null;
				const writePartial = async () => {
					try {
						// La scrittura resta per id (l'ULTIMA, post-chiusura, deve comunque lasciare
						// il testo intero — vedi sotto).
						await admin
							.from('agent_kit_runs')
							.update({
								partial: {
									text: state.text,
									reasoning: state.reasoning || undefined,
									tools: toolsForMirror(state.tools),
									updatedAt: new Date().toISOString()
								},
								// IL BATTITO STA QUI, non solo dopo un tool riuscito. Un turno con una
								// singola tool lunga (un render motion: >10 minuti, UNA chiamata) non
								// batteva mai → il reaper lo uccideva CREDENDOLO uno zombie mentre
								// lavorava, con doppione garantito in chat. Il parziale si aggiorna a
								// ogni chunk dello stream, cioè a ogni segno di vita del modello:
								// è il posto giusto per il cuore.
								heartbeat_at: new Date().toISOString()
							})
							.eq('id', run.id)
					} catch {
						// specchio best-effort: un inciampo qui non tocca il turno
					}
				};
				try {
					for (;;) {
						const { done, value } = await reader.read();
						if (done) break;
						sseBuf += typeof value === 'string' ? value : decoder.decode(value as Uint8Array, { stream: true });
						const { events, rest } = readSseEvents(sseBuf);
						sseBuf = rest;
						for (const evt of events) {
							// DOVE cominciava questo chunk. Chi si aggancia a metà turno legge anche lo
							// snapshot assoluto (`partial`): senza una posizione i due si sovrappongono e
							// il testo esce mescolato — incidente del 26/8, vedi `chat-live-join.ts`.
							const at = { text: state.text.length, reasoning: state.reasoning.length };
							applyChatStreamEvent(state, evt);
							signOfLife();
							if (String((evt as { type?: unknown }).type ?? '') === 'finish' || state.failed) sawTerminal = true;
							if (PARTIAL_FLUSH_EVENTS.has(String((evt as { type?: unknown }).type ?? ''))) mustWrite = true;
							const raw = JSON.stringify(evt);
							void broadcastToBrand(brand.id, {
								event: 'kit_stream',
								payload: {
									runId: run.id,
									threadId,
									at,
									chunk: raw.length > 8_000 ? shrinkChunkForBroadcast(evt) : evt
								}
							});
						}
						// COME v1 (chat/+server.ts): si scrive spesso e NON si aspetta. Un `await` qui
						// mette il ciclo di lettura in coda alla latenza del database a ogni giro —
						// a 100ms significherebbe strozzare lo stream invece di specchiarlo. Una
						// scrittura alla volta (`inFlight`), la successiva salta finché quella non
						// torna: uno specchio che perde uno scatto costa un poll, uno che rallenta
						// lo stream costa la risposta.
						const now = Date.now();
						// Una scrittura obbligata si ACCODA a quella in volo invece di saltare: se
						// saltasse, il prossimo chunk potrebbe non arrivare mai — ed e` proprio il
						// caso di un tool lungo, cioe` quello per cui esiste.
						if (mustWrite) {
							mustWrite = false;
							lastWrite = now;
							const prev = inFlight ?? Promise.resolve();
							inFlight = prev.then(writePartial).finally(() => {
								inFlight = null;
							});
						} else if (!inFlight && now - lastWrite >= PARTIAL_MIRROR_MS) {
							lastWrite = now;
							inFlight = writePartial().finally(() => {
								inFlight = null;
							});
						}
					}
				// STREAM FINITO, CHIP ANCORA APERTA = BUGIA NEL PARTIAL (27/8: `delegate_task` in
					// loading perenne — la sessione morta a metà tool non riemette il risultato e la
					// chip sopravviveva nel mirror per tutto il turno). Se lo stream è terminato per
					// cosa sua, ogni chip rimasta aperta non riceverà più nulla: diventa un errore
					// dichiarato. Se invece il client è solo andato via, il mirror si ghiaccia com'era:
					// le chip aperte possono essere legittime, il turno continua senza di noi.
					if (sawTerminal && closeDanglingToolCalls(state)) mustWrite = true;
					// L'ULTIMA scrittura è INCONDIZIONATA e ATTESA (stesso motivo di chat/+server.ts:
					// un client che pollasse in questo preciso istante deve trovare il testo intero,
					// non quello di un attimo fa) — un turno più corto della soglia non avrebbe MAI
					// scritto `partial` altrimenti. Si aspetta prima quella in volo, o la finale
					// potrebbe arrivare al database PRIMA di una più vecchia e farsi sovrascrivere.
					await inFlight;
					await writePartial();
				} catch (e) {
					console.error(`[AGENT_KIT] run ${run.id} mirror error`, e);
				} finally {
					void broadcastToBrand(brand.id, { event: 'kit_stream_done', payload: { runId: run.id, threadId } });
				}
			})();
		}
		} finally {
			// Il turno è finito, bene o male: via l'holder e, se era l'ultimo, la VM si spegne.
			// La sessione cached del prossimo messaggio riaccende da sola al primo comando.
			if (brandSandbox) {
				await brandSandbox.handle.release().catch((e) => console.warn(`[AGENT_KIT] run ${run.id} sandbox release`, e));
			}
		}
	} catch (err) {
		stopTurnHeartbeat();
		await finish(admin, run.id, 'aborted').catch(() => {});
		kickQueue();
		throw err;
	}
}
