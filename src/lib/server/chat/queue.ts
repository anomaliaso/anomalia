/**
 * Background drain of queued chat turns (user sent while another reply was generating).
 * Uses generateText so no browser SSE client is required — survives tab close.
 */
import { env } from '$env/dynamic/private';
import { hasToolCall, stepCountIs, type ModelMessage } from 'ai';
import { turnModelFamily } from '$lib/chat-model-policy';
import { harnessGenerateText } from '$lib/server/harness';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSystemPrompt, buildTurnVolatileBlock, wrapTurnMessage } from '$lib/server/chat/system-prompt';
import { createChatTools } from '$lib/server/chat/tools';
import { resolveAgentForPlan, pickTools, stripWebHubTools } from '$lib/server/chat/agents';
import { withSubagentTools } from '$lib/server/chat/subagents';
import { withSandboxTools } from '$lib/server/chat/sandbox-tools';
import { computerOwner } from '$lib/agent-computer';
import { stripUnattendedTools } from '$lib/server/chat/unattended';
import { withStrategistTools } from '$lib/server/chat/strategist-tools';
import { customAgentSystemBlock, getCustomAgentPersona } from '$lib/server/custom-agent-persona';
import { agentStickerColor } from '$lib/chat-expression';
import {
	saveMessages,
	loadHistory,
	getThread,
	renameThread,
	assistantContentFromSteps,
	clearThreadContext
} from '$lib/server/chat/persistence';
import { clearBusyNotice, clearContextNotice, isClearCommand } from '$lib/chat-commands';
import { maybeCompactThread } from '$lib/server/chat/compaction';
import { sourcesFromSteps } from '$lib/chat-sources';
import {
	aiActTurnBriefing,
	aiActUserNotice,
	screenForProhibitedPractice
} from '$lib/ai-act';
import { extractMemoryFromChat } from '$lib/server/brand-memory';
import { extractSdkUsage, logAiCall, withBrandContext } from '$lib/server/ai-log';
import { resolveChatModel, takeKieUsage } from '$lib/server/chat/model';
import { hasWebHub } from '$lib/server/plans';
import { contentFromFailedTurn, persistPartialAssistantReply } from '$lib/server/chat/partial-persist';
import { createAdminClient } from '$lib/server/supabase-admin';
import { reapStaleChatJobs } from '$lib/server/chat/job-cancel';
import { reportChatError } from '$lib/server/chat/report-error';
import { createMidTurnMailbox } from '$lib/server/chat/mid-turn-mailbox';
import { dev } from '$app/environment';
import {
	CHAT_HEARTBEAT_INTERVAL_MS,
	CHAT_MAX_CONTINUATIONS,
	CHAT_MAX_DURATION_MS,
	CHAT_PENDING_STALE_MS,
	CHAT_TURN_BUDGET_MS,
	CHAT_WORKER_TURN_BUDGET_MS,
	chatMaxTurns,
	chatTokenBudget,
	chatTurnDeadline,
	kitRunIsAlive,
	type KitRunLiveness,
	turnTokenBudgetNotice,
	turnTruncatedNotice
} from '$lib/server/chat/turn-limits';
import {
	MOTION_MAX_CONTINUATIONS,
	decideMotionContinuation,
	motionUnfinishedNotice
} from '$lib/server/motion-video/unfinished';
import { benchAwarePrepareStep, createChatLoopGuard, turnLoopNotice } from '$lib/server/chat/loop-guard';
import { recentPostsProbe, unverifiedProductionClaim } from '$lib/server/chat/production-claim';
import {
	closeGoal,
	goalBriefing,
	goalNudge,
	goalTurnNotice,
	goalWorthyRequest,
	loadOpenGoal,
	setThreadGoal,
	refusedToolNames,
	settleGoalForTurn,
	succeededToolNames,
	trackGoalSettlement
} from '$lib/server/chat/goal';
import type { TurnStep } from '$lib/server/chat/goal';
import { GOAL_TOOL_KEYS } from '$lib/server/chat/goal-tools';
import { goalCommandInstruction, parseGoalCommand } from '$lib/goal-command';
import { withStepDeadline } from '$lib/server/chat/step-deadline';
import { chatCreditsBlocked, getChatRateUsage } from '$lib/server/chat/rate-limits';
import {
	formatAttachedDocsForModel,
	parseChatDocuments,
	stripAttachedDocsForDisplay
} from '$lib/chat-documents';
import { hydrateChatDocuments } from '$lib/server/hydrate-chat-documents';
import { DM_REPLY_STEP_CAP, dmAgents, dmBrief, dmNames } from '$lib/chat-dm';
import { parseRoomAgents, stripRoomPeerTools } from '$lib/server/chat/room';
import { bilingualNoticeLocale } from '$lib/i18n/locale';

export function kickChatQueueWork(origin: string): Promise<void> {
	const headers: Record<string, string> = {};
	if (env.AUTOPILOT_SECRET) headers['x-autopilot-secret'] = env.AUTOPILOT_SECRET;
	else if (env.CRON_SECRET) headers.authorization = `Bearer ${env.CRON_SECRET}`;
	return fetch(`${origin}/api/v1/chat/queue/work`, { method: 'POST', headers }).then(
		() => undefined,
		() => undefined
	);
}

const SCHEDULED_NOTE: Record<string, string> = {
	it: '\n\n## AUTOMAZIONE SCHEDULATA\nQuesto turno è partito da una schedulazione, non da un utente in chat. Esegui il lavoro in autonomia con le informazioni che hai. Non fare domande di chiarimento. Se qualcosa è bloccato, lascia una nota breve e fermati.',
	en: '\n\n## SCHEDULED AUTOMATION\nThis turn was triggered by a recurring schedule, not a live user sitting in chat. Do the requested work autonomously with the information you have. Do not ask clarifying questions. If something is blocked, leave a short note and stop.'
};

/** Queue a background chat turn (follow-up, continuation, or a scheduled custom agent). */
export async function enqueueQueuedChatTurn(
	supabase: SupabaseClient,
	opts: {
		brandId: string;
		userId: string;
		threadId: string;
		userMessage: string;
		locale: string;
		origin: string;
		scheduled?: boolean;
		/**
		 * Brief server-side per un turno schedulato: finisce nel SYSTEM prompt, mai nel thread.
		 * Il messaggio visibile resta la riga corta di userMessage (stesso schema dell'onboarding:
		 * l'utente vede "Revisione settimanale", il modello riceve l'incarico intero).
		 */
		brief?: string;
		mode?: string;
		tier?: string;
		reasoning?: string;
		continuation?: boolean;
		continuationDepth?: number;
		/**
		 * L'AGENTE FORZATO: chi risponde a questo turno, sopra la colonna del thread. È il gancio
		 * dei DM fra agenti e delle voci successive di una chat di gruppo — vedi `forcedAgent` nel
		 * runner qui sotto. Uno solo dei due basta: `agent` sceglie prompt e tool di uno
		 * specialista, `customAgentId` ci mette sopra il persona di un agente dell'utente.
		 */
		agent?: string | null;
		customAgentId?: string | null;
		/**
		 * Firma della battuta (`chat_messages.name`): la chiave del membro che parla in una stanza
		 * o in un DM. Senza, la risposta arriva anonima e la UI non sa di chi è la bolla.
		 */
		speaker?: string;
		/**
		 * Il messaggio dell'utente è GIÀ nel thread e non va risalvato — ma la history non finisce
		 * più su di lui (in una room ci sta in mezzo la battuta del primo speaker). Si riaggancia
		 * in coda ai messaggi SOLO per il modello: un turno che finisce su un assistant non è una
		 * domanda, è un prefill, e la seconda voce continuerebbe la frase della prima.
		 */
		userMessageSaved?: boolean;
	}
): Promise<string | null> {
	const locale = bilingualNoticeLocale(opts.locale);
	const { data, error } = await supabase
		.from('chat_jobs')
		.insert({
			brand_id: opts.brandId,
			user_id: opts.userId,
			tool_name: 'chat_response',
			thread_id: opts.threadId,
			status: 'pending',
			input_params: {
				user_message: opts.userMessage,
				locale,
				origin: opts.origin,
				queued: true,
				...(opts.scheduled ? { scheduled: true } : {}),
				...(opts.brief ? { brief: opts.brief } : {}),
				...(opts.continuation ? { continuation: true, continuation_depth: opts.continuationDepth ?? 1 } : {}),
				...(opts.mode ? { mode: opts.mode } : {}),
				// SEMPRE esplicito: un seed senza tier finiva su env.CHAT_TIER, cioè su qualunque cosa
				// l'ambiente avesse deciso (in produzione poteva essere il modello Pro). Onboarding e
				// turni schedulati girano in Auto salvo scelta esplicita di chi accoda.
				tier: opts.tier ?? 'auto',
				...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
				...(opts.agent ? { agent: opts.agent } : {}),
				...(opts.customAgentId ? { custom_agent_id: opts.customAgentId } : {}),
				...(opts.speaker ? { speaker: opts.speaker } : {}),
				...(opts.userMessageSaved ? { user_message_saved: true } : {})
			}
		})
		.select('id')
		.maybeSingle();
	if (error) {
		console.error('[Chat Queue] enqueue failed', error.message);
		return null;
	}
	return (data?.id as string) ?? null;
}

const CONTINUE_PROMPT: Record<string, string> = {
	it: 'Continua esattamente da dove ti sei fermato. Il turno precedente si è interrotto per limite di tempo, non perché il lavoro fosse finito: riprendi dal primo elemento ancora da completare e non rifare quelli già fatti. Se non è rimasto nulla da fare, dillo in una riga.',
	en: 'Pick up exactly where you left off. The previous turn stopped on a time limit, not because the work was done: resume from the first item still outstanding and do not redo anything already finished. If nothing is left, say so in one line.'
};

/**
 * Re-queue the remainder of a turn that stopped on the clock rather than on the answer.
 *
 * A batch job ("fix all 10 articles") does not fit in one function lifetime, and without this the
 * user is left with half the work done and no signal that the other half needs asking for again.
 * Returns the new job id, or null when it deliberately declined to queue one.
 */
export async function enqueueTurnContinuation(
	supabase: SupabaseClient,
	opts: {
		brandId: string;
		userId: string;
		threadId: string;
		origin: string;
		locale?: string;
		mode?: string;
		tier?: string;
		reasoning?: string;
		depth?: number;
		/**
		 * Con cosa riparte il turno. Il default dice "continua da dove eri", che è il massimo che si
		 * può dire quando l'unica cosa nota è che il tempo è finito. Quando c'è un obiettivo aperto
		 * si sa molto di più — quali criteri sono ancora scoperti — e ripeterli qui è ciò che evita
		 * che la ripresa ricominci dal primo elemento della lista (vedi goalContinuationPrompt).
		 */
		prompt?: string;
		/**
		 * Il tetto di riprese per QUESTA catena. Il default è quello della conversazione (9); un
		 * motion video non finito ne chiede 24, come la pagina — è una produzione, non uno scambio
		 * di battute. Vedi motion-video/unfinished.ts.
		 */
		maxDepth?: number;
	}
): Promise<string | null> {
	const depth = Math.max(0, Math.trunc(opts.depth ?? 0));
	// A chain that keeps running out of time is a task too big for one chat, not a task that needs
	// one more lap — hand it back to the user instead of billing an unbounded loop.
	if (depth >= Math.max(1, Math.trunc(opts.maxDepth ?? CHAT_MAX_CONTINUATIONS))) return null;

	// Never stack a continuation behind something the user already queued on this thread: their
	// prompt runs next, and it may well make the continuation moot.
	const { data: waiting } = await supabase
		.from('chat_jobs')
		.select('id')
		.eq('user_id', opts.userId)
		.eq('thread_id', opts.threadId)
		.eq('tool_name', 'chat_response')
		.eq('status', 'pending')
		.limit(1)
		.maybeSingle();
	if (waiting) return null;

	const locale = bilingualNoticeLocale(opts.locale);
	return enqueueQueuedChatTurn(supabase, {
		brandId: opts.brandId,
		userId: opts.userId,
		threadId: opts.threadId,
		userMessage: opts.prompt?.trim() || CONTINUE_PROMPT[locale],
		locale,
		origin: opts.origin,
		continuation: true,
		continuationDepth: depth + 1,
		mode: opts.mode,
		tier: opts.tier,
		reasoning: opts.reasoning
	});
}

/** True when another chat_response is already pending/running on this thread. */
export async function threadHasActiveChatResponse(
	supabase: SupabaseClient,
	opts: { userId: string; threadId: string; excludeJobId?: string }
): Promise<boolean> {
	let q = supabase
		.from('chat_jobs')
		.select('id')
		.eq('user_id', opts.userId)
		.eq('thread_id', opts.threadId)
		.eq('tool_name', 'chat_response')
		.in('status', ['pending', 'running'])
		.limit(1);
	if (opts.excludeJobId) q = q.neq('id', opts.excludeJobId);
	const { data } = await q.maybeSingle();
	return !!data;
}

type ChatJobProgress = { text: string; tools: unknown[]; reasoning: string };

const NO_PROGRESS_YET: ChatJobProgress = { text: '', tools: [], reasoning: '' };

/**
 * Il battito della riga `chat_jobs` mentre il turno gira: senza, `reapStaleChatJobs` dichiara
 * morto un lavoro perfettamente vivo. `progress` e' lo specchio dei passi gia' fatti, cosi' la
 * stessa scrittura che dice «sono vivo» dice anche «ecco cosa ho prodotto finora».
 */
function startChatJobHeartbeat(
	db: SupabaseClient,
	jobId: string,
	progress: () => ChatJobProgress = () => NO_PROGRESS_YET
): () => void {
	const timer = setInterval(() => {
		void db
			.from('chat_jobs')
			.update({ partial: { ...progress(), at: Date.now() } })
			.eq('id', jobId)
			.eq('status', 'running')
			.then(undefined, () => {});
	}, CHAT_HEARTBEAT_INTERVAL_MS);
	return () => clearInterval(timer);
}

/**
 * True quando sul thread c'è un run del sistema kit (`agent_kit_runs`) 'running' ancora VIVO.
 * Serve perché `chat_jobs` è CIECO ai run kit: runKitTurn non scrive mai una riga lì, quindi
 * `threadHasActiveChatResponse` da solo lasciava partire un secondo turno sopra un run vivo.
 * Uno zombie oltre soglia NON blocca — lo chiude il reaper.
 */
export async function threadHasActiveKitRun(db: SupabaseClient, threadId: string): Promise<boolean> {
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
 * Segna il job fallito — e, se il turno l'ha acceso una schedulazione, lo dice anche allo schedule.
 *
 * `custom_agent_schedules.last_error` veniva messo a null allo sparo e non veniva più riscritto da
 * nessuno: la pagina Agenti mostrava verde un agente le cui run erano morte tutte, una per una. Il
 * legame è `last_job_id`, che il tick scrive quando accoda. Deliberatamente NON si spegne
 * l'agente dopo N fallimenti: i crediti tornano al rinnovo del periodo e un `enabled=false` va
 * riacceso a mano da qualcuno che deve prima accorgersene — si trasformerebbe un blocco
 * temporaneo in un guasto permanente. La run costa zero quando muore sul gate, e l'errore
 * visibile basta a togliere l'illusione dell'agente verde.
 */
async function failChatJob(
	admin: SupabaseClient,
	jobId: string,
	error: string,
	params?: Record<string, unknown>
): Promise<void> {
	const msg = error.slice(0, 2000);
	const { data: failedRow } = await admin
		.from('chat_jobs')
		.update({ status: 'failed', error: msg, completed_at: new Date().toISOString() })
		.eq('id', jobId)
		.in('status', ['pending', 'running'])
		.select('brand_id, user_id, thread_id, tool_name, partial')
		.maybeSingle();
	// LA RIPRESA CHE MUORE SENZA DIRLO. Il turno che l'ha accodata scrive «riprendo in background»,
	// e quella riga è vera: il job esiste. Ma il browser sta guardando SOLO il job che ha avviato
	// lui, quindi quando la continuazione fallisce prima di produrre qualcosa non resta niente —
	// né in chat né sullo schermo. Verificato in produzione (thread e61c5136, 22/08, 20:04:13): la
	// continuazione dell'obiettivo è morta 4 secondi dopo essere partita, e l'utente ha aspettato
	// due minuti prima di scrivere «coninua» a un sistema in cui non stava girando nulla.
	// Una riga in chat, dove la persona sta già guardando. Vale solo per le riprese automatiche: un
	// turno in primo piano il suo errore ce l'ha già (chat-session.ts, ramo `job.status === 'failed'`).
	if (failedRow?.thread_id && failedRow.tool_name === 'chat_response' && params?.continuation === true) {
		const wrote = !!(failedRow.partial as { text?: string } | null)?.text;
		if (!wrote) {
			const line =
				bilingualNoticeLocale(params?.locale) === 'en'
					? 'The background pass did not run — it stopped before calling anything. Nothing is running now: tell me to try again.'
					: 'La ripresa in background non è partita — si è fermata prima di fare qualsiasi cosa. Adesso non sta girando niente: dimmi di riprovare.';
			await admin
				.from('chat_messages')
				.insert({
					brand_id: failedRow.brand_id,
					user_id: failedRow.user_id,
					thread_id: failedRow.thread_id,
					role: 'assistant',
					content: `_${line}_`
				})
				.then(undefined, () => {});
		}
	}
	if (params?.scheduled !== true) return;
	// Sullo schedule va un CODICE, non il messaggio: la pagina Agenti fa `$_('app.custom.error.' +
	// last_error)`, quindi un testo libero (o uno stack del modello) finirebbe a schermo come chiave
	// non tradotta. Il messaggio per intero resta su chat_jobs.error, dove serve a chi debugga.
	const code = /^(credits_exhausted|chat_rate_limit)\b/.test(msg) ? msg.split(':')[0] : 'run_failed';
	await admin
		.from('custom_agent_schedules')
		.update({ last_error: code, updated_at: new Date().toISOString() })
		.eq('last_job_id', jobId);
}

/**
 * Claim the oldest pending queued chat_response that has no sibling still running
 * on the same thread, then generate + persist the assistant reply.
 */
export async function processNextQueuedChatJob(
	admin: SupabaseClient,
	origin: string,
	/** Wall clock this turn may use — shrinks as a drain works through several jobs. */
	budgetMs: number = CHAT_TURN_BUDGET_MS
): Promise<{ processed: boolean; jobId?: string; error?: string }> {
	// Prefer FIFO across the fleet; skip threads that still have a running turn.
	const { data: candidates } = await admin
		.from('chat_jobs')
		.select('id, brand_id, user_id, thread_id, input_params, created_at')
		.eq('tool_name', 'chat_response')
		.eq('status', 'pending')
		.order('created_at', { ascending: true })
		.limit(20);

	if (!candidates?.length) return { processed: false };

	type QueuedJob = {
		id: string;
		brand_id: string;
		user_id: string;
		thread_id: string | null;
		input_params: unknown;
	};

	let job: QueuedJob | null = null;
	for (const c of candidates) {
		if (!c.thread_id) continue;
		const busy = await threadHasActiveChatResponse(admin, {
			userId: c.user_id as string,
			threadId: c.thread_id as string,
			excludeJobId: c.id as string
		});
		if (busy) continue;
		// Lo stesso buco visto dal lato drain: `chat_jobs` non vede i run kit, quindi il drain
		// poteva far partire un turno LEGACY sotto un run kit vivo sullo stesso thread.
		if (await threadHasActiveKitRun(admin, c.thread_id as string)) continue;
		// A prompt that has been waiting for days is not work, it is wreckage: answering it now
		// would spend credits on a question the user asked and gave up on weeks ago. Leave it for
		// the reaper to close — the drain must never resurrect one.
		if (Date.now() - Date.parse(c.created_at as string) > CHAT_PENDING_STALE_MS) continue;
		// Claim atomically — only if still pending. The heartbeat is stamped in the same write:
		// `created_at` is enqueue time, so without it a job that waited ten minutes in the queue
		// would look dead to the reaper the instant it finally started running.
		const { data: claimed } = await admin
			.from('chat_jobs')
			.update({
				status: 'running',
				partial: { text: '', tools: [], reasoning: '', at: Date.now() }
			})
			.eq('id', c.id)
			.eq('status', 'pending')
			.select('id, brand_id, user_id, thread_id, input_params')
			.maybeSingle();
		if (claimed) {
			job = claimed as QueuedJob;
			break;
		}
	}

	if (!job?.thread_id) return { processed: false };

	const jobId = job.id as string;
	const threadId = job.thread_id as string;
	const params = (job.input_params ?? {}) as Record<string, unknown>;
	const userMessageContent = String(params.user_message ?? '');
	if (!userMessageContent) {
		await failChatJob(admin, jobId, 'Missing user_message in params', params);
		return { processed: true, jobId, error: 'missing user_message' };
	}

	// `/clear` accodato: si applica QUI, cioè quando il turno che lo teneva in coda ha già finito e
	// salvato la sua risposta (il drain claima un job solo se sul thread non ne gira un altro). È
	// una scrittura, non una domanda: nessuna chiamata al modello, nessun credito. Se nel frattempo
	// è entrata in coda una CONTINUAZIONE si rifiuta invece di azzerare — riprenderebbe leggendo
	// una storia che non c'è più, e ricomincerebbe da capo senza che nessuno sappia perché.
	if (isClearCommand(userMessageContent)) {
		const en = bilingualNoticeLocale(params.locale) === 'en';
		const busy = await threadHasActiveChatResponse(admin, {
			userId: job.user_id as string,
			threadId,
			excludeJobId: jobId
		});
		if (busy) {
			await saveMessages(
				admin,
				job.brand_id as string,
				job.user_id as string,
				[{ role: 'assistant', content: clearBusyNotice(en) }],
				threadId
			).catch(() => []);
		} else {
			await clearThreadContext(
				admin,
				job.brand_id as string,
				job.user_id as string,
				threadId,
				clearContextNotice(en)
			).catch(() => false);
		}
		await admin
			.from('chat_jobs')
			.update({ status: 'done', partial: null, completed_at: new Date().toISOString() })
			.eq('id', jobId)
			.then(undefined, () => {});
		return { processed: true, jobId };
	}

	try {
		const { data: brand } = await admin
			.from('brands')
			.select(
				'id, org_id, name, slug, website, timezone, onboarding_state, setup_completed_at, plan, status, activated_at, stripe_customer_id, stripe_subscription_id, brand_kit(*)'
			)
			.eq('id', job.brand_id)
			.maybeSingle();
		if (!brand) throw new Error('Brand not found');

		const rate = await getChatRateUsage(admin, brand.id, brand.plan);
		if (!rate.ok) {
			await failChatJob(admin, jobId, `chat_rate_limit:${rate.blocked}`, params);
			return { processed: true, jobId, error: 'chat_rate_limit' };
		}

		// Il tetto mensile, che su questo percorso non esisteva: turni accodati, agenti custom
		// programmati e run di agent-team passano tutti di qui e pagavano l'intero giro anche a
		// quota esaurita. Il job muore prima di spendere e l'errore risale allo schedule.
		if (await chatCreditsBlocked(brand.id)) {
			await failChatJob(admin, jobId, 'credits_exhausted', params);
			return { processed: true, jobId, error: 'credits_exhausted' };
		}

		const locale = (params.locale as string) ?? 'en';
		const webHubEnabled = hasWebHub(brand.plan);
		const threadRow = await getThread(admin, threadId, brand.id, job.user_id as string);

		// IL MARKER DEL THREAD È L'AUTORITÀ SUL DM, non i params del job: un turno su un thread con
		// `room_agents.dm` nasce DM da qualunque provenienza — il tool, un job accodato da codice
		// futuro, un job scritto a mano. I params sono solo la scorciatoia: se mancano, chi parla si
		// deduce dal thread stesso (il membro che NON ha firmato l'ultimo messaggio user).
		const dmPair = dmAgents(threadRow?.room_agents);
		const isDm = params.dm === true || !!dmPair;
		// `params.speaker` non è solo dei DM: è la FIRMA della battuta (chat_messages.name) per
		// qualunque turno con più voci — la seconda voce di una chat di gruppo la passa uguale.
		let dmSpeaker = typeof params.speaker === 'string' && params.speaker ? params.speaker : null;
		if (dmPair && (!dmSpeaker || !dmPair.includes(dmSpeaker))) {
			const { data: lastUser } = await admin
				.from('chat_messages')
				.select('name')
				.eq('thread_id', threadId)
				.eq('role', 'user')
				.eq('superseded', false)
				.order('created_at', { ascending: false })
				.limit(1)
				.maybeSingle();
			dmSpeaker = dmPair.find((k) => k !== (lastUser?.name ?? '')) ?? dmPair[1];
		}
		const dmMemberNames = dmNames(threadRow?.room_agents);
		const dmOther = dmPair && dmSpeaker ? (dmPair.find((k) => k !== dmSpeaker) ?? null) : null;
		const dmOtherName = dmOther ? (dmMemberNames[dmOther] ?? dmOther) : null;
		// L'AGENTE FORZATO — la cucitura che room.ts:330 aveva nominato e lasciato alla fase 2.
		// Un job può dire CHI risponde (`input_params.agent` / `custom_agent_id`) e quel nome vince
		// sulla colonna del thread: è ciò che fa parlare il destinatario giusto in un DM fra agenti,
		// ed è lo stesso gancio che serve alla seconda voce di una room (che accoda con `agent`).
		// Senza params, in un DM, parla il membro dedotto qui sopra.
		const forcedAgent =
			typeof params.agent === 'string' && params.agent
				? params.agent
				: dmPair && dmSpeaker && !dmSpeaker.startsWith('custom:') && dmSpeaker !== 'anomalia'
					? dmSpeaker
					: null;
		const agentId = resolveAgentForPlan(forcedAgent ?? threadRow?.agent, webHubEnabled);
		const turnDocuments = await hydrateChatDocuments(
			admin,
			job.user_id as string,
			brand.id,
			parseChatDocuments(params.documents)
		);
		// In un DM il modello deve vedere CHI scrive DENTRO il contenuto, non solo nel system
		// prompt: "user: ciao" sotto un intero prompt di brand grida "saluta l'utente" più forte di
		// qualunque blocco — è il bug provato in produzione (il modello che saluta il brand per nome).
		// ponytail: taggato solo l'ULTIMO messaggio; lo storico resta nudo — se i DM lunghi
		// confondono, il tag va applicato in loadHistory per i thread col marker.
		// Il tag è una nota al MODELLO: sempre inglese, a prescindere dalla lingua della chat.
		const dmTaggedContent =
			isDm && dmOtherName
				? `[Message from ${dmOtherName} — a fellow AI agent of this brand, NOT the user]: ${userMessageContent}`
				: null;
		const modelUserContent = turnDocuments.length
			? stripAttachedDocsForDisplay(userMessageContent) + formatAttachedDocsForModel(turnDocuments)
			: (dmTaggedContent ?? userMessageContent);
		// The thread remembers which custom agent the user pointed it at — background turns
		// have to wear the same persona as the interactive ones. Il job può forzarlo (DM verso un
		// custom agent: il thread DM non ha un persona suo, chi parla sta nei params). Si risolve
		// PRIMA del system prompt perché è anche l'identità sotto cui questo turno legge la
		// propria memoria di mestiere.
		const personaId =
			typeof params.custom_agent_id === 'string' && params.custom_agent_id
				? params.custom_agent_id
				: dmSpeaker?.startsWith('custom:')
					? dmSpeaker.slice('custom:'.length)
					: threadRow?.custom_agent_id;
		const memoryAgentKey = personaId ? `custom:${personaId}` : agentId;
		// ── IL TURNO KIT, DAL DRAIN ────────────────────────────────────────────────────────────
		// Il drain non sapeva far girare uno specialista: qualunque job accodato su un thread kit
		// finiva nel motore CLASSICO qui sotto, cioè rispondeva un agente diverso da quello con cui
		// l'utente stava parlando — stesso thread, due motori a turni alterni. È anche la metà senza
		// la quale la ripresa automatica del kit (bridge/live.ts, ramo 'deadline') non varrebbe
		// niente: la continuazione la eseguirebbe l'altro motore.
		//
		// `waitUntil` NON serve qui, ed è una differenza sostanziale e non una svista: quel gancio
		// dichiara alla piattaforma un lavoro che deve sopravvivere alla `Response` consegnata a un
		// browser. In un cron non c'è nessun browser e nessuna Response da consegnare — è il drain
		// stesso che deve ASPETTARE il turno prima di tornare, o l'invocazione muore portandosi via
		// il lavoro. Quindi la promessa del consumo si raccoglie e si attende, che è esattamente ciò
		// che `waitUntil` fa altrove.
		//
		// L'agente è lo STESSO `agentId` del percorso classico (thread + `params.agent`): una sola
		// risoluzione, o i due motori risponderebbero con agenti diversi allo stesso job.
		//
		// FUORI dal kit restano DM, stanze e agenti custom: sono meccaniche del motore classico che
		// vivono QUI dentro (chi firma la battuta, la voce successiva, il persona nel system prompt) e
		// che il bridge non conosce. Mandarcele dentro non è «uno specialista al posto di un altro»,
		// è perdere il mittente, il persona e la catena delle voci.
		//
		// Il flag si guarda PRIMA dell'import: `shouldUseKit` resta l'autorità sulla condizione, ma
		// tirare dentro il bridge (executor, sandbox, plugin) a ogni turno accodato si paga anche a
		// kit spento.
		if (env.AGENT_KIT === 'on' && !isDm && !personaId && parseRoomAgents(threadRow?.room_agents).length < 2) {
			const { shouldUseKit, runKitTurn } = await import('$lib/agent/bridge/live');
			const kitSpec = shouldUseKit(env, agentId);
			if (kitSpec) {
				// Il battito che mancava a QUESTO ramo: la riga era reclamata col suo `partial.at` e
				// poi lasciata ferma per tutto il turno, cioè dichiarata morta dopo 90 secondi
				// mentre il turno lavorava — e questo ramo esiste per le continuazioni, che durano
				// minuti per costruzione.
				const stopHeartbeat = startChatJobHeartbeat(admin, jobId);
				return await withBrandContext(brand.id, async () => {
					// Stesso patto del percorso classico: una CONTINUAZIONE (o un messaggio che chi ha
					// accodato ha già scritto nel thread) va al MODELLO ma non in chat — salvarla come
					// 'user' la mostrerebbe come una riga scritta dall'utente, che non l'ha scritta.
					// Tutto il resto si salva, o si risponde a una richiesta che non si vede.
					const replay = params.user_message_saved === true || params.continuation === true;
					// COMPATTA PRIMA DI CARICARE, come il percorso classico (queue.ts:876,
					// chat/+server.ts:1169). Questo ramo usciva PRIMA di arrivarci: i turni kit
					// accodati non venivano compattati mai, ed e' il posto peggiore in cui saltarla
					// — la coda serve le continuazioni e i turni schedulati, cioe' proprio i thread
					// che diventano lunghi. Compattare dopo il caricamento non servirebbe: il turno
					// che sfonda la finestra e' gia' fallito.
					// Il modello serve solo per il TETTO della finestra: si risolve con gli stessi
					// ingressi che il bridge usera' un attimo dopo, cosi' il tetto e' quello vero.
					// Tutto al meglio-che-si-puo', risoluzione del modello compresa: la compattazione
					// serve a non sfondare la finestra, e se non si riesce a sapere QUALE finestra
					// il turno deve partire lo stesso. Meglio un turno lungo che nessun turno.
					await (async () => {
						const modelId = resolveChatModel(
							typeof params.tier === 'string' ? params.tier : 'auto',
							typeof params.reasoning === 'string' ? params.reasoning : undefined,
							{ userText: params.scheduled === true ? undefined : userMessageContent, agentId }
						).modelId;
						await maybeCompactThread(admin, {
							threadId,
							brandId: brand.id,
							userId: job.user_id as string,
							modelId,
							plan: brand.plan
						});
					})().catch((e) => console.warn('[Chat Queue] compattazione kit saltata:', e));
					let hist = await loadHistory(admin, brand.id, job.user_id as string, threadId);
					const tail = hist[hist.length - 1];
					const alreadySaved =
						replay ||
						(tail?.role === 'user' &&
							(typeof tail.content === 'string' ? tail.content : '') === userMessageContent);
					if (!alreadySaved) {
						await saveMessages(
							admin,
							brand.id,
							job.user_id as string,
							[{ role: 'user', content: userMessageContent }],
							threadId
						);
						hist = await loadHistory(admin, brand.id, job.user_id as string, threadId);
					}
					// La storia ricaricata porta le tool call CON i loro risultati
					// (`assistantContentFromSteps` le salva, `messagesFromRow` le rimonta): è questo che
					// fa RIPRENDERE la continuazione invece di farla ricominciare da capo.
					// `modelUserContent` e non il testo grezzo: porta i documenti allegati al turno,
					// esattamente come sul percorso classico.
					const kitMessages: ModelMessage[] = replay
						? [...hist, { role: 'user', content: modelUserContent } as ModelMessage]
						: turnDocuments.length && hist[hist.length - 1]?.role === 'user'
							? [...hist.slice(0, -1), { role: 'user', content: modelUserContent } as ModelMessage]
							: hist;

					let kitWork: Promise<unknown> = Promise.resolve();
					const res = await runKitTurn({
						supabase: admin,
						admin,
						brand,
						user: { id: job.user_id as string },
						threadId,
						spec: kitSpec,
						messages: kitMessages,
						locale: bilingualNoticeLocale(locale),
						mode: params.mode,
						tier: typeof params.tier === 'string' ? params.tier : undefined,
						modelFamily: turnModelFamily(threadRow?.model)?.family,
						reasoning: typeof params.reasoning === 'string' ? params.reasoning : undefined,
						// La scalata Auto→Pro segue la richiesta di una PERSONA: un turno schedulato o una
						// ripresa scritta dal sistema restano sul default.
						escalationText: params.scheduled === true || replay ? undefined : userMessageContent,
						origin,
						budgetMs,
						continuationDepth: Math.max(0, Math.trunc(Number(params.continuation_depth)) || 0),
						waitUntil: (p) => {
							kitWork = kitWork.then(
								() => p,
								() => p
							);
						}
					});
					// Nessuno legge questo SSE — stesso gesto del rilancio del giudice. Il turno avanza
					// col `consumeStream` interno, che è la promessa raccolta qui sopra.
					await res.body?.cancel().catch(() => {});
					await kitWork.catch((e) => console.error('[Chat Queue] kit turn failed', e));
					// 409 (`busy` / `resume_conflict`): il turno NON è stato eseguito — un run è partito
					// fra il controllo del drain e adesso. Il job torna pending invece di essere
					// dichiarato fatto; il thread resta saltato finché quel run è vivo.
					if (res.status === 409) {
						await admin
							.from('chat_jobs')
							.update({ status: 'pending', partial: null })
							.eq('id', jobId)
							.eq('status', 'running')
							.then(undefined, () => {});
						return { processed: true, jobId, error: 'kit_busy' };
					}
					await admin
						.from('chat_jobs')
						.update({
							status: 'done',
							error: null,
							partial: null,
							completed_at: new Date().toISOString()
						})
						.eq('id', jobId)
						.in('status', ['pending', 'running']);
					return { processed: true, jobId };
				}).finally(stopHeartbeat);
			}
		}
		let systemPrompt = await buildSystemPrompt(admin, brand, locale, agentId, {
			webHubEnabled,
			threadId,
			userId: job.user_id as string,
			memoryAgent: memoryAgentKey
		});
		const turnVolatileP = buildTurnVolatileBlock(admin, brand, locale).catch(() => '');
		if (dmPair && dmSpeaker && dmOtherName) {
			// IN TESTA, non in coda: la cornice che governa il turno si legge per prima. In coda ha
			// già perso una volta — il paragrafo finale non batteva l'intero prompt di brand.
			systemPrompt = `${dmBrief(dmMemberNames[dmSpeaker] ?? dmSpeaker, dmOtherName, locale)}\n\n${systemPrompt}`;
		}
		const persona = personaId ? await getCustomAgentPersona(admin, brand.id, personaId) : null;
		if (persona) systemPrompt += customAgentSystemBlock(persona, locale);
		// Anche un turno in coda deve sapere cosa ha già consegnato in questo thread, o un incarico
		// ricorrente ripubblica lo stesso report ogni settimana con un nome diverso.
		{
			const { listThreadArtifacts, formatArtifactsForPrompt } = await import('$lib/server/chat/artifacts');
			const published = await listThreadArtifacts(admin, threadId, brand.id, 20).catch(() => []);
			const block = formatArtifactsForPrompt(published);
			if (block) systemPrompt += `\n\n${block}`;
		}
		if (params.scheduled === true) {
			systemPrompt += SCHEDULED_NOTE[bilingualNoticeLocale(locale)];
		}
		// Il brief dell'agente schedulato (vedi enqueueQueuedChatTurn): l'incarico vero sta qui nel
		// system prompt, il thread mostra solo la riga corta che l'ha avviato.
		// `!isDm`: il blocco DM lo monta il runner (sopra, in testa) — un vecchio job DM ancora in
		// coda con `brief` nei params lo duplicherebbe soltanto.
		if (!isDm && typeof params.brief === 'string' && params.brief.trim()) {
			systemPrompt += `\n\n${params.brief.trim()}`;
		}
		// Same Art. 5 screen as the interactive turn — a request routed through the queue must not
		// come back without the notice the user would have seen on the streaming path.
		const aiActHits = screenForProhibitedPractice(userMessageContent, locale);
		if (aiActHits.length) {
			systemPrompt += `\n\n${aiActTurnBriefing(aiActHits)}`;
			console.log(
				`[AI Act] blacklist screen matched ${aiActHits.map((h) => h.id).join(', ')} brand=${brand.id} thread=${threadId}`
			);
		}
		// `/goal` vale anche qui: un messaggio accodato dietro un turno in corso è comunque un
		// messaggio dell'utente, e un comando che funziona solo quando la chat è libera non è un
		// comando. Stessa forma del turno interattivo, stesso ordine.
		const goalCmd = parseGoalCommand(userMessageContent);
		if (goalCmd?.kind === 'set') {
			await setThreadGoal(admin, {
				brandId: brand.id,
				userId: job.user_id as string,
				threadId,
				statement: goalCmd.statement,
				criteria: [],
				source: 'user'
			}).catch(() => null);
		} else if (goalCmd?.kind === 'stop') {
			const current = await loadOpenGoal(admin, threadId).catch(() => null);
			if (current) {
				await closeGoal(
					admin,
					current.id,
					'abandoned',
					bilingualNoticeLocale(locale) === 'en' ? 'Closed by the user.' : "Chiuso dall'utente."
				).catch(() => null);
			}
		}

		// Stesso obiettivo del turno interattivo: un lavoro che riprende in background senza sapere
		// cosa gli resta aperto ricomincerebbe dal primo elemento della lista.
		const goalAtStart = await loadOpenGoal(admin, threadId).catch(() => null);
		if (goalAtStart) {
			systemPrompt += `\n\n${goalBriefing(goalAtStart, locale)}`;
		} else if (goalWorthyRequest(userMessageContent)) {
			systemPrompt += `\n\n${goalNudge(locale)}`;
		}
		if (goalCmd) systemPrompt += `\n\n${goalCommandInstruction(goalCmd, locale)}`;

		let allTools = createChatTools(
			admin,
			brand.id,
			brand.timezone ?? 'Europe/Rome',
			job.user_id as string,
			origin,
			locale,
			threadId,
			'',
			[],
			turnDocuments,
			agentStickerColor(agentId, persona?.color),
			undefined,
			memoryAgentKey
		);
		if (!webHubEnabled) allTools = stripWebHubTools(allTools) as typeof allTools;
		// Stessa regola del turno interattivo, e qui conta anche di più: le voci dalla seconda in
		// poi di una stanza girano TUTTE da questo runner. Un membro che consultasse un collega da
		// qui riporterebbe la sua voce dentro la propria, che è esattamente il difetto.
		{
			const roomKeys = parseRoomAgents(threadRow?.room_agents);
			if (roomKeys.length >= 2) allTools = stripRoomPeerTools(allTools, roomKeys) as typeof allTools;
		}
		if (params.scheduled === true || isDm) {
			// Turno non presidiato (agente di default promosso, agente custom schedulato, O risposta
			// a un DM fra agenti — anche lì non c'è una persona nella stanza): via i tool che la
			// presuppongono — UNA lista, UNA applicazione, per tutti i consumatori (chiude anche il
			// buco noto degli agenti custom schedulati col set completo).
			allTools = stripUnattendedTools(allTools);
		}
		if (params.scheduled === true) {
			// E dentro il tool che allo Stratega serve per consegnare: la proposta del prossimo
			// ciclo editoriale (status proposed — l'attivazione resta deterministica nello scheduler).
			allTools = withStrategistTools(allTools, {
				supabase: admin,
				brandId: brand.id,
				locale
			}) as typeof allTools;
		}
		// Il set ristretto all'hub è quello dell'agente; quello intero è il tetto dei sotto-agenti.
		let customTools = pickTools(allTools, agentId);

		// Il budget del turno nasce dentro il blocco qui sotto, i tool si costruiscono prima: questo
		// è il ponte, così una delega non parte con pochi secondi rimasti.
		let queueDeadline: { remainingMs: () => number } | null = null;
		return await withBrandContext(brand.id, async () => {
			const chatModel = resolveChatModel(
				// 'auto' e non undefined: il fallback su env.CHAT_TIER è per la chat interattiva senza
				// preferenze, non per un seed di onboarding o uno schedule (vedi enqueueQueuedChatTurn).
				typeof params.tier === 'string' ? params.tier : 'auto',
				typeof params.reasoning === 'string' ? params.reasoning : undefined,
				// Scalata Auto→Pro sui lavori di produzione — solo per messaggi di persone: un turno
				// schedulato (o un DM fra agenti) non è una richiesta dell'utente e resta sul default.
				// agentId: su Auto la famiglia la decide lo spec (motion → Grok, resto → Luna).
				{
					userText: params.scheduled === true || isDm ? undefined : userMessageContent,
					agentId,
					// La preferenza salvata: il thread vince, poi quella permanente dell'agente custom.
					model: turnModelFamily(threadRow?.model, persona?.model)
				}
			);
			// Stessa delega del turno interattivo: un lavoro lungo si spezza in ricerca →
			// esecuzione → verifica anche quando gira in coda, senza nessuno che guarda.
			customTools = withSubagentTools(customTools, {
				supabase: admin,
				brandId: brand.id,
				tools: allTools,
				model: chatModel,
				locale,
				userId: job.user_id as string,
				threadId,
				webHubEnabled,
				defaultAgent: agentId,
				origin,
				remainingMs: () => queueDeadline?.remainingMs() ?? Number.POSITIVE_INFINITY
			});
			// Stessa macchina del turno interattivo: un lavoro in coda ne ha bisogno più di uno
			// davanti a qualcuno, perché nessuno può fargli da terminale al posto suo.
			const sandboxMount = withSandboxTools(customTools, {
				supabase: admin,
				brandId: brand.id,
				userId: job.user_id as string,
				threadId,
				agentId: computerOwner(personaId, agentId),
				webHubEnabled,
				remainingMs: () => queueDeadline?.remainingMs() ?? Number.POSITIVE_INFINITY
			});
			customTools = sandboxMount.tools;
			await maybeCompactThread(admin, {
				threadId,
				brandId: brand.id,
				userId: job.user_id as string,
				modelId: chatModel.modelId,
				plan: brand.plan
			});

			// History may or may not already include this user turn. Chi la scrive prima di accodare
			// (i DM via message_agent, il seed dell'onboarding) lo fa apposta: la riga deve essere
			// visibile SUBITO, non al primo tick del drain. Chi non la scrive la fa scrivere qui.
			// Il patto con quei chiamanti è il confronto qui sotto: stessa identica stringa in
			// `chat_messages.content` e in `input_params.user_message`, o si duplica.
			let history = await loadHistory(admin, brand.id, job.user_id as string, threadId);
			const tail = history[history.length - 1];
			// Un DM è SEMPRE già salvato: message_agent scrive la riga (firmata col mittente) al
			// momento dell'invio, così l'utente la vede subito — risalvarla qui la duplicherebbe
			// senza firma appena il tail non è più quella riga.
			// Chat di gruppo, voce successiva: il messaggio dell'utente è già nel thread ma NON è più
			// l'ultima riga (in mezzo c'è la battuta del primo speaker). Non si risalva, e si
			// riaggancia in coda solo per il modello — vedi `userMessageSaved` in enqueue.
			// Una CONTINUAZIONE è un dialogo interno (la ripresa dell'obiettivo, il «continua»
			// di sistema): il suo prompt va al MODELLO ma non nel thread — salvato con role
			// 'user' compariva in UI come un messaggio scritto dall'utente, che non l'ha
			// scritto. Stessa strada di user_message_saved: si appende in coda solo in memoria.
			const replayUserMessage = params.user_message_saved === true || params.continuation === true;
			const alreadySaved =
				isDm ||
				replayUserMessage ||
				(tail?.role === 'user' &&
					(typeof tail.content === 'string' ? tail.content : '') === userMessageContent);
			if (!alreadySaved) {
				await saveMessages(
					admin,
					brand.id,
					job.user_id as string,
					[{ role: 'user', content: userMessageContent }],
					threadId
				);
				history = await loadHistory(admin, brand.id, job.user_id as string, threadId);
			}
			const messages: ModelMessage[] = (() => {
				const hist = history as ModelMessage[];
				if (replayUserMessage) {
					return [...hist, { role: 'user', content: modelUserContent } as ModelMessage];
				}
				if (!turnDocuments.length && !dmTaggedContent) return hist;
				const last = hist[hist.length - 1];
				if (last?.role !== 'user') return hist;
				return [...hist.slice(0, -1), { ...last, content: modelUserContent }];
			})();
			const turnVolatile = await turnVolatileP;
			if (turnVolatile) {
				const idx = messages.findLastIndex((m) => m.role === 'user');
				if (idx >= 0) messages[idx] = wrapTurnMessage(turnVolatile, messages[idx]);
			}

			const chatT0 = Date.now();
			const deadline = chatTurnDeadline(chatT0, budgetMs);
			queueDeadline = deadline;
			const loopGuard = createChatLoopGuard();
			// Il tetto sui TOKEN, sulla coda come sulla chat viva: un tetto su una superficie sola
			// è mezzo tetto, e questa è la superficie dove girano le riprese automatiche.
			const tokenBudget = chatTokenBudget();

			// Il mirror del PROGRESSO, non solo del battito. generateText non streamma, ma i confini
			// di step sì: testo e tool di ogni step si accumulano qui e il heartbeat li scrive su
			// `partial`. Prima il partial restava vuoto per tutto il turno e la UI di un turno in
			// coda (l'onboarding incluso) mostrava solo "Thinking" senza mai un segno di vita — e un
			// turno morto a metà non aveva niente da salvare.
			const livePartial: {
				text: string;
				tools: Array<{ toolCallId: string; toolName: string; status: string; textLen: number }>;
				reasoning: string;
			} = { text: '', tools: [], reasoning: '' };

			// Same liveness beacon as the streaming route — now carrying the step progress above.
			const stopHeartbeat = startChatJobHeartbeat(admin, jobId, () => livePartial);

			// I follow-up scritti mentre questo turno gira entrano al prossimo step (mid-turn-mailbox).
			const midTurnMailbox = createMidTurnMailbox(admin, {
				brandId: brand.id,
				userId: job.user_id as string,
				threadId,
				jobId
			});

			let genFailed = false;
			let genError: unknown = null;
			const result = await harnessGenerateText({
				brandId: brand.id,
				userId: job.user_id as string,
				threadId,
				jobId,
				agent: 'chat_queue',
				mode: typeof params.mode === 'string' ? params.mode : agentId,
				model: chatModel.modelId,
				provider: chatModel.provider,
				surface: 'chat'
			}, {
				model: chatModel.model,
				system: systemPrompt,
				messages,
				// Per-step ceiling. This path has no hard abort at all — a hanging tool here runs
				// until the platform kills the worker, taking the rest of the drain with it.
				tools: withStepDeadline(customTools, {
					remainingMs: deadline.remainingMs,
					onExpired: ({ tool, waitedMs, reason }) => {
						console.error(
							`[Chat Queue] step deadline jobId=${jobId}, threadId=${threadId}, tool=${tool}, ${reason}, ${waitedMs}ms`
						);
					}
				}),
				// Un DM è un consulto fra colleghi, non una produzione: il tetto tiene il suo costo lì.
				// La domanda all'utente CHIUDE il turno. Non è un'istruzione di prompt che il modello
				// può ignorare (e ignorava: chiedeva e tirava dritto, rispondendosi da solo): è una
				// condizione di stop dell'SDK. Lo step in cui `ask_user_questions` viene chiamato è
				// l'ultimo — niente altri step, niente testo oltre la domanda — e il lavoro riprende
				// solo quando arriva la risposta (o lo skip), che entra come normale messaggio utente
				// e fa partire il turno successivo.
				stopWhen: [
					hasToolCall('ask_user_questions'),
					stepCountIs(isDm ? DM_REPLY_STEP_CAP : chatMaxTurns()),
					deadline.reached,
					loopGuard.reached,
					tokenBudget.reached
				],
				temperature: 0.4,
				...chatModel.callOptions,
				prepareStep: benchAwarePrepareStep(
					loopGuard,
					Object.keys(customTools),
					midTurnMailbox.prepareStep
				),
				onStepFinish: ({ toolCalls, text, content }: { toolCalls?: Array<{ toolName: string; input?: unknown }>; text?: string; content?: unknown }) => {
					loopGuard.recordStep(
						toolCalls?.map((tc) => ({
							toolName: tc.toolName,
							input: 'input' in tc ? tc.input : undefined
						})),
						text
					);
					loopGuard.recordToolFailures(content);
					// Aggiorna il mirror: la UI in polling vede il testo crescere e i tool comparire.
					for (const tc of toolCalls ?? []) {
						livePartial.tools.push({
							toolCallId: String(
								('toolCallId' in tc ? tc.toolCallId : undefined) ?? `q-${livePartial.tools.length}`
							),
							toolName: tc.toolName,
							status: 'done',
							textLen: livePartial.text.length
						});
					}
					if (text) livePartial.text += (livePartial.text ? '\n\n' : '') + text;
				}
			})
				.catch((e) => {
					genFailed = true;
					genError = e;
					return null;
				})
				.finally(() => {
					stopHeartbeat();
					// I file di questo turno se ne vanno con lui, sia che sia andato bene sia che no.
					void sandboxMount.close().catch(() => undefined);
				});

			if (genFailed || !result) {
				// Il mirror di step È il partial: quello che il turno aveva già prodotto si salva,
				// come sul percorso in streaming.
				const content = contentFromFailedTurn({
					steps: null,
					text: null,
					partial: livePartial
				});
				await failChatJob(
					admin,
					jobId,
					genError instanceof Error ? genError.message : String(genError ?? 'generate failed'),
					params
				);
				if (content.length) {
					await persistPartialAssistantReply(admin, {
						brandId: brand.id,
						userId: job.user_id as string,
						threadId,
						content,
						jobId,
						model: chatModel.modelId,
						tier: chatModel.tier,
						durationMs: Date.now() - chatT0,
						error: genError instanceof Error ? genError.message : String(genError)
					});
				}
				await reportChatError(null, genError ?? new Error('generate failed'), {
					brandId: brand.id,
					brandSlug: brand.slug,
					userId: job.user_id as string,
					threadId,
					jobId,
					tier: chatModel.tier,
					provider: chatModel.provider,
					model: chatModel.modelId,
					kind: 'chat_queue_failed'
				});
				return {
					processed: true,
					jobId,
					error: genError instanceof Error ? genError.message : String(genError)
				};
			}

			logAiCall({
				label: 'chat',
				provider: chatModel.provider,
				model: chatModel.modelId,
				ms: Date.now() - chatT0,
				ok: true,
				...extractSdkUsage(result.totalUsage),
				// kie fattura in crediti e riporta `input_tokens: 0` sugli step di un loop agentico:
				// senza questo, cost_usd direbbe zero per un turno che è costato davvero.
				...takeKieUsage(chatModel),
				brandId: brand.id,
				userId: job.user_id as string,
				threadId,
				context: 'chat_queue'
			});

			const depth = Math.max(0, Math.trunc(Number(params.continuation_depth)) || 0);

			// ── Obiettivo: il turno è finito, il lavoro può non esserlo ──────────────────
			// Come nel turno interattivo, e per la stessa ragione: la ripresa si decide e si mette in
			// coda PRIMA di scrivere la riga di chiusura, perché quella riga promette qualcosa.
			// Il turno si è fermato sulla domanda (hasToolCall sopra): da qui in poi non si riprende
			// niente da soli — né per obiettivo né per tempo scaduto. Aspetta la persona.
			const awaitingAnswer = (result.steps ?? []).some((st: { toolCalls?: Array<{ toolName: string }> }) =>
				st.toolCalls?.some((tc) => tc.toolName === 'ask_user_questions')
			);
			// Il turno ha lavorato, o ha solo raccontato? Serve a `settleGoalForTurn` per decidere se
			// una chiusura scritta in prosa («c1 chiuso») vale come chiusura vera. Vedi goal.ts.
			// Conta il RISULTATO: due tool chiamati che tornano entrambi `error` non sono lavoro.
			const succeededTools = succeededToolNames(result.steps as TurnStep[], GOAL_TOOL_KEYS);
			const refusedTools = refusedToolNames(result.steps as TurnStep[], GOAL_TOOL_KEYS);
			const goalSettled = await settleGoalForTurn(admin, {
				threadId,
				goalAtStart,
				awaitingAnswer,
				turnText: result.text ?? '',
				succeededTools,
				refusedTools,
				knownTools: Object.keys(customTools),
				timeRanOut: deadline.expired && !loopGuard.stalled,
				loopStalled: loopGuard.stalled,
				aborted: false,
				failed: false,
				depth,
				maxDepth: CHAT_MAX_CONTINUATIONS,
				locale
			}).catch((e) => {
				console.error('[Chat Queue] goal settle failed', e);
				return null;
			});
			// Se il calcolo dell'obiettivo è fallito, resta la regola di prima: tempo scaduto sì,
			// stallo no. Un pezzo nuovo che si rompe non deve portarsi via una ripresa che c'era.
			// Un DM non si continua da solo: se il destinatario non ha chiuso in DM_REPLY_STEP_CAP step, riferisce
			// quello che ha e l'altro agente (o l'utente) decide — non una catena di turni in coda.
			/**
			 * IL VIDEO NON FINITO. La chat non ha un `finish`, quindi finora si fermava quando il
			 * modello smetteva di parlare — con una mediana di 26 secondi su un budget di 1735, la
			 * ripresa per tempo scaduto non si armava mai. Vedi motion-video/unfinished.ts.
			 */
			const motionUnfinished =
				isDm || awaitingAnswer || loopGuard.stalled
					? null
					: await decideMotionContinuation(admin, {
							brandId: brand.id,
							threadId,
							depth,
							steps: result.steps as never,
							locale
						}).catch((e) => {
							console.error('[Chat Queue] motion continuation check failed', e);
							return null;
						});
			// Fermato dal tetto sui token: nessuna ripresa. Riprendere un turno fermato per costo è
			// il modo più diretto di raddoppiare quel costo. Stessa regola dello stallo.
			const shouldContinue =
				!isDm &&
				!awaitingAnswer &&
				!tokenBudget.exceeded &&
				(motionUnfinished?.continue === true ||
					(goalSettled ? goalSettled.decision.continue : deadline.expired && !loopGuard.stalled));
			let continuationJobId: string | null = null;
			if (shouldContinue) {
				continuationJobId = await enqueueTurnContinuation(admin, {
					brandId: brand.id,
					userId: job.user_id as string,
					threadId,
					origin,
					locale,
					mode: typeof params.mode === 'string' ? params.mode : undefined,
					tier: typeof params.tier === 'string' ? params.tier : undefined,
					reasoning: typeof params.reasoning === 'string' ? params.reasoning : undefined,
					depth,
					// Un video da finire ne chiede 24 come la pagina; una conversazione resta a 9.
					...(motionUnfinished?.continue ? { maxDepth: MOTION_MAX_CONTINUATIONS } : {}),
					...(goalSettled?.continuationPrompt
						? { prompt: goalSettled.continuationPrompt }
						: motionUnfinished?.prompt
							? { prompt: motionUnfinished.prompt }
							: {})
				});
			}

			if (goalSettled) {
				trackGoalSettlement(admin, goalSettled, {
					brandId: brand.id,
					userId: job.user_id as string,
					threadId,
					depth,
					queued: !!continuationJobId
				});
			}

			const content = assistantContentFromSteps(result.steps, result.text);
			if (aiActHits.length) {
				content.unshift({ type: 'text', text: aiActUserNotice(aiActHits, locale) });
			}
			// Stopped on the clock, not on the answer — say so, or a batch cut off halfway reads as
			// a finished (and wrong) report.
			if (tokenBudget.exceeded) {
				console.warn(
					`[Chat Queue] token budget stop jobId=${jobId}, threadId=${threadId}, used=${tokenBudget.usedTokens}, budget=${tokenBudget.budget}, steps=${result.steps?.length ?? 0}`
				);
				content.push({
					type: 'text',
					text: turnTokenBudgetNotice(locale, tokenBudget.usedTokens, tokenBudget.budget)
				});
			} else if (loopGuard.stalled) {
				content.push({ type: 'text', text: turnLoopNotice(locale) });
			} else if (deadline.expired) {
				// Un fatto, non una previsione: la ripresa è già in coda, o non c'è.
				content.push({ type: 'text', text: turnTruncatedNotice(locale, !!continuationJobId) });
			}
			// Il giro sul video si è fermato senza consegnare: si dice, con il motivo. Un ciclo che
			// si chiude in silenzio è indistinguibile da un lavoro finito.
			{
				const line = motionUnfinishedNotice(motionUnfinished, locale);
				if (line) content.push({ type: 'text', text: line });
			}
			if (goalSettled) {
				const goalLine = goalTurnNotice(
					goalSettled.goal,
					goalSettled.decision,
					locale,
					!!continuationJobId,
					goalSettled.closedNow
				);
				if (goalLine) content.push({ type: 'text', text: goalLine });
			}
			// Lavoro dichiarato e mai fatto: se il turno dice di aver PRODOTTO contenuti e nessun
			// tool ha restituito un artefatto (né il database ne ha di freschi), la conversazione
			// si chiude con la correzione onesta invece che con la bugia. Vedi production-claim.ts.
			const claimFix = await unverifiedProductionClaim({
				content,
				locale,
				goalOpen: !!goalSettled?.goal,
				hasRecentArtifacts: recentPostsProbe(admin, brand.id)
			});
			if (claimFix) content.push({ type: 'text', text: claimFix });
			const sources = sourcesFromSteps(result.steps, brand.slug ?? '');
			let assistantMessageId: string | undefined;
			if (content.length > 0) {
				const [savedId] = await saveMessages(
					admin,
					brand.id,
					job.user_id as string,
					[{ role: 'assistant', content } as unknown as ModelMessage],
					threadId,
					{
						durationMs: Date.now() - chatT0,
						model: chatModel.modelId,
						tier: chatModel.tier,
						inputTokens: result.totalUsage?.inputTokens,
						outputTokens: result.totalUsage?.outputTokens,
						...(sources.length ? { sources } : {}),
						// DM fra agenti e chat di gruppo: la risposta è firmata col membro che parla
						// (chat_messages.name) — dai params, o dedotto dal marker quando il job non li porta.
						...(dmSpeaker ? { speaker: dmSpeaker } : {})
					}
				);
				assistantMessageId = savedId;
			}

			// await:true di message_agent non versa più nulla nel thread con l'utente: la chip
			// "N messaggi con X" è l'unica interazione, e la conversazione fra agenti vive nel
			// thread DM (sola lettura). Un riassunto 📩 qui faceva vedere all'utente messaggi
			// che non sono suoi.

			// ── La battuta continua? ────────────────────────────────────────────────────────────
			// Le voci dalla seconda in poi girano da questo runner, quindi è QUI che la catena si
			// allunga (o finisce). Stessa posizione del turno interattivo — dopo il salvataggio,
			// prima della chiusura del job — perché è l'ordine a serializzare: in questa finestra
			// il job è ancora `running` e il drenaggio salta il thread.
			// Stop ferma la catena: un turno cancellato non accoda la voce dopo.
			if (!isDm && threadRow) {
				const { data: nowJob } = await admin
					.from('chat_jobs')
					.select('status')
					.eq('id', jobId)
					.maybeSingle();
				if (nowJob?.status !== 'cancelled') {
					const { roomContinue } = await import('./room');
					await roomContinue(admin, {
						thread: { id: threadId, room_agents: threadRow.room_agents },
						brandId: brand.id,
						userId: job.user_id as string,
						userMessage: userMessageContent,
						locale,
						origin,
						mode: typeof params.mode === 'string' ? params.mode : undefined,
						tier: typeof params.tier === 'string' ? params.tier : undefined
					});
				}
			}

			if (history.length <= 1) {
				const thread = await getThread(admin, threadId, brand.id, job.user_id as string);
				if (thread && (thread.title === 'Nuova chat' || thread.title === 'New chat')) {
					const title =
						userMessageContent.length > 50 ? userMessageContent.slice(0, 50) + '…' : userMessageContent;
					await renameThread(admin, threadId, brand.id, job.user_id as string, title);
				}
			}

			void extractMemoryFromChat(admin, brand.id, userMessageContent, result.text ?? '', {
				threadId,
				messageId: assistantMessageId
			}).catch(() => {});

			// Anche da 'failed': se siamo qui il turno ha finito davvero — il reaper può averlo dato
			// per morto (heartbeat in stallo) e aver promosso il partial come messaggio. Quel
			// salvataggio ora è un doppione della risposta piena: si supersede e la riga torna done.
			{
				const { data: jobNow } = await admin
					.from('chat_jobs')
					.select('status, result')
					.eq('id', jobId)
					.maybeSingle();
				const salvagedId = (jobNow?.result as { salvaged_message_id?: string } | null)
					?.salvaged_message_id;
				if (jobNow?.status === 'failed' && salvagedId && assistantMessageId) {
					await admin
						.from('chat_messages')
						.update({ superseded: true })
						.eq('id', salvagedId)
						.eq('thread_id', threadId)
						.then(undefined, () => {});
				}
			}
			await admin
				.from('chat_jobs')
				.update({
					status: 'done',
					error: null,
					partial: null,
					result: { text_length: result.text?.length ?? 0 },
					completed_at: new Date().toISOString()
				})
				.eq('id', jobId)
				.in('status', ['pending', 'running', 'failed']);

			// Il team si presenta: chiuso il primo turno di setup, gli specialisti del piano
			// contattano l'utente nei loro thread. Import dinamico: il modulo accoda turni qui.
			if (threadRow?.surface === 'onboarding') {
				const { igniteOnboardingTeam } = await import('$lib/server/onboarding-team');
				await igniteOnboardingTeam(admin, {
					brandId: brand.id,
					userId: job.user_id as string,
					brandName: String(brand.name ?? ''),
					website: (brand.website as string | null) ?? null,
					plan: (brand.plan as string | null) ?? null,
					locale,
					origin
				});
			}

			try {
				const { sendPushToUser } = await import('$lib/server/web-push');
				await sendPushToUser(admin, job.user_id as string, {
					title: 'Anomalia',
					body: bilingualNoticeLocale(locale) === 'en' ? 'Your AI reply is ready' : "L'AI ha finito di rispondere",
					url: `/app/${brand.slug}/chat/${threadId}`,
					tag: 'chat-ai-ready',
					skipIfFocused: true
				});
			} catch {
				/* best-effort */
			}

			return { processed: true, jobId };
		});
	} catch (e) {
		const errorMsg = e instanceof Error ? e.message : String(e);
		console.error(`[Chat Queue] Failed job=${jobId}`, errorMsg);
		await failChatJob(admin, jobId, errorMsg, params);
		return { processed: true, jobId, error: errorMsg };
	}
}

/**
 * Least time a turn is worth starting with. Below this the worker stops and self-chains instead,
 * so the next invocation gets a full budget rather than a turn dying 40s in.
 */
const MIN_TURN_SLICE_MS = 90_000;

/**
 * Run one long-tool job that nobody is executing.
 *
 * `runLongTool` inserts its rows straight into `running` because it executes them inline, so a tool
 * job sitting at `pending` means the opposite: it was enqueued for someone else to run, and until
 * this existed that someone was nobody. The endpoint meant to run them, /api/v1/chat/run, has no
 * caller anywhere in the repo, and the turn drain filters on `tool_name = 'chat_response'`. A
 * pending tool job therefore had no executor at all — it simply aged until the reaper declared it
 * dead. That is the whole reason async tools were abandoned for inline awaiting.
 *
 * Deliberately NOT resuming abandoned `running` rows: re-running a job whose process died means
 * paying a second time for a clip that may well have been rendered. The reaper closes and reports
 * those; deciding to retry one is a policy call with money attached, not a default.
 */
export async function processNextPendingToolJob(
	admin: SupabaseClient,
	/** Dove accodare il turno di rientro. Vuoto = si usa quello salvato nei params del job. */
	origin: string = ''
): Promise<{ processed: boolean; jobId?: string; error?: string }> {
	// Allowlist, never "everything that isn't a chat turn": chat_jobs is shared with the designer,
	// whose motion_video / ugc_batch continuations sit pending for a worker of their own. Claiming
	// one would run it into the executor's default case and mark a row `done` whose work never
	// happened. reapStaleChatJobs skips those two names for the same reason.
	const { executeChatToolJob, EXECUTABLE_TOOL_JOBS } = await import('$lib/server/chat/job-executor');
	const { data: candidates } = await admin
		.from('chat_jobs')
		.select('id, brand_id, user_id, thread_id, tool_name, input_params, created_at')
		.in('tool_name', EXECUTABLE_TOOL_JOBS as unknown as string[])
		.eq('status', 'pending')
		.order('created_at', { ascending: true })
		.limit(10);

	if (!candidates?.length) return { processed: false };

	for (const candidate of candidates) {
		// Same contract as the turn drain: something this old is wreckage, not work. Leave it to
		// the reaper rather than spending credits on an intent the user has long since abandoned.
		if (Date.now() - Date.parse(candidate.created_at as string) > CHAT_PENDING_STALE_MS) continue;

		const { data: claimed } = await admin
			.from('chat_jobs')
			.update({
				status: 'running',
				partial: { text: '', tools: [], reasoning: '', at: Date.now() }
			})
			.eq('id', candidate.id)
			.eq('status', 'pending')
			.select('id')
			.maybeSingle();
		// Lost the race to another drain — that is the lock working, not an error.
		if (!claimed) continue;

		const jobId = candidate.id as string;
		const toolName = String(candidate.tool_name ?? '');
		const { createJobCancellation, isChatJobCancelledError } = await import(
			'$lib/server/chat/job-cancel'
		);
		const cancel = createJobCancellation(admin, jobId);

		// The tool jobs worth running out-of-band are the slow ones, so keep the row's heartbeat
		// ticking: without it the reaper closes a perfectly healthy render out from under itself.
		const stopHeartbeat = startChatJobHeartbeat(admin, jobId);

		try {
			const result = await withBrandContext(candidate.brand_id as string, () =>
				executeChatToolJob(
					admin,
					candidate.brand_id as string,
					candidate.user_id as string,
					toolName,
					(candidate.input_params ?? {}) as Record<string, unknown>,
					cancel,
					{ id: jobId, thread_id: (candidate.thread_id as string | null) ?? null }
				)
			);
			await cancel.assertActive();
			// `select` per farne un CLAIM: solo chi si prende davvero la riga accoda il rientro,
			// così un reaper che l'avesse già chiusa non produce un secondo messaggio nel thread.
			const { data: closed } = await admin
				.from('chat_jobs')
				.update({ status: 'done', result, completed_at: new Date().toISOString() })
				.eq('id', jobId)
				.eq('status', 'running')
				.select('id')
				.maybeSingle();
			console.log(`[Chat Queue] tool job done jobId=${jobId}, tool=${toolName}`);
			// Il rientro in conversazione: stesso meccanismo dei DM (turno accodato sul thread di
			// partenza, assorbito dalla mailbox se un turno è ancora vivo). Vedi tool-job-report.ts.
			if (closed) {
				const { enqueueToolJobReport } = await import('$lib/server/chat/tool-job-report');
				await enqueueToolJobReport(
					admin,
					candidate as Parameters<typeof enqueueToolJobReport>[1],
					{ status: 'done', result },
					origin
				);
			}
			return { processed: true, jobId };
		} catch (e) {
			// A cancel and a timed-out fetch both surface as AbortError, and neither may return
			// without closing the row: the heartbeat stops in `finally`, so a row left `running`
			// here sits frozen until the reaper eventually reports it as a death it did not suffer.
			if (isChatJobCancelledError(e) || (e instanceof Error && e.name === 'AbortError')) {
				await admin
					.from('chat_jobs')
					.update({ status: 'cancelled', completed_at: new Date().toISOString() })
					.eq('id', jobId)
					.eq('status', 'running')
					.then(undefined, () => {});
				return { processed: true, jobId };
			}
			const error = e instanceof Error ? e.message : String(e);
			const { data: closedFailed } = await admin
				.from('chat_jobs')
				.update({ status: 'failed', error: error.slice(0, 2000), completed_at: new Date().toISOString() })
				.eq('id', jobId)
				.eq('status', 'running')
				.select('id')
				.maybeSingle();
			console.error(`[Chat Queue] tool job failed jobId=${jobId}, tool=${toolName}:`, error);
			// Anche il fallimento rientra: il silenzio lascerebbe l'utente con "avviato" e mai un esito.
			if (closedFailed) {
				const { enqueueToolJobReport } = await import('$lib/server/chat/tool-job-report');
				await enqueueToolJobReport(
					admin,
					candidate as Parameters<typeof enqueueToolJobReport>[1],
					{ status: 'failed', error },
					origin
				);
			}
			return { processed: true, jobId, error };
		} finally {
			stopHeartbeat();
		}
	}

	return { processed: false };
}

export async function drainChatQueue(opts: {
	origin: string;
	/** Soft cap so one worker invocation doesn't run forever. */
	maxJobs?: number;
	/**
	 * Sweep dead job rows before draining. Scheduled runs only: this is a scan across every user,
	 * and the inline kick after each turn fires far too often to pay for one.
	 */
	reap?: boolean;
	/**
	 * Where this drain is running.
	 *
	 * `serverless` (default) is the original shape: bounded by the function wall, and when it runs
	 * out of room it hands the rest to a fresh invocation over HTTP.
	 *
	 * `worker` is a long-lived process. It has no wall to dodge, so it neither cuts turns short at
	 * ~4m20s nor self-chains — its own loop picks up whatever is left on the next lap. This is what
	 * lets a turn outlive 300s, which is the whole reason the worker exists.
	 */
	mode?: 'serverless' | 'worker';
	/** Per-turn wall clock in worker mode. Defaults to {@link CHAT_WORKER_TURN_BUDGET_MS}. */
	turnBudgetMs?: number;
}): Promise<{ processed: number; reaped: number; toolJobs: number }> {
	const admin = createAdminClient();
	const inWorker = opts.mode === 'worker';
	const maxJobs = opts.maxJobs ?? 3;
	// Leave room for the final turn's own persistence plus the self-chain fetch. A worker has no
	// such wall — Infinity keeps the slice arithmetic below identical instead of branching it.
	const workerDeadline = inWorker ? Infinity : Date.now() + CHAT_MAX_DURATION_MS - 40_000;
	const turnBudgetMs = opts.turnBudgetMs ?? CHAT_WORKER_TURN_BUDGET_MS;
	let moreToolWork = false;

	// The cron is the only sweep that reaches users who are not currently looking at their chat.
	// Before it existed a zombie kept claiming "still generating" until somebody happened to reopen
	// the thread — which is exactly how a dead turn stayed dead-but-spinning for sixteen minutes.
	const reaped = opts.reap
		? await reapStaleChatJobs(admin).catch((e) => {
				console.error('[Chat Queue] reap failed', e);
				return 0;
			})
		: 0;

	// Long-tool jobs first, and before the turns on purpose: a turn is usually waiting to REPORT on
	// one, so draining the tool first means the turn that follows has something to say.
	//
	// The wall check below only gates STARTING another one — executeChatToolJob takes no deadline,
	// so a render already under way runs as long as it runs and can overrun the invocation. Hence
	// one job per lap under serverless: the overrun is then bounded by a single tool rather than by
	// `maxJobs` of them stacked, and the next cron tick picks up the rest. A worker has no wall to
	// overrun and can drain the batch.
	const maxToolJobs = inWorker ? maxJobs : 1;
	let toolJobs = 0;
	for (let i = 0; i < maxToolJobs; i++) {
		if (workerDeadline - Date.now() < MIN_TURN_SLICE_MS) {
			moreToolWork = true;
			break;
		}
		const r = await processNextPendingToolJob(admin, opts.origin).catch((e) => {
			console.error('[Chat Queue] tool job drain failed', e);
			return { processed: false };
		});
		if (!r.processed) break;
		toolJobs += 1;
	}

	let processed = 0;
	let moreLikely = moreToolWork;
	for (let i = 0; i < maxJobs; i++) {
		const slice = workerDeadline - Date.now();
		if (slice < MIN_TURN_SLICE_MS) {
			// Out of room, not out of work — hand the rest to a fresh invocation with a full budget.
			moreLikely = true;
			break;
		}
		const r = await processNextQueuedChatJob(
			admin,
			opts.origin,
			inWorker ? turnBudgetMs : Math.min(CHAT_TURN_BUDGET_MS, slice)
		);
		if (!r.processed) break;
		processed += 1;
	}
	// The self-chain exists to escape the function wall. A worker's own loop is the next lap, so
	// kicking would only make it race an HTTP call against itself.
	if (!inWorker && (processed > 0 || toolJobs > 0 || moreLikely)) {
		void kickChatQueueWork(opts.origin);
	}
	return { processed, reaped, toolJobs };
}

// ── Dev: il cron che non c'è ──────────────────────────────────────────────────────────────────
// In produzione i job accodati li drena il cron di Vercel (GET /api/v1/chat/queue/work, ogni 2
// minuti) e lo stesso giro chiude gli zombie col reaper. In `npm run dev` quel cron NON esiste:
// se il kick inline si perde (restart del dev server, HMR mentre altri agenti scrivono file), un
// job pending resta lì per sempre e un turno morto non viene mai chiuso — è la coppia di thread
// rimasti su "Thinking" del 2026-08-21. Un timer di modulo fa le veci del cron.
// ponytail: timer per processo, ricreato a ogni re-import HMR (il vecchio viene fermato).
if (dev && !process.env.VITEST) {
	const g = globalThis as { __anomaliaChatQueueDevCron?: ReturnType<typeof setInterval> };
	if (g.__anomaliaChatQueueDevCron) clearInterval(g.__anomaliaChatQueueDevCron);
	g.__anomaliaChatQueueDevCron = setInterval(() => {
		const origin = `http://localhost:${process.env.PORT ?? 5173}`;
		void drainChatQueue({ origin, maxJobs: 2, reap: true }).catch(() => undefined);
	}, 60_000);
}
