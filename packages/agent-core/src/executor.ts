/**
 * L'UNICO posto che esegue un tool: builtin sulle interfacce del kit, il resto nei plugin.
 * reply/ask_user/plan restano no-op qui — il loro effetto è di chi orchestra il run (turn.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterContext, EffectsLedger, ToolCall, ToolResult } from '@anomalia/agent-kit';
import type { BrandFs, CheckpointStore, MemoryStore, SandboxProvider, SandboxRef, ToolPlugin } from '@anomalia/agent-kit';
import { SYSTEM_PROMPT_MAX_CHARS, type AgentSpec } from '@anomalia/agent-contracts/contracts';
import { BUILTIN_TOOLS, TERMINAL_TOOL_NAMES } from './tools/builtin';
import { frozenResult, legacyEffectKey } from './effects';
import { ensureComputer, touchComputer } from './computer';
import {
	ensureGraphicalMode,
	captureScreenshot,
	runActions,
	type DesktopAction,
	type GraphicalBootstrapDeps
} from '@anomalia/agent-adapters/graphical-bootstrap';

/** Tetto per risultato: oltre questo il testo si taglia e il taglio si dichiara sempre. */
const RESULT_MAX_CHARS = 20_000;

const NOOP_TOOL_NAMES = new Set<string>([...TERMINAL_TOOL_NAMES, 'plan']);

/**
 * Alias di SOLA LETTURA verso i nomi pre-rename: righe di `chat_messages.tool_calls` con questi
 * nomi esistono ancora e possono rientrare in gioco (rilancio, retry, client in cache). L'alias
 * accetta la chiamata, non la reintroduce — `BUILTIN_TOOLS` non li offre più a nessuno.
 */
const LEGACY_TOOL_ALIASES: Record<string, string> = {
	ls: 'brand_ls',
	read: 'brand_read',
	grep: 'brand_grep',
	write: 'brand_write'
};

function ok(text: string): ToolResult {
	return { content: [{ type: 'text', text: capText(text) }] };
}

function err(text: string): ToolResult {
	return { content: [{ type: 'text', text }], isError: true };
}

/** Taglia un testo al tetto dichiarandolo SEMPRE nel testo stesso — mai in silenzio. */
function capText(text: string): string {
	if (text.length <= RESULT_MAX_CHARS) return text;
	const cut = text.slice(0, RESULT_MAX_CHARS);
	return `${cut}\n\n[troncato: ${text.length} caratteri, mostrati i primi ${RESULT_MAX_CHARS}]`;
}

function unknownToolError(name: string, pluginNames: string[]): ToolResult {
	const builtinNames = BUILTIN_TOOLS.map((t) => t.name);
	const known = [...builtinNames, ...pluginNames].join(', ');
	return err(`tool '${name}' non esiste. Disponibili: ${known}`);
}

/** Le dipendenze dell'executor: SOLO le interfacce del kit, mai un'implementazione concreta. */
export interface ApplyToolDeps {
	brandFs: BrandFs;
	sandbox: SandboxProvider;
	sandboxRef: SandboxRef | null;
	memory: MemoryStore;
	queryTool?: (args: Record<string, unknown>, ctx: AdapterContext) => Promise<ToolResult>;
	/**
	 * Allegare DAVVERO un file (upload + galleria + url). Senza, il tool rifiuta dicendolo: mai uno
	 * stub «allegato: /tmp/…», che fa credere all'agente di aver consegnato qualcosa di invisibile.
	 */
	attach?: (args: { path?: string; media_id?: string }, ctx: AdapterContext) => Promise<ToolResult>;
	plugins: ToolPlugin[];
	/**
	 * Presente: ogni `shell` fa `ensureComputer` prima (riaccende e ripristina) e `touchComputer`
	 * dopo (riprogramma il sonno), e il ref vivo lo dà `ensureComputer`, non `sandboxRef`.
	 * Assente: si usa `sandboxRef` montato a monte e la VM non si spegne mai da sé.
	 */
	computer?: { db: SupabaseClient; home: CheckpointStore };
	/** Senza, `observe`/`act` rispondono con l'errore-che-insegna invece di esplodere. */
	graphicalBootstrap?: GraphicalBootstrapDeps;
	/**
	 * Presente: i tool con `effectful: true` passano dal ledger degli effetti — claim prima di
	 * eseguire, resolve dopo, e su un resume che rivede la stessa identità congelano invece di
	 * rieseguire (un doppio post/schedulazione è un danno, non un errore da riprovare).
	 * Assente: nessun gate, si esegue e basta (il lab, i test, le superfici senza righe).
	 */
	effects?: EffectsLedger;
}

export type ApplyTool = (call: ToolCall, ctx: AdapterContext) => Promise<ToolResult>;

async function resolveSandboxRef(deps: ApplyToolDeps, ctx: AdapterContext): Promise<SandboxRef | null> {
	if (!deps.computer) return deps.sandboxRef;
	// `ctx.agentId`: `observe` e `act` guardano e toccano UNO schermo, e quello schermo è
	// dell'agente che sta girando. Senza, due specialisti dello stesso brand finirebbero sulla
	// stessa scrivania a muoversi il puntatore a vicenda.
	return ensureComputer(
		{ db: deps.computer.db, sandbox: deps.sandbox, home: deps.computer.home },
		ctx.brandId,
		ctx,
		ctx.agentId
	);
}

export function createApplyTool(deps: ApplyToolDeps): ApplyTool {
	// L'esecuzione vera, senza gate: la chiude in una closure che ha `deps` nel suo scope.
	const execute = async (call: ToolCall, ctx: AdapterContext): Promise<ToolResult> => {
		const { args } = call;
		const name = LEGACY_TOOL_ALIASES[call.name] ?? call.name;

		if (NOOP_TOOL_NAMES.has(name)) return ok('ok');

		switch (name) {
			case 'brand_ls': {
				const entries = await deps.brandFs.list(
					(args.path as string) ?? '/',
					Boolean(args.recursive),
					ctx
				);
				return ok(entries.map((e) => `${e.kind === 'dir' ? 'd' : 'f'} ${e.path} (${e.size}B)`).join('\n') || '(vuoto)');
			}
			case 'brand_read': {
				if (!args.path) return err("brand_read richiede 'path'");
				const content = await deps.brandFs.read(args.path as string, ctx);
				return ok(content);
			}
			case 'brand_grep': {
				if (!args.pattern) return err("brand_grep richiede 'pattern'");
				const result = await deps.brandFs.grep(
					args.pattern as string,
					(args.path as string) ?? null,
					ctx
				);
				return ok(result || '(nessun match)');
			}
			case 'brand_write': {
				if (!args.path || args.content === undefined) return err("brand_write richiede 'path' e 'content'");
				if (!deps.brandFs.write) return err('brand_write: questo brand non ha un filesystem scrivibile');
				await deps.brandFs.write(args.path as string, args.content as string, ctx);
				return ok(`scritto: ${args.path}`);
			}
			case 'query': {
				if (!deps.queryTool) return err('query: nessuna sorgente dati collegata a questo run');
				return deps.queryTool(args, ctx);
			}
			case 'shell': {
				if (!args.command) return err("shell richiede 'command'");
				const sandboxRef = await resolveSandboxRef(deps, ctx);
				if (!sandboxRef) return err('shell: nessuna sandbox montata per questo run, il comando non può girare');
				let out = '';
				for await (const event of deps.sandbox.execute(
					sandboxRef,
					{ command: args.command as string, cwd: args.cwd as string | undefined },
					ctx
				)) {
					if (event.type === 'stdout' || event.type === 'stderr') out += event.data;
					else if (event.type === 'exit') out += `\n[exit ${event.code}]`;
				}
				if (deps.computer) await touchComputer({ db: deps.computer.db }, ctx.brandId);
				return ok(out);
			}
			case 'observe': {
				const sandboxRef = await resolveSandboxRef(deps, ctx);
				if (!sandboxRef) return err('observe: nessuna sandbox montata per questo run, non c\'è schermo da guardare');
				if (!deps.graphicalBootstrap) return err('observe: modo grafico non collegato per questo run');
				const status = await ensureGraphicalMode(deps.sandbox, sandboxRef, ctx, deps.graphicalBootstrap);
				if (deps.computer) await touchComputer({ db: deps.computer.db }, ctx.brandId);
				if (!status.ok) return err(`observe: modo grafico non disponibile — ${status.error}`);
				const shot = await captureScreenshot(deps.sandbox, sandboxRef, ctx);
				if (!shot.ok) return err(`observe: screenshot fallito — ${shot.error}`);
				const slowNote = status.cached ? '' : ' (primo avvio del modo grafico su questa VM: è stato lento, i prossimi non lo saranno)';
				const browserNote = status.browser ? '' : ' — nessun browser installabile in questa VM: solo desktop vuoto, dichiaralo se serve navigare';
				return {
					content: [
						{ type: 'text', text: `schermo catturato${slowNote}${browserNote}` },
						{ type: 'image', mimeType: 'image/png', base64: shot.base64 }
					]
				};
			}
			case 'act': {
				const actions = Array.isArray(args.actions) ? (args.actions as DesktopAction[]) : null;
				if (!actions || !actions.length) return err("act richiede 'actions' (almeno una, max 24)");
				if (actions.length > 24) return err('act: massimo 24 azioni per chiamata');
				const sandboxRef = await resolveSandboxRef(deps, ctx);
				if (!sandboxRef) return err('act: nessuna sandbox montata per questo run, non c\'è schermo da controllare');
				if (!deps.graphicalBootstrap) return err('act: modo grafico non collegato per questo run');
				const status = await ensureGraphicalMode(deps.sandbox, sandboxRef, ctx, deps.graphicalBootstrap);
				if (!status.ok) {
					if (deps.computer) await touchComputer({ db: deps.computer.db }, ctx.brandId);
					return err(`act: modo grafico non disponibile — ${status.error}`);
				}
				const ran = await runActions(deps.sandbox, sandboxRef, ctx, actions);
				if (deps.computer) await touchComputer({ db: deps.computer.db }, ctx.brandId);
				if (!ran.ok) return err(`act: ${ran.error}`);
				const shot = await captureScreenshot(deps.sandbox, sandboxRef, ctx);
				if (!shot.ok) return err(`act: azioni eseguite ma screenshot fallito — ${shot.error}`);
				const slowNote = status.cached ? '' : ' (primo avvio del modo grafico su questa VM: è stato lento, i prossimi non lo saranno)';
				return {
					content: [
						{ type: 'text', text: `${actions.length} azioni eseguite${slowNote}` },
						{ type: 'image', mimeType: 'image/png', base64: shot.base64 }
					]
				};
			}
			case 'attach': {
				if (!args.path && !args.media_id) return err("attach richiede 'path' o 'media_id'");
				if (!deps.attach) return err('attach non è collegato su questa superficie: il file NON è stato allegato. Se hai un url pubblico, mettilo nel reply.');
				return deps.attach({ path: args.path as string | undefined, media_id: args.media_id as string | undefined }, ctx);
			}
			case 'remember': {
				if (!args.content) return err("remember richiede 'content'");
				await deps.memory.commit(
					ctx.brandId,
					ctx.runId,
					{ path: (args.path as string) ?? 'note.md', content: args.content as string },
					ctx
				);
				return ok('memorizzato');
			}
			default: {
				const plugin = deps.plugins.find((p) => p.tools.some((t) => t.name === name));
				if (plugin) return plugin.execute(call, ctx);
				const pluginNames = deps.plugins.flatMap((p) => p.tools.map((t) => t.name));
				return unknownToolError(name, pluginNames);
			}
		}
	};

	return async (call: ToolCall, ctx: AdapterContext): Promise<ToolResult> => {
		const name = LEGACY_TOOL_ALIASES[call.name] ?? call.name;

		if (!deps.effects || !isEffectful(name, deps.plugins)) {
			return execute(call, ctx);
		}

		const invocationId = call.id?.trim();
		if (!invocationId) {
			return err(`tool '${name}' senza identità stabile della chiamata`);
		}

		const claim = await deps.effects.claim({
			brandId: ctx.brandId,
			runId: ctx.runId,
			invocationId,
			toolName: name,
			request: call.args,
			legacyKey: legacyEffectKey(name, call.args)
		});
		if (claim.kind === 'mismatch') {
			return err(`tool '${name}' rifiutato: payload diverso per la stessa identità di chiamata`);
		}
		if (claim.kind === 'existing') {
			const frozen = frozenResult(claim.effect);
			if (frozen) {
				return frozen;
			}
			return err(`tool '${name}' non eseguito: effetto già registrato (${claim.effect.status})`);
		}

		const effect = claim.effect;
		try {
			const result = await execute(call, ctx);
			await deps.effects.resolve(effect.id, result.isError ? 'failed' : 'completed', result);
			return result;
		} catch (err) {
			await deps.effects.resolve(effect.id, 'failed', { message: err instanceof Error ? err.message : String(err) });
			throw err;
		}
	};
}

/** Un tool è `effectful` se la sua dichiarazione (builtin o plugin) lo marca tale. */
function isEffectful(name: string, plugins: ToolPlugin[]): boolean {
	const builtin = BUILTIN_TOOLS.find((t) => t.name === name);
	if (builtin) return Boolean(builtin.effectful);
	return (
		plugins.find((p) => p.tools.some((t) => t.name === name))?.tools.find((t) => t.name === name)?.effectful ?? false
	);
}

/**
 * Identità fissa + instructions + memoria + indice file. Solo la parte FISSA è soggetta a
 * SYSTEM_PROMPT_MAX_CHARS (il resto ha i suoi tetti a monte): se la sfora è un bug di questo
 * template, e deve esplodere qui invece di arrivare in silenzio al modello.
 */
export function buildSystemPrompt(
	spec: AgentSpec,
	extras: { memoryMd: string; fileIndex: string }
): string {
	const fixed = fixedPreamble(spec);
	if (fixed.length > SYSTEM_PROMPT_MAX_CHARS) {
		throw new Error(
			`buildSystemPrompt: la parte fissa (${fixed.length} caratteri) supera SYSTEM_PROMPT_MAX_CHARS (${SYSTEM_PROMPT_MAX_CHARS}) — accorcia il template, non la spec`
		);
	}
	const parts = [fixed, spec.instructions];
	if (extras.memoryMd) parts.push(`## Memoria\n${extras.memoryMd}`);
	if (extras.fileIndex) parts.push(`## File del brand\n${extras.fileIndex}`);
	return parts.join('\n\n');
}

function fixedPreamble(spec: AgentSpec): string {
	const title = spec.title ? ` (${spec.title})` : '';
	return `You are ${spec.name}${title}, an Anomalia agent.`;
}
