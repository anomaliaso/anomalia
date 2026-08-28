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
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { Sandbox } from '@vercel/sandbox';
import {
	explicitCredentials,
	oidcTokenFromRequestContext,
	openBrandSandbox,
	resolvePlaywrightEnv,
	SANDBOX_MAX_LEASE_MS
} from '$lib/server/sandbox';
import { createFileTools, isOverridable, OVERRIDABLE_PREFIXES, AGENT_DOCS_BUCKET } from '$lib/server/chat/agent-files';
import { KIE_CODEX_BASE, KIE_LUNA_MODEL } from '$lib/server/kie';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdminClient } from '$lib/server/supabase-admin';
import { loadMemoryEntries, writeMemory } from '$lib/server/brand-memory';
import { chatTokenBudget, chatTurnDeadline } from '$lib/server/chat/turn-limits';
import { resolveChatModel, geminiFast } from '$lib/server/chat/model';
import { MODEL_FAMILIES, TIER_DEFAULT_FAMILY } from '$lib/models/catalog';
import { MODEL_FAMILY_IDS } from '@anomalia/agent-contracts/contracts';
import { XIAOMI_MODEL } from '$lib/server/xiaomi';
import { ServerBrandFs } from '@anomalia/agent-adapters/brand-fs';
import { PostgresMemoryStore } from '@anomalia/agent-adapters/memory-postgres';
import { VercelSandboxProvider } from '@anomalia/agent-adapters/vercel-sandbox';
import { createModelResolver } from '@anomalia/agent-adapters/runtime/models';
import type { ExecToolCall } from '@anomalia/agent-adapters/runtime/ai-runtime';
import { HarnessRuntime } from '@anomalia/agent-adapters/runtime/harness-runtime';
import { HARNESS_SETUPS, stickySessionExtension } from '@anomalia/agent-adapters/runtime/harness-runtime';
import { HarnessAgent } from '@ai-sdk/harness/agent';
import { loadHarnessSkills, parseHarnessSkillSelection } from '$lib/server/harness-skills';
import { brandSkills } from '$lib/server/brand-skills';
import { createJustBashSandbox } from '@ai-sdk/sandbox-just-bash';
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel';
import type { StreamTextResult, ToolSet } from 'ai';
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

export interface HarnessModelRef {
	provider: string;
	id: string;
	label: string;
}

const moduleLiveSessions = new Map<string, unknown>();

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const OPENCODE_DEFAULT_BASE = 'https://opencode.ai/zen/v1';

type HarnessProviderName = 'kie' | 'openrouter' | 'opencode';

function providerConfigured(name: HarnessProviderName): boolean {
	if (name === 'kie') return Boolean(env.KIE_API_KEY);
	if (name === 'openrouter') return Boolean(env.OPENROUTER_API_KEY);
	return Boolean(env.OPENCODE_API_KEY);
}

function providerBaseUrl(name: HarnessProviderName): string {
	if (name === 'kie') return env.KIE_BASE_URL || KIE_CODEX_BASE;
	if (name === 'openrouter') return env.OPENROUTER_BASE_URL || OPENROUTER_BASE;
	return env.OPENCODE_BASE_URL || OPENCODE_DEFAULT_BASE;
}

function providerApiKey(name: HarnessProviderName): string | undefined {
	if (name === 'kie') return env.KIE_API_KEY;
	if (name === 'openrouter') return env.OPENROUTER_API_KEY;
	return env.OPENCODE_API_KEY;
}

/** Ordine di caduta: HARNESS_PROVIDER esplicito, poi kie, openrouter, opencode. */
function activeProvider(): HarnessProviderName | null {
	const forced = (env.CHAT_PROVIDER || env.HARNESS_PROVIDER) as HarnessProviderName | undefined;
	if (forced && providerConfigured(forced)) return forced;
	const order: HarnessProviderName[] = ['kie', 'openrouter', 'opencode'];
	return order.find(providerConfigured) ?? null;
}

function modelForTier(tier: string | undefined, name: HarnessProviderName): string | null {
	const prefix = name === 'kie' ? '' : name.toUpperCase() + '_';
	const byTier = tier === 'fast' || tier === 'pro' ? `${prefix}${tier.toUpperCase()}_MODEL` : `${prefix}AUTO_MODEL`;
	const fromEnv = env[byTier] as string | undefined;
	if (fromEnv) return fromEnv;
	const generic = env[`HARNESS_MODEL_${(tier ?? 'auto').toUpperCase()}`] as string | undefined;
	return generic || null;
}

/**
 * IL SEAM verso le superfici che chiamano `streamText` da sole invece di passare dal runtime
 * dell'harness — il motion video, che finora costruiva `google(geminiFlash())` a mano.
 *
 * Sta QUI e non da loro perche' la conoscenza del provider — base url, chiave, quale variabile
 * porta quale tier — e' gia' tutta in questo file: un secondo posto che la ricopia diverge al
 * primo provider aggiunto. Chi lo usa chiede un tier e riceve un modello, o `null` se non c'e'
 * nessun provider configurato: cadere in silenzio su un provider cablato e' come si finisce con
 * meta` del prodotto su un modello che nessuno ha scelto.
 *
 * I provider dell'harness sono tutti compatibili OpenAI, quindi il client e' uno solo.
 */
export function harnessSdkModel(
	tier: 'fast' | 'auto' | 'pro'
): { model: LanguageModel; modelId: string; provider: HarnessProviderName } | null {
	const name = activeProvider();
	if (!name) return null;
	const wire = modelForTier(tier, name) ?? firstListModel(name);
	if (!wire) return null;
	const client = createOpenAI({ baseURL: providerBaseUrl(name), apiKey: providerApiKey(name), name });
	return { model: client.chat(wire), modelId: wire, provider: name };
}

function firstListModel(name: HarnessProviderName): string | null {
	const raw = env[`${name.toUpperCase()}_MODELS`] as string | undefined;
	const first = raw?.split(',').map((x) => x.trim()).filter(Boolean)[0];
	return first || null;
}

/** Lista modelli dichiarati per un provider (OPENROUTER_MODELS ecc.), con caduta sul modello auto. */
function providerModels(name: HarnessProviderName): Array<{ id: string }> {
	const listKey = `${name.toUpperCase()}_MODELS`;
	const raw = env[listKey] as string | undefined;
	const list = raw ? raw.split(',').map((x) => x.trim()).filter(Boolean) : [];
	const auto = modelForTier('auto', name);
	if (auto && !list.includes(auto)) list.push(auto);
	return list.map((id) => ({ id }));
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

function servableWireId(family: unknown, name: HarnessProviderName): string | null {
	if (typeof family !== 'string') return null;
	if (!(MODEL_FAMILY_IDS as readonly string[]).includes(family)) return null;
	const def = MODEL_FAMILIES[family as keyof typeof MODEL_FAMILIES];
	return def.provider === name ? def.wireId : null;
}

function tierDefaultFamily(tier: unknown): unknown {
	if (typeof tier !== 'string' || !(tier in TIER_DEFAULT_FAMILY)) return null;
	return TIER_DEFAULT_FAMILY[tier as keyof typeof TIER_DEFAULT_FAMILY];
}

export function resolveHarnessModelRef(pref?: HarnessModelPreference | string | null): HarnessModelRef | null {
	const name = activeProvider();
	if (!name) return null;
	const family = typeof pref === 'object' && pref ? pref.family : undefined;
	const tier = typeof pref === 'string' ? pref : pref?.tier;

	const wire =
		servableWireId(family, name) ??
		modelForTier(tier, name) ??
		servableWireId(tierDefaultFamily(tier), name) ??
		(name === 'kie' ? KIE_LUNA_MODEL : null) ??
		firstListModel(name);
	if (!wire) return null;
	return { provider: name, id: `${name}/${wire}`, label: wire.split('/').pop() ?? wire };
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
	return { session: await provider.createSession(), name: handle.name };
}

export interface HarnessTurnStream {
	result: StreamTextResult<ToolSet>;
	detach(): Promise<unknown>;
	destroy(): Promise<void>;
}

let kieAgentDirCache: string | null = null;

export function harnessSessionSettings(sessionKey?: string): { extensionFactories: unknown[] } | undefined {
	if (!sessionKey) return undefined;
	return { extensionFactories: [stickySessionExtension(`thread:${sessionKey}`)] };
}

export function ensureKieAgentDir(): string | undefined {
	const providers: Record<string, unknown> = {};
	for (const name of ['kie', 'openrouter', 'opencode'] as HarnessProviderName[]) {
		const key = providerApiKey(name);
		if (!key) continue;
		providers[name] = {
			baseUrl: process.env[`${name.toUpperCase()}_BASE_URL`] ?? providerBaseUrl(name),
			api: 'openai-completions',
			apiKey: key,
			models: name === 'kie' ? [{ id: KIE_LUNA_MODEL }] : providerModels(name)
		};
	}
	if (!Object.keys(providers).length) return undefined;
	if (kieAgentDirCache) return kieAgentDirCache;
	const dir = join(tmpdir(), 'anomalia-pi-agent');
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'models.json'),
		JSON.stringify({ providers })
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

export async function startHarnessTurn(opts: {
	runId: string;
	agentDir?: string;
	model: { provider: string; id?: string };
	system: string;
	messages: unknown;
	tools: ToolSet;
	stopWhen: unknown[];
	sandboxSession?: unknown;
	sessionKey?: string;
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
	const skills = [...brandSkills, ...(await loadHarnessSkills(skillSelection))];
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
	const cached = opts.sessionKey ? liveSessions.get(opts.sessionKey) : undefined;
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
				result: (await (cached.agent as typeof agent).stream({
					session: cached.session,
					messages: opts.messages,
					abortSignal: opts.abortSignal
				})) as StreamTextResult<ToolSet>,
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
		result: (await agent.stream({
			session,
			messages: opts.messages,
			abortSignal: opts.abortSignal
		})) as StreamTextResult<ToolSet>,
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
