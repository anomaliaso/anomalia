import { bilingualNoticeLocale } from '$lib/i18n/locale';
import type { SubagentRole } from './subagents';

/**
 * How long a chat turn may live, and how to tell a working turn from one whose process is gone.
 * The platform kills the function at the wall mid-token: no onError, no onFinish, nothing thrown.
 * So a turn must stop itself before the wall, and anything still `running` past it is a dead row.
 */

/**
 * Must equal `config.maxDuration` on the chat routes. Vercel only honours its own tiers: 300 on
 * every plan, 800 GA on Pro/Enterprise, 1800 extended (per-function, incompatible with Secure
 * Compute / Static IPs). Change this one number and the budgets below follow.
 */
export const CHAT_MAX_DURATION_MS = 1_800_000;

/** Absolute cost of `onFinish` after the model stops (persist, log, memory, kick) — it does not
 * grow with the wall, so it stays a fixed reserve. */
const POST_MODEL_RESERVE_MS = 65_000;

/** What the hard abort needs to salvage a partial reply and re-queue the remainder. */
const SALVAGE_RESERVE_MS = 35_000;

/**
 * Soft budget for generation — the wall minus the post-model work the wall would otherwise eat.
 *
 * `CHAT_TURN_BUDGET_MS` in the environment lowers it, and exists for ONE reason: the durability
 * bench (`scripts/eval/durability`) has to see what happens past the wall, and waiting thirty real
 * minutes per scenario would price the answer out of ever being asked. Same shape as the token
 * ceiling right below — a bad value falls back to the derived one rather than silently removing the
 * budget. Never set it in production: a low budget cuts every turn short.
 */
const ENV_TURN_BUDGET_MS = Number(process.env.CHAT_TURN_BUDGET_MS);
export const CHAT_TURN_BUDGET_MS =
	Number.isFinite(ENV_TURN_BUDGET_MS) && ENV_TURN_BUDGET_MS > 0
		? ENV_TURN_BUDGET_MS
		: CHAT_MAX_DURATION_MS - POST_MODEL_RESERVE_MS;

/**
 * Hard stop: `stopWhen` is only evaluated BETWEEN steps, so one hanging tool call sails past the
 * soft budget. Aborts mid-step with room left to persist the stream. (Per-step: step-deadline.ts.)
 */
export const CHAT_TURN_ABORT_MS = CHAT_MAX_DURATION_MS - SALVAGE_RESERVE_MS;

/**
 * Turns on a long-lived worker have no platform wall, so this is a HANG DETECTOR, not a budget:
 * whatever reaches it is stuck, not busy. Raise it freely for a legitimate long workload.
 */
export const CHAT_WORKER_TURN_BUDGET_MS = 30 * 60_000;

/** Stamps `partial.at`. Ticks on a timer, not on stream events. */
export const CHAT_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * QUANTO PUO` METTERCI UN TURNO A PARTIRE.
 *
 * Il 26/8 un run e` rimasto `running` per sei minuti con ZERO caratteri, zero ragionamento,
 * `partial` mai scritto una volta e NESSUNA chiamata al modello: appeso dentro `startHarnessTurn`,
 * prima che esistesse uno stream. Il battito e` un timer e continuava a battere, quindi il reaper
 * lo credeva vivo e il FE diceva «sta generando» all'infinito.
 *
 * Aprire una sessione non e` inferenza: sono secondi. Un minuto e` gia` largo, e serve a
 * distinguere «lento» da «non partira` mai».
 */
export const HARNESS_START_TIMEOUT_MS = 60_000;

/** Letto a CHIAMATA, non a import: i test accorciano l'attesa senza toccare il default di deploy. */
export function harnessStartTimeoutMs(): number {
	const raw = Number(process.env.HARNESS_START_TIMEOUT_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : HARNESS_START_TIMEOUT_MS;
}

/**
 * QUANTO PUO` STARE ZITTO UN TURNO GIA` PARTITO — e perche` non sono dieci secondi.
 *
 * Il silenzio da solo non e` un guasto: un modello che ragiona su un prompt grosso non emette
 * nulla per un po', e un tool lungo (un render motion: dieci minuti, UNA chiamata) non emette
 * nulla per definizione. Il segnale vero e` il silenzio MENTRE NON si sta eseguendo un tool —
 * per questo il cane da guardia si mette in pausa quando un tool e` in volo.
 */
export const HARNESS_SILENCE_TIMEOUT_MS = 120_000;

/** Grazia dopo l'abort prima di chiudere FORZA la riga del run: se il trasporto ignora l'abortSignal, `consumeStream` non torna mai e il reaper troverebbe una riga `running` col battito fermo solo al congelamento dell'istanza. */
export const HARNESS_ABORT_FORCE_CLOSE_MS = 30_000;

/** Well above the heartbeat interval, so a slow UPDATE or a GC pause is never read as death. */
export const CHAT_HEARTBEAT_STALE_MS = 90_000;

/** No heartbeat was ever written — trust the row only until the physical wall has passed. */
export const CHAT_RUNNING_HARD_STALE_MS = CHAT_MAX_DURATION_MS + 60_000;

/**
 * A queued turn waits for the thread's current turn plus worker latency, so it must be derived
 * from the wall: a flat value would let a turn queued behind one full-length turn age out and be
 * reaped while it was only waiting. The extra is the worker latency the queue may add.
 */
export const CHAT_PENDING_STALE_MS = CHAT_MAX_DURATION_MS + 30 * 60_000;

/** Cheap DB prefilter for the reaper — nothing younger than this can be dead. */
export const CHAT_REAP_MIN_AGE_MS = 60_000;

/** Auto-continuation laps: each is a NEW invocation with its own full budget, not leftover
 * seconds. 9 = 1 initial turn + 9 background resumes. */
export const CHAT_MAX_CONTINUATIONS = 9;

export type ChatTurnDeadline = {
	/** `stopWhen` predicate. Evaluated between steps — never inside one. */
	reached: () => boolean;
	readonly expired: boolean;
	remainingMs: () => number;
};

/** Pair with `stepCountIs` in `stopWhen`: the turn ends on whichever limit hits first, and either
 * way through the normal finish path. */
export function chatTurnDeadline(startedAt: number, budgetMs: number = CHAT_TURN_BUDGET_MS): ChatTurnDeadline {
	let expired = false;
	return {
		reached: () => {
			if (Date.now() - startedAt >= budgetMs) expired = true;
			return expired;
		},
		get expired() {
			return expired;
		},
		remainingMs: () => Math.max(0, budgetMs - (Date.now() - startedAt))
	};
}

export type ChatJobDeathReason =
	/** Heartbeat went silent — the process died mid-turn. */
	| 'heartbeat'
	/** Never heartbeat at all and outlived the function wall. */
	| 'wall'
	/** Sat in the queue long past any plausible wait. */
	| 'orphaned_queue';

export type ChatJobLiveness = { dead: false } | { dead: true; reason: ChatJobDeathReason };

const ALIVE: ChatJobLiveness = { dead: false };

/**
 * Does a pending/running job still have a process behind it? Split by status on purpose: only the
 * heartbeat separates a live `running` turn from a dead one, and a `pending` turn is allowed to be
 * minutes old. One `created_at` threshold for both either hides dead turns or kills queued ones.
 */
export function classifyChatJob(
	job: {
		status?: string | null;
		created_at?: string | null;
		partial?: { at?: unknown } | null;
	},
	now: number = Date.now()
): ChatJobLiveness {
	const createdAt = job.created_at ? Date.parse(job.created_at) : NaN;
	const createdAge = Number.isFinite(createdAt) ? now - createdAt : 0;

	if (job.status === 'pending') {
		return createdAge > CHAT_PENDING_STALE_MS ? { dead: true, reason: 'orphaned_queue' } : ALIVE;
	}
	if (job.status !== 'running') return ALIVE;

	const beat = Number(job.partial?.at);
	if (Number.isFinite(beat) && beat > 0) {
		return now - beat > CHAT_HEARTBEAT_STALE_MS ? { dead: true, reason: 'heartbeat' } : ALIVE;
	}

	return createdAge > CHAT_RUNNING_HARD_STALE_MS ? { dead: true, reason: 'wall' } : ALIVE;
}

export const KIT_RUN_WORKING_STATES = ['queued', 'running', 'waiting_input', 'waiting_takeover'] as const;

/**
 * Lo stato in cui lo Stop dell'utente mette il run — dichiarato QUI, dove vive il resto del
 * vocabolario, perché era scritto in due posti che si sono scollati: `cancelKitRun` scriveva
 * `aborted` e `runKitTurn` cercava `stopped`, uno stato che nessuno ha mai scritto. Il turno
 * quindi non riconosceva mai il gesto come dell'utente: si fermava sì, ma solo al confine del
 * tool successivo (dentro un render motion sono minuti), raccontandosi «chiuso dal sistema», e
 * il ramo di chiusura prendeva la strada del turno finito bene.
 */
export const KIT_RUN_STOPPED_BY_USER = 'aborted';

export type KitRunLiveness = {
	state?: string | null;
	heartbeat_at?: string | null;
	created_at?: string | null;
};

export function classifyKitRun(run: KitRunLiveness, now: number = Date.now()): ChatJobLiveness {
  if (run.state === 'waiting_input' || run.state === 'waiting_takeover') return ALIVE;
  const working = run.state === 'queued' || run.state === 'running';
	const lastSignOfLife = run.heartbeat_at ?? run.created_at;
	return classifyChatJob(
		{
			status: working ? 'running' : null,
			created_at: run.created_at,
			partial: lastSignOfLife ? { at: Date.parse(lastSignOfLife) } : null
		},
		now
	);
}

export function kitRunIsAlive(run: KitRunLiveness, now?: number): boolean {
	return !classifyKitRun(run, now).dead;
}

export function turnTruncatedNotice(locale: string, willContinue: boolean): string {
	if (bilingualNoticeLocale(locale) === 'en') {
		return willContinue
			? '\n\n_Hit the time limit for a single turn. Everything above is done and saved — I am picking the rest back up in the background._'
			: '\n\n_Hit the time limit for a single turn. Everything above is done and saved, but the rest is still open — send "continue" and I will pick it back up._';
	}
	return willContinue
		? '\n\n_Ho raggiunto il limite di tempo del singolo turno. Tutto quello sopra è fatto e salvato — riprendo il resto in background._'
		: '\n\n_Ho raggiunto il limite di tempo del singolo turno. Tutto quello sopra è fatto e salvato, ma il resto è ancora da fare — scrivi "continua" e riparto da lì._';
}

/**
 * Distinct per reason so Sentry groups them apart. `chat_jobs` holds both the conversation turn
 * (`chat_response`) and the tool jobs it spawns, so the tool name goes in the text — a dead
 * `reanalyze_brand` reported as "a queued chat turn" sends you to the wrong subsystem.
 */
export function chatJobDeathMessage(reason: ChatJobDeathReason, toolName?: string | null): string {
	const what = toolName && toolName !== 'chat_response' ? `${toolName} tool job` : 'chat turn';
	if (reason === 'heartbeat') return `${what} died mid-flight (heartbeat lost)`;
	if (reason === 'wall') return `${what} exceeded the function wall with no result`;
	return `queued ${what} was never picked up by a worker`;
}

/** Sentry/PostHog bucket for a reaped job. Tool jobs are their own failure mode, not a queue bug. */
export function chatJobDeathKind(reason: ChatJobDeathReason, toolName?: string | null): string {
	if (toolName && toolName !== 'chat_response') return 'chat_tool_job_died';
	return reason === 'orphaned_queue' ? 'chat_queue_orphan' : 'chat_turn_died';
}

// Si sommano ingresso E uscita di ogni step, cioè i token FATTURATI: ogni step rimanda l'intera
// conversazione, quindi lo stesso testo si paga a ogni giro. Come ogni voce di `stopWhen` è
// consultato FRA gli step: non tappa un singolo step impazzito (per quello c'è `maxOutputTokens`,
// applicato in chat/model.ts, ma vale il massimo pubblicato del modello — fino a 384k).

/** Sopra il ~97° percentile dei turni veri (ai_calls, 21gg). `CHAT_TURN_TOKEN_BUDGET` lo cambia. */
export const DEFAULT_CHAT_TURN_TOKEN_BUDGET = 1_000_000;

/**
 * `0` spegne il tetto, ed è l'unico interruttore. Un valore assente o non numerico ricade sul
 * default: una variabile scritta male non deve togliere in silenzio il tetto che è lì per spendere
 * meno.
 */
export function resolveChatTokenBudget(raw?: string | null): number {
	if (raw == null || raw === '') return DEFAULT_CHAT_TURN_TOKEN_BUDGET;
	const n = Number(raw);
	return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CHAT_TURN_TOKEN_BUDGET;
}

export const DEFAULT_CHAT_MAX_TURNS = 75;
const MIN_CHAT_TURNS = 3;

const SUB_AGENT_ROLE_DEFAULT_STEPS = {
	research: 14,
	execute: 22,
	verify: 10,
	sandbox: 24,
	compose: 12
} as const;

export const SUB_AGENT_STEP_CEILING = 30;

export function chatMaxTurns(): number {
	const raw = Number(process.env.CHAT_MAX_TURNS);
	if (!Number.isFinite(raw) || raw < MIN_CHAT_TURNS) return DEFAULT_CHAT_MAX_TURNS;
	return raw;
}

export function chatSubAgentMaxTurns(role: SubagentRole, requested?: number): number {
	const tableSteps = Math.min(
		SUB_AGENT_STEP_CEILING,
		Math.max(MIN_CHAT_TURNS, requested ?? SUB_AGENT_ROLE_DEFAULT_STEPS[role])
	);
	const cap = Number(process.env.CHAT_SUB_AGENT_MAX_TURNS);
	if (!Number.isFinite(cap) || cap < MIN_CHAT_TURNS) return tableSteps;
	return Math.min(cap, Math.max(MIN_CHAT_TURNS, requested ?? cap));
}

type UsageStep = { usage?: { inputTokens?: number; outputTokens?: number } | null };

export type ChatTokenBudget = {
	/** `stopWhen` predicate. Consultato FRA gli step — vedi il caveat qui sopra. */
	reached: (opts: { steps: ReadonlyArray<UsageStep> }) => boolean;
	/** Latched dopo il primo `reached()` vero, così `onFinish` sa PERCHÉ il turno è finito. */
	readonly exceeded: boolean;
	readonly usedTokens: number;
	readonly budget: number;
};

export function chatTokenBudget(
	budget: number = resolveChatTokenBudget(process.env.CHAT_TURN_TOKEN_BUDGET)
): ChatTokenBudget {
	let exceeded = false;
	let used = 0;
	return {
		reached: ({ steps }) => {
			if (budget <= 0) return false;
			let n = 0;
			for (const s of steps ?? []) n += (s?.usage?.inputTokens ?? 0) + (s?.usage?.outputTokens ?? 0);
			used = n;
			if (n >= budget) exceeded = true;
			return exceeded;
		},
		get exceeded() {
			return exceeded;
		},
		get usedTokens() {
			return used;
		},
		get budget() {
			return budget;
		}
	};
}

function millions(tokens: number): string {
	return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/** NON promette una ripresa: riprendere un turno fermato per costo raddoppia quel costo. */
export function turnTokenBudgetNotice(locale: string, usedTokens: number, budget: number): string {
	if (bilingualNoticeLocale(locale) === 'en') {
		return `\n\n_Stopped — this turn burned ${millions(usedTokens)} tokens, past its ${millions(budget)} budget. Everything above is done and saved; the rest is still open. Tell me which part to pick up and I will start a fresh turn on that alone._`;
	}
	return `\n\n_Mi fermo — questo turno ha bruciato ${millions(usedTokens)} token, oltre il suo budget di ${millions(budget)}. Tutto quello sopra è fatto e salvato; il resto è ancora aperto. Dimmi quale pezzo riprendere e riparto da lì con un turno nuovo._`;
}
