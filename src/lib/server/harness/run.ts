import { generateText, streamText } from 'ai';
import { createHarnessSession, type HarnessMeta, type HarnessSession } from './session';
import { wrapTools, type ToolPipeline } from './pipeline';
import { persistHarnessSession } from './persist';
import {
	applyStewardPrepareStep,
	createSessionSteward,
	mergePipelines
} from './steward';
import { isHeavyProductionAsk } from '$lib/server/chat/model';
import { controllerPipeline } from '$lib/server/chat/controller';

/**
 * Shared agent-loop driver. Spreads every option through to the AI SDK so stopWhen, budgets,
 * prepareStep, abortSignal, providerOptions, and existing onStepFinish/onFinish stay intact.
 * The only additions: model-visible logging, the session steward, and optional tool pipeline hooks.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyOpts = Record<string, any>;

/**
 * PRIMO STEP DI UNA RICHIESTA DI PRODUZIONE: UNO STRUMENTO, NON UN PARAGRAFO.
 *
 * Misurato il 2026-08-22 su `chat_messages`, contando SOLO i turni che rispondono a una richiesta
 * di produzione: il **28.6%** dei turni su grok-4-6 finisce con ZERO chiamate a strumento (su
 * gpt-5-6-luna: 0%). La mediana è la stessa (6 chiamate): quello che è comparso è una coda, un
 * turno su quattro che legge il brief e poi chiude a parole — «dimmi quale tema» — lasciando il
 * lavoro non fatto.
 *
 * Il vincolo sta nell'SDK e non in una riga di prompt, perché una riga di prompt è un consiglio:
 * al primo step `toolChoice: 'required'`. Ed è vincolato due volte, perché forzare uno strumento
 * dove non serve è peggio del difetto che ripara:
 *   · solo la chat (`surface: 'chat'`) — gli agenti di batch hanno i loro gate;
 *   · solo se il messaggio è una richiesta di PRODUZIONE, secondo `isHeavyProductionAsk` — lo
 *     stesso classificatore deterministico (regex it/en, zero chiamate modello) che decide la
 *     scalata Auto→Pro. Una domanda («cos'è un gatto», «come va il brand?») resta libera di essere
 *     risposta e basta: è il TRIAGE di WORK_ETHIC_BLOCK, e forzarle una chiamata produrrebbe un
 *     turno assurdo.
 *
 * `ask_user_questions` è tolto dallo step forzato: è in `stopWhen`, quindi chiuderebbe il turno —
 * sarebbe l'unico modo di obbedire al `required` senza fare niente, cioè il difetto con un'altra
 * faccia. Se dopo il filtro non resta nessun strumento non si forza niente: un `required` senza
 * candidati è un 400 del provider, non una correzione.
 */
const FORCED_STEP_EXCLUDE = new Set(['ask_user_questions']);

/**
 * CHI ACCETTA UN `tool_choice` DIVERSO DA `auto`. Un elenco solo, accanto alla regola che lo usa.
 *
 * Non e` universale: `z-ai/glm-5.3-flash` su openrouter risponde 400 «Tool choice must be auto» e
 * il turno muore PRIMA del primo step — tre motion di fila il 26/8, ognuno morto in un secondo.
 *
 * L'elenco dice chi lo SUPPORTA e non chi lo rifiuta, perche` i due sbagli non costano uguale:
 * non forzare lascia un turno che risponde a parole invece di lavorare — brutto, recuperabile,
 * e l'utente puo` insistere; forzare dove non si puo` uccide il turno intero. Un modello nuovo
 * deve perdere una protezione, non non partire.
 *
 * `grok` e` l'unico su cui il difetto sia stato misurato (28.6% sopra), ed e` per lui che questo
 * meccanismo esiste. Aggiungere una voce vuole la stessa cosa: una misura, non un'impressione.
 */
const FORCED_TOOL_CHOICE_MODELS = [/grok/i];

function acceptsForcedToolChoice(model: string | null | undefined): boolean {
	const id = model?.trim();
	if (!id) return false;
	return FORCED_TOOL_CHOICE_MODELS.some((re) => re.test(id));
}

/** Testo dell'ultimo messaggio utente — l'unico input del classificatore. */
function lastUserText(messages: unknown): string {
	if (!Array.isArray(messages)) return '';
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: string; content?: unknown } | undefined;
		if (m?.role !== 'user') continue;
		if (typeof m.content === 'string') return m.content;
		if (Array.isArray(m.content)) {
			return (m.content as Array<{ type?: string; text?: string }>)
				.map((part) => (part?.type === 'text' ? (part.text ?? '') : ''))
				.join(' ');
		}
		return '';
	}
	return '';
}

/** I tool ammessi al primo step forzato, o `[]` quando questo turno non va forzato affatto. */
export function forcedFirstStepTools(
	meta: { surface?: string; model?: string | null },
	messages: unknown,
	toolNames: string[]
): string[] {
	if (meta.surface !== 'chat') return [];
	if (!acceptsForcedToolChoice(meta.model)) return [];
	if (!isHeavyProductionAsk(lastUserText(messages))) return [];
	return toolNames.filter((n) => !FORCED_STEP_EXCLUDE.has(n));
}

export function attachHarness<T extends AnyOpts>(
	session: HarnessSession,
	options: T,
	pipeline?: ToolPipeline
): T {
	session.captureRequest(options);
	const origPrepare = options.prepareStep;
	const origStep = options.onStepFinish;
	const origFinish = options.onFinish;
	const origError = options.onError;
	const origAbort = options.onAbort;
	const origSystem = typeof options.system === 'string' ? options.system : '';
	const toolNames = options.tools && typeof options.tools === 'object' ? Object.keys(options.tools) : [];
	const stewardEnabled = session.meta.steward !== false;
	const steward = stewardEnabled ? createSessionSteward(session, toolNames) : null;
	const merged = mergePipelines(
		steward?.pipeline(),
		mergePipelines(controllerPipeline(session), pipeline)
	);

	const next: AnyOpts = {
		...options,
		allowSystemInMessages: (options as { allowSystemInMessages?: boolean }).allowSystemInMessages ?? true,
		tools: wrapTools(session, options.tools, merged)
	};

	// Vedi FORCED_STEP_EXCLUDE: vuoto = questo turno non forza niente. Un `toolChoice` deciso dal
	// chiamante è una scelta, non un default da correggere: in quel caso non si tocca nulla.
	const forcedTools =
		options.toolChoice == null ? forcedFirstStepTools(session.meta, options.messages, toolNames) : [];

	const runPrepare = (prepared: unknown, stepNumber: number) => {
		const patched = steward
			? applyStewardPrepareStep(session, steward, prepared as Record<string, unknown>, origSystem)
			: prepared;
		const out = (patched ?? {}) as Record<string, unknown>;
		// Solo il primo step, e mai sopra una scelta che il chiamante ha già fatto.
		const forced =
			forcedTools.length && stepNumber === 0 && out.toolChoice == null
				? { ...out, toolChoice: 'required', activeTools: out.activeTools ?? forcedTools }
				: out;
		session.capturePrepareStep(forced);
		return forced;
	};

	if (typeof origPrepare === 'function' || steward || forcedTools.length) {
		next.prepareStep = (args: { stepNumber?: number }) => {
			const step = args?.stepNumber ?? 0;
			if (typeof origPrepare !== 'function') return runPrepare({}, step);
			const prepared = origPrepare(args);
			if (prepared && typeof prepared.then === 'function') {
				return prepared.then((p: unknown) => runPrepare(p, step));
			}
			return runPrepare(prepared, step);
		};
	}

	next.onStepFinish = async (event: {
		text?: string;
		toolCalls?: Array<{ toolName?: string }>;
		usage?: unknown;
	}) => {
		session.recordStep(event);
		await origStep?.(event);
	};

	if (typeof origFinish === 'function') {
		next.onFinish = async (event: { text?: string; totalUsage?: unknown; usage?: unknown }) => {
			if (event?.text) session.recordAssistantText(event.text);
			session.recordUsage(event?.totalUsage ?? event?.usage);
			session.finish('finished');
			persistHarnessSession(session);
			await origFinish(event);
		};
	}

	if (typeof origError === 'function') {
		next.onError = async (event: { error?: unknown }) => {
			session.finish('failed', event?.error);
			persistHarnessSession(session);
			await origError(event);
		};
	}

	if (typeof origAbort === 'function') {
		next.onAbort = async (...args: unknown[]) => {
			session.finish('aborted');
			persistHarnessSession(session);
			await origAbort(...args);
		};
	}

	return next as T;
}

type GenerateLike = {
	text: string;
	totalUsage?: unknown;
	usage?: unknown;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	steps?: any[];
	response?: { messages?: unknown };
};

export async function harnessGenerateText<T = GenerateLike>(
	meta: HarnessMeta,
	options: AnyOpts,
	pipeline?: ToolPipeline
): Promise<T> {
	const session = createHarnessSession(meta);
	try {
		const result = (await generateText(attachHarness(session, options, pipeline))) as T & GenerateLike;
		session.recordAssistantText(result?.text);
		session.recordUsage(result?.totalUsage ?? result?.usage);
		session.finish('finished');
		return result as T;
	} catch (e) {
		session.finish('failed', e);
		throw e;
	} finally {
		persistHarnessSession(session);
	}
}

export function harnessStreamText(
	meta: HarnessMeta,
	options: AnyOpts,
	pipeline?: ToolPipeline
): ReturnType<typeof streamText> {
	const session = createHarnessSession(meta);
	const instrumented = attachHarness(session, options, pipeline);

	if (typeof options.onFinish !== 'function') {
		instrumented.onFinish = async (event: { text?: string; totalUsage?: unknown; usage?: unknown }) => {
			if (event?.text) session.recordAssistantText(event.text);
			session.recordUsage(event?.totalUsage ?? event?.usage);
			session.finish('finished');
			persistHarnessSession(session);
		};
	}
	if (typeof options.onError !== 'function') {
		instrumented.onError = async (event: { error?: unknown }) => {
			session.finish('failed', event?.error);
			persistHarnessSession(session);
		};
	}
	if (typeof options.onAbort !== 'function') {
		instrumented.onAbort = async () => {
			session.finish('aborted');
			persistHarnessSession(session);
		};
	}

	// Snapshot the request immediately so a killed stream still leaves system + messages.
	persistHarnessSession(session);
	return streamText(instrumented);
}

/** One-shot (no tool loop) that still records the exact system/prompt/answer the model saw. */
export async function harnessVisibleTurn<T>(
	meta: HarnessMeta,
	input: { system?: string; prompt?: string; messages?: unknown },
	fn: () => Promise<T>,
	readText: (result: T) => string | undefined = (r) =>
		r && typeof r === 'object' && 'text' in r ? String((r as { text?: unknown }).text ?? '') : String(r)
): Promise<T> {
	const session = createHarnessSession(meta);
	session.captureRequest(input);
	try {
		const result = await fn();
		session.recordAssistantText(readText(result));
		if (result && typeof result === 'object' && 'usage' in (result as object)) {
			session.recordUsage((result as { usage?: unknown }).usage);
		}
		if (result && typeof result === 'object' && 'totalUsage' in (result as object)) {
			session.recordUsage((result as { totalUsage?: unknown }).totalUsage);
		}
		session.finish('finished');
		return result;
	} catch (e) {
		session.finish('failed', e);
		throw e;
	} finally {
		persistHarnessSession(session);
	}
}
