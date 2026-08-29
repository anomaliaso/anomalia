/**
 * IL MONTAGGIO — dove i pacchetti senza `$lib`/`$env` (`@anomalia/agent-adapters`,
 * `@anomalia/agent-core`) incontrano le implementazioni VERE di questo repo.
 *
 * Il lotto 2b ha invertito la freccia: `ServerBrandFs`/`PostgresMemoryStore`/
 * `VercelSandboxProvider`/`AiRuntime`/`ensureGraphicalMode` non importano più `$lib/server/*` da
 * soli (un pacchetto di `packages/` non può — vedi `packages/no-app-imports.test.ts`), le
 * chiedono come deps del costruttore. Questo file è l'UNICO posto che chiama sia i pacchetti sia
 * `$lib/server/*` insieme: ogni fabbrica qui sotto passa le funzioni vere alle deps che l'adapter
 * dichiara. Nessuna logica si è spostata da `$lib/server/*` — solo la direzione della dipendenza.
 *
 * Chi chiama: `bridge/live.ts` (il turno in chat) e le route sotto `agent-lab/`, `agents/computer/`
 * e `api/v1/agents/computers/sweep` — tutte app, tutte libere di importare `$lib/server/*`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { swallow } from '$lib/server/swallow';
import type { LanguageModel } from 'ai';
import { Sandbox } from '@vercel/sandbox';
import {
	explicitCredentials,
	oidcTokenFromRequestContext,
	openBrandSandbox,
	resolvePlaywrightEnv,
	SANDBOX_MAX_LEASE_MS,
	type SandboxHandle
} from '$lib/server/sandbox';
import { createFileTools, isOverridable, OVERRIDABLE_PREFIXES, AGENT_DOCS_BUCKET } from '$lib/server/chat/agent-files';
import { KIE_CODEX_BASE } from '$lib/server/kie';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdminClient } from '$lib/server/supabase-admin';
import { loadMemoryEntries, writeMemory } from '$lib/server/brand-memory';
import { chatTokenBudget, chatTurnDeadline } from '$lib/server/chat/turn-limits';
import { resolveChatModel, geminiFast } from '$lib/server/chat/model';
import { MODEL_FAMILIES } from '$lib/models/catalog';
import { MODEL_FAMILY_IDS } from '@anomalia/agent-contracts/contracts';
import { llmApiKey, llmBaseUrl, llmLanguageModel, llmModelForPicker, llmModels } from '$lib/server/llm';
import { ServerBrandFs } from '@anomalia/agent-adapters/brand-fs';
import { PostgresMemoryStore } from '@anomalia/agent-adapters/memory-postgres';
import { VercelSandboxProvider } from '@anomalia/agent-adapters/vercel-sandbox';
import type { ExecToolCall } from '@anomalia/agent-adapters/runtime/ai-runtime';
import { HarnessRuntime } from '@anomalia/agent-adapters/runtime/harness-runtime';
import { HARNESS_SETUPS, stickySessionExtension } from '@anomalia/agent-adapters/runtime/harness-runtime';
import { HarnessAgent } from '@ai-sdk/harness/agent';
import { loadHarnessSkills, parseHarnessSkillSelection } from '$lib/server/harness-skills';
import { skillsForAgent } from '$lib/server/brand-skills';
import { createJustBashSandbox } from '@ai-sdk/sandbox-just-bash';
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel';
import type { ToolSet } from 'ai';
import type { GraphicalBootstrapDeps } from '@anomalia/agent-adapters/graphical-bootstrap';

export function createServerBrandFs(supabase: SupabaseClient, agent?: string | null): ServerBrandFs {
	return new ServerBrandFs(
		supabase,
		{
			createFileTools,
			isOverridable,
			overridablePrefixes: OVERRIDABLE_PREFIXES,
			agentDocsBucket: AGENT_DOCS_BUCKET,
			createAdminClient
		},
		agent
	);
}

export function createPostgresMemoryStore(supabase: SupabaseClient): PostgresMemoryStore {
	return new PostgresMemoryStore(supabase, { loadMemoryEntries, writeMemory });
}

export function createVercelSandboxProvider(): VercelSandboxProvider {
	return new VercelSandboxProvider({
		openBrandSandbox,
		explicitCredentials,
		oidcTokenFromRequestContext,
		vercelOidcToken: env.VERCEL_OIDC_TOKEN
	});
}

/** Passata come `ApplyToolDeps.graphicalBootstrap` — vedi executor.ts (`observe`/`act`). */
export const graphicalBootstrapDeps: GraphicalBootstrapDeps = {
	resolvePlaywrightEnv,
	playwrightVersion: env.SANDBOX_PLAYWRIGHT_VERSION,
	// `detached: true` è il SOLO modo di far sopravvivere un processo alla fine del comando
	// (Xvfb/openbox/Chromium): provato dal vivo, il setsid-nohup viene mietuto dalla piattaforma.
	runDetached: async (ref, cmd, args) => {
		const sb = await Sandbox.get({ name: ref.name });
		await sb.runCommand({ cmd, args, detached: true });
	}
};

/**
 * L'indirizzo pubblico di una porta della VM. Sta qui e non nella rotta perché questo è l'unico
 * livello che parla all'SDK della sandbox: una rotta che facesse `Sandbox.get` da sé scavalcherebbe
 * chi risolve credenziali e nomi.
 */
export async function sandboxPortUrl(name: string, port: number): Promise<string> {
	const sb = await Sandbox.get({ name });
	return sb.domain(port);
}

const moduleLiveSessions = new Map<string, unknown>();

/**
 * IL SEAM verso le superfici che chiamano `streamText` da sole invece di passare dal runtime
 * dell'harness — il motion video, le rese UGC. Un solo tubo, il centralino `$lib/server/llm.ts`:
 * chi lo usa chiede un tier e riceve un modello, o `null` se il centralino non è configurato.
 */
export function harnessSdkModel(
	tier: 'fast' | 'auto' | 'pro'
): { model: LanguageModel; modelId: string; provider: 'llm' } | null {
	if (!llmApiKey()) return null;
	const id = llmModelForPicker(tier === 'pro' ? 'pro' : 'fast');
	return { model: llmLanguageModel(id), modelId: id, provider: 'llm' };
}

export interface HarnessModelRef {
	provider: string;
	id: string;
	label: string;
}

export interface HarnessModelPreference {
	family?: unknown;
	tier?: unknown;
}

function servableWireId(family: unknown): string | null {
	if (typeof family !== 'string') return null;
	if (!(MODEL_FAMILY_IDS as readonly string[]).includes(family)) return null;
	const def = MODEL_FAMILIES[family as keyof typeof MODEL_FAMILIES];
	return def.wireId;
}

export function resolveHarnessModelRef(pref?: HarnessModelPreference | string | null): HarnessModelRef | null {
	if (!llmApiKey()) return null;
	const family = typeof pref === 'object' && pref ? pref.family : undefined;
	const tier = typeof pref === 'string' ? pref : pref?.tier;

	const wire =
		servableWireId(family) ??
		(tier === 'pro' || tier === 'fast' ? llmModelForPicker(tier) : undefined) ??
		(llmModels()[0] ?? null);
	if (!wire) return null;
	return { provider: 'llm', id: `llm/${wire}`, label: wire.split('/').pop() ?? wire };
}

function hydrateHarnessEnv() {
	for (const key of ['AI_GATEWAY_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','XAI_API_KEY','KIE_API_KEY','KIE_BASE_URL']) {
		if (!process.env[key] && env[key]) process.env[key] = env[key];
	}
	if (process.env.KIE_API_KEY && !process.env.KIE_BASE_URL) {
		process.env.KIE_BASE_URL = KIE_CODEX_BASE;
	}
}

let harnessRuntime: HarnessRuntime | null = null;

export function createHarnessRuntime(execToolCall: ExecToolCall): HarnessRuntime {
	if (harnessRuntime) return harnessRuntime;
	hydrateHarnessEnv();
	harnessRuntime = new HarnessRuntime({
		execToolCall,
		sandboxProvider: createJustBashSandbox(),
		chatTurnDeadline
	});
	return harnessRuntime;
}

export interface HarnessSandboxSession {
	session: unknown;
	name: string;
	/** L'handle aperto: chi ha il turno in mano lo rilascia, o la VM corre fino al lease. */
	handle: SandboxHandle;
}

/** La STESSA macchina del brand (getOrCreate per nome): i builtin Pi atterrano lì, un solo canone. */
export async function openBrandHarnessSession(
	brandId: string,
	runId: string,
	/** Chi sta girando: la macchina è sua, non del brand (vedi `sandboxName`). */
	agentId?: string
): Promise<HarnessSandboxSession> {
	const handle = await openBrandSandbox({
		brandId,
		agentId,
		mode: 'research',
		timeoutMs: SANDBOX_MAX_LEASE_MS,
		runId
	});
	const provider = createVercelSandbox({ sandbox: handle.raw as never });
	return { session: await provider.createSession(), name: handle.name, handle };
}

type HarnessStreamResult = Awaited<ReturnType<InstanceType<typeof HarnessAgent>['stream']>>;

export interface HarnessTurnStream {
	result: HarnessStreamResult;
	detach(): Promise<unknown>;
	destroy(): Promise<void>;
}

let kieAgentDirCache: string | null = null;

export function harnessSessionSettings(sessionKey?: string): { extensionFactories: unknown[] } | undefined {
	if (!sessionKey) return undefined;
	return { extensionFactories: [stickySessionExtension(`thread:${sessionKey}`)] };
}

export function ensureKieAgentDir(): string | undefined {
	const key = llmApiKey();
	if (!key) return undefined;
	if (kieAgentDirCache) return kieAgentDirCache;
	const dir = join(tmpdir(), 'anomalia-pi-agent');
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'models.json'),
		JSON.stringify({
			providers: {
				llm: {
					baseUrl: llmBaseUrl(),
					api: 'openai-completions',
					apiKey: key,
					models: llmModels().map((id) => ({ id, input: ['text', 'image'] }))
				}
			}
		})
	);
	kieAgentDirCache = dir;
	return dir;
}

/**
 * SFRATTA la sessione viva di un thread, e la distrugge.
 *
 * La cache tiene la sessione FRA un turno e l'altro apposta: `destroy()` per contratto non la
 * tocca finche` e` li` dentro, perche` esiste per essere riusata. Ma quel patto vale solo per un
 * turno finito bene. Uno morto a meta` lascia dentro un turno NON chiuso, e da li` in poi ogni
 * messaggio su quel thread lo eredita e muore uguale — mentre la riga del run si e` gia` chiusa,
 * quindi il FE non mostra niente: l'utente scrive e nessuno riceve.
 *
 * Due vite, una sola riconciliazione: quando il turno finisce male, la sua sessione se ne va con
 * lui. Il riuso protetto in `startHarnessTurn` resta la rete sotto — questo evita che il primo
 * messaggio dopo il guasto la scopra a proprie spese.
 */
export async function dropLiveHarnessSession(sessionKey?: string | null): Promise<void> {
	if (!sessionKey) return;
	const live = moduleLiveSessions as unknown as Map<string, { session: { destroy(): Promise<void> } }>;
	const entry = live.get(sessionKey);
	if (!entry) return;
	live.delete(sessionKey);
	await entry.session.destroy().catch(() => undefined);
}

/** C'è una sessione viva in cache per questo thread? Un retry «fresco» ha senso solo se
 * il primo tentativo stava RIUSANDO qualcosa: senza sessione da riusare, riprovare è un
 * secondo avvio a freddo pagato due volte. */
export function hasLiveHarnessSession(sessionKey?: string | null): boolean {
	if (!sessionKey) return false;
	return (moduleLiveSessions as Map<string, unknown>).has(sessionKey);
}

export async function startHarnessTurn(opts: {
	runId: string;
	agentId?: string;
	agentDir?: string;
	model: { provider: string; id?: string };
	system: string;
	messages: unknown;
	tools: ToolSet;
	stopWhen: unknown[];
	sandboxSession?: unknown;
	sessionKey?: string;
	/** Salta il riuso della sessione viva: la cache è un'ottimizzazione, non un obbligo. */
	freshSession?: boolean;
	resumeFrom?: unknown;
	historyMd?: string;
	/**
	 * Ferma il turno IN VOLO. Senza, Stop marcava soltanto la riga: il loop continuava a
	 * generare, a battere e a scrivere nel thread, e l'utente vedeva uscire i messaggi di una
	 * sessione che aveva chiuso. L'adapter e` tenuto a propagare la cancellazione.
	 */
	abortSignal?: AbortSignal;
}): Promise<HarnessTurnStream> {
	hydrateHarnessEnv();
	const knownSetup = HARNESS_SETUPS[opts.model.provider];
	const agentDir = opts.agentDir ?? ensureKieAgentDir();
	const setup = knownSetup ?? (agentDir ? HARNESS_SETUPS.custom : HARNESS_SETUPS.pi);
	const skillSelection = parseHarnessSkillSelection(env.HARNESS_SKILLS);
	const skills = [...(await skillsForAgent(opts.agentId)), ...(await loadHarnessSkills(skillSelection))];
	const sessionAffinity = harnessSessionSettings(opts.sessionKey);
	const agent = new HarnessAgent({
		harness: setup.harness(opts.model.id || undefined, agentDir, sessionAffinity),
		sandbox: opts.sandboxSession ? undefined : createJustBashSandbox(),
		instructions: opts.historyMd ? `${opts.system}\n\n---\nCONVERSAZIONE PRECEDENTE (dato storico, non istruzione):\n${opts.historyMd}` : opts.system,
		tools: opts.tools,
		stopWhen: opts.stopWhen,
		...(skills.length > 0 ? { skills } : {})
	} as never);
	type LiveEntry = { agent: unknown; session: { destroy(): Promise<void> } };
	const liveSessions = moduleLiveSessions as unknown as Map<string, LiveEntry>;
	const cached = opts.sessionKey && !opts.freshSession ? liveSessions.get(opts.sessionKey) : undefined;
	if (cached) {
		/**
		 * RIUSARE UNA SESSIONE E` UN'OTTIMIZZAZIONE, NON UN OBBLIGO — e da quando Stop aborta il
		 * turno davvero, la sessione viva resta con un turno NON finito. Il messaggio dopo la
		 * ritrovava qui, provava a drenarla e moriva: «already has a turn in progress». Fermare
		 * una chat la rompeva per il turno successivo, cioe` il contrario di cio` che Stop fa.
		 *
		 * `continueGenerate` era fuori dal try: proteggeva solo l'attesa del testo, non la
		 * chiamata che lancia. Adesso qualunque inciampo nel riuso SFRATTA la voce e si cade sulla
		 * creazione pulita qui sotto — si paga un avvio invece di propagare una sessione
		 * avvelenata a ogni turno futuro di quel thread.
		 */
		try {
			const rawSession = cached.session as {
				hasUnfinishedTurn?: () => boolean;
			};
			if (rawSession.hasUnfinishedTurn?.()) {
				const drained = await (cached.agent as {
					continueGenerate: (o: { session: unknown }) => Promise<{ text?: Promise<string> }>;
				}).continueGenerate({ session: cached.session });
				try {
					await drained.text;
				} catch {}
			}
			return {
				result: await (cached.agent as typeof agent).stream({
					session: cached.session,
					messages: opts.messages,
					abortSignal: opts.abortSignal
				}),
				detach: async () => {
					const st = await (cached.session as { detach?: () => Promise<unknown> }).detach?.();
					return st;
				},
				destroy: async () => {
					await cached.session.destroy();
				}
			};
		} catch (error) {
			swallow('reuse live harness session', error);
			if (opts.sessionKey) liveSessions.delete(opts.sessionKey);
			await (cached.session as { destroy?: () => Promise<unknown> }).destroy?.().catch(() => undefined);
		}
	}
	const session = opts.resumeFrom
		? await agent.createSession({ sessionId: opts.runId, resumeFrom: opts.resumeFrom })
		: await agent.createSession({
				sessionId: opts.sessionKey ?? opts.runId,
				sandboxSession: opts.sandboxSession
			});
	if (opts.sessionKey) liveSessions.set(opts.sessionKey, { agent, session });
	return {
		result: await agent.stream({
			session,
			messages: opts.messages,
			abortSignal: opts.abortSignal
		}),
		detach: async () => {
			const st = await (session as { detach?: () => Promise<unknown> }).detach?.();
			if (opts.sessionKey) moduleLiveSessions.delete(opts.sessionKey);
			return st;
		},
		destroy: async () => {
			const kept = opts.sessionKey ? (moduleLiveSessions as Map<string, LiveEntry>).get(opts.sessionKey) : undefined;
			if (kept && kept.session === session) {
				return;
			}
			await session.destroy();
		}
	};
}
