/**
 * `BrandFs` sopra `chat/agent-files.ts`: le letture passano dagli `execute()` dei suoi quattro
 * tool, tradotti nella forma del kit. Niente di quella logica si duplica qui.
 *
 * `write()` invece è codice NUOVO, non un wrapper: `agent-files.ts` non ha nessuna funzione
 * pubblica che scriva un `overrides/` (`readOverride` è privato, `syncAgentFiles` tocca solo
 * `defaults/` e `INDEX/`). Si compone con le tre cose che quel modulo esporta apposta
 * (`AGENT_DOCS_BUCKET`, `isOverridable`, `OVERRIDABLE_PREFIXES`) e scrive lo stesso
 * `overrides/<path>` che `readAgentFile` già preferisce quando esiste.
 *
 * Deps e non import: un pacchetto di `packages/` non può importare `$lib/server/*` (vedi
 * `packages/no-app-imports.test.ts`), e il client Supabase entra dal costruttore perché
 * l'interfaccia del kit non ne porta uno.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolExecutionOptions } from 'ai';
import type { AdapterContext, AdapterDescriptor, FileEntry } from '@anomalia/agent-kit/types';
import type { BrandFs } from '@anomalia/agent-kit/interfaces';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** Lo stesso `RunCtx` di `createFileTools` (agent-files.ts) — ridichiarato, non importato. */
export interface BrandFsRunCtx {
	supabase: SupabaseClient;
	brandId: string;
	threadId: string;
	userId?: string;
}

/**
 * Solo `execute()`, mai lo Zod. Il ritorno resta `any` perché l'`execute` dell'AI SDK può tornare
 * anche un `AsyncIterable`/`PromiseLike`: qui si `await` comunque e si fa il cast al call site.
 */
export interface BrandFileTools {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ls: { execute?: (args: { path?: string; recursive?: boolean }, opts: ToolExecutionOptions) => any };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	read_file: { execute?: (args: { path: string }, opts: ToolExecutionOptions) => any };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	grep: { execute?: (args: { query: string; path?: string }, opts: ToolExecutionOptions) => any };
}

/** Chiesto solo da `write()`, mai aperto per read/list/grep. */
export interface BrandFsAdminClient {
	storage: {
		from(bucket: string): {
			upload(
				path: string,
				blob: Blob,
				opts: { upsert: boolean; contentType: string }
			): Promise<{ error: { message: string } | null }>;
		};
	};
}

export interface BrandFsDeps {
	createFileTools: (agent: string | null | undefined, runId: string, ctx: BrandFsRunCtx) => BrandFileTools;
	isOverridable: (path: string) => boolean;
	overridablePrefixes: readonly string[];
	agentDocsBucket: string;
	createAdminClient: () => BrandFsAdminClient;
}

/** Minimo: questo adapter non è un modello, non ha una `messages[]` vera. */
function toolOpts(context: AdapterContext): ToolExecutionOptions {
	return { toolCallId: `brand-fs:${context.runId}`, messages: [], abortSignal: context.signal };
}

export class ServerBrandFs implements BrandFs {
	constructor(
		private readonly supabase: SupabaseClient,
		private readonly deps: BrandFsDeps,
		/** Il mestiere che sta leggendo — `null`/assente vede solo ciò che è `agents: null`. */
		private readonly agent?: string | null
	) {}

	describe(): AdapterDescriptor<{ writable: boolean }> {
		return { id: 'brand-fs', adapterVersion: '1', capabilities: { writable: true } };
	}

	private tools(context: AdapterContext): BrandFileTools {
		const ctx: BrandFsRunCtx = {
			supabase: this.supabase,
			brandId: context.brandId,
			threadId: context.runId,
			userId: context.userId ?? undefined
		};
		return this.deps.createFileTools(this.agent, context.runId, ctx);
	}

	async list(path: string, recursive: boolean, context: AdapterContext): Promise<FileEntry[]> {
		const { ls } = this.tools(context);
		// Un modello chiede la radice come '.', './' o '/'; il vecchio ls conosce solo il prefisso
		// vero o niente. La traduzione sta QUI, non in ogni superficie che monta il tool.
		const root = path === '.' || path === './' || path === '/' || !path;
		const out = (await ls.execute!(
			{ path: root ? undefined : path.replace(/^\.\//, ''), recursive },
			toolOpts(context)
		)) as AnyRec;
		const fileList: string[] = out.files ?? out.guides ?? [];
		const dirLines: string[] = out.folders ?? [];
		const files: FileEntry[] = fileList.map((p) => ({ path: p, kind: 'file', size: 0 }));
		// Righe `folders`: "path/ — N file (…)", il path sta prima del trattino lungo.
		const dirs: FileEntry[] = dirLines.map((line) => ({ path: line.split(' — ')[0], kind: 'dir', size: 0 }));
		return [...dirs, ...files];
	}

	async read(path: string, context: AdapterContext): Promise<string> {
		const { read_file } = this.tools(context);
		const out = (await read_file.execute!({ path }, toolOpts(context))) as AnyRec;
		if ('error' in out) throw new Error(`brand-fs: ${out.error}`);
		return out.content as string;
	}

	async grep(pattern: string, path: string | null, context: AdapterContext): Promise<string> {
		const { grep } = this.tools(context);
		const out = (await grep.execute!({ query: pattern, path: path ?? undefined }, toolOpts(context))) as AnyRec;
		const matches: Array<{ path: string; line: number; text: string }> = out.matches ?? [];
		if (!matches.length) return String(out.blind ?? out.scope ?? 'nessun risultato');
		return matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join('\n');
	}

	async write(path: string, content: string, _context: AdapterContext): Promise<void> {
		if (!this.deps.isOverridable(path)) {
			throw new Error(
				`brand-fs: '${path}' non è scrivibile — le uniche radici scrivibili sono ${this.deps.overridablePrefixes.join(', ')} (come override; mai i dati del brand o le tracce)`
			);
		}
		const bucket = this.deps.createAdminClient().storage.from(this.deps.agentDocsBucket);
		const { error } = await bucket.upload(`overrides/${path}`, new Blob([content], { type: 'text/markdown' }), {
			upsert: true,
			contentType: 'text/markdown; charset=utf-8'
		});
		if (error) throw new Error(`brand-fs: scrittura di '${path}' fallita — ${error.message}`);
	}
}
