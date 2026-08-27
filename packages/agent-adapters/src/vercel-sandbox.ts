/**
 * `SandboxProvider` sopra `src/lib/server/sandbox.ts` — `openBrandSandbox` fa già provisioning,
 * Chromium, profili di rete e tetto di spesa; qui si traduce solo la sua forma in quella del kit.
 *
 * `SandboxRef` è `{kind, name}` e non porta l'handle vivo: `provision()` lo mette nella Map di
 * processo qui sotto e le altre chiamate lo ripescano da lì — riaprire la VM a ogni chiamata
 * rifarebbe lo script di browse e la pulizia delle run orfane.
 *
 * Due limiti dichiarati: un comando già partito non si annulla (sandbox.ts accetta l'AbortSignal
 * solo all'APERTURA della VM), e `writeFile` corrompe il binario (vedi la nota sul metodo).
 */
import type {
	AdapterContext,
	AdapterDescriptor,
	CommandRequest,
	FileEntry,
	ProcessEvent,
	SandboxCapabilities,
	SandboxRef
} from '@anomalia/agent-kit/types';
import type { SandboxProvider } from '@anomalia/agent-kit/interfaces';

/** Lo stesso `SandboxHandle` di `openBrandSandbox` (sandbox.ts) — ridichiarato, non importato. */
export interface SandboxHandle {
	name: string;
	run(
		cmd: string,
		args: string[],
		opts?: { cwd?: string; timeoutMs?: number }
	): Promise<{ exitCode: number; stdout: string; stderr: string }>;
	readBuffer(path: string): Promise<Buffer>;
	write(files: Array<{ path: string; content: string }>): Promise<void>;
	release(): Promise<void>;
}

/** I profili di sandbox.ts — vedi `MODE`. */
export type SandboxNetworkMode = 'compute' | 'research' | 'agent';

/**
 * Deps e non import: un pacchetto di `packages/` non può importare $lib/$env (vedi
 * `packages/no-app-imports.test.ts`), quindi chi monta l'adapter nell'app le passa qui.
 */
export interface VercelSandboxDeps {
	openBrandSandbox: (opts: {
		brandId: string;
		mode: SandboxNetworkMode;
		timeoutMs: number;
		runId: string;
		agentId?: string;
		ports?: number[];
		abortSignal?: AbortSignal;
		onLog?: (line: string) => void;
	}) => Promise<SandboxHandle>;
	explicitCredentials: () => Record<string, unknown> | null;
	oidcTokenFromRequestContext: () => string | null | undefined;
	/** `env.VERCEL_OIDC_TOKEN` — un solo valore, non l'intero `$env`. */
	vercelOidcToken?: string;
}

/** Un turno tipico (mediana misurata 40,6s in sandbox.ts) con margine — non il tetto della VM. */
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/**
 * `agent` e non `research`: lo stesso turno che monta `shell` monta anche `query` e `brand_read`,
 * quindi internet aperto qui è un `curl` di distanza dai dati del brand — la coppia che il motore
 * classico tiene separata per progetto. E non `compute`: quella lane è la VM dell'orchestratore
 * classico, dove vivono `.github.env` e lo snapshot del brand, e `shell` non ha i guard sui
 * percorsi che i tool sandbox del classico hanno.
 *
 * La policy si fissa alla CREAZIONE della VM: le macchine già nate `research` restano aperte
 * finché lo sweep non le spegne, ma questa lane ha un nome suo e nasce chiusa.
 */
const MODE: SandboxNetworkMode = 'agent';

import { DESKTOP_PORT } from './graphical-bootstrap';

/** Gli handle vivi di questo processo, per nome di sandbox. */
const handles = new Map<string, SandboxHandle>();

export class VercelSandboxProvider implements SandboxProvider {
	constructor(private readonly deps: VercelSandboxDeps) {}

	describe(): AdapterDescriptor<SandboxCapabilities> {
		return {
			id: 'vercel-sandbox',
			adapterVersion: '1',
			// Capacità offerte, non stato di questa istanza: la VM è per-brand e sopravvive al turno,
			// e Xvfb+Chromium li accende graphical-bootstrap.ts sulla stessa VM quando servono.
			capabilities: { graphical: true, persistent: true }
		};
	}

	/**
	 * `timeoutMs` opzionale perché non tutti gli usi durano un turno: chi guarda il desktop ci
	 * resta finché vuole, e con l'affitto di default la macchina gli si spegne sotto dopo cinque
	 * minuti — desktop congelato, appunti che non rispondono, e nessun messaggio che lo dica.
	 */
	async provision(
		request: { brandId: string; agentId?: string; timeoutMs?: number },
		context: AdapterContext
	): Promise<SandboxRef> {
		const handle = await this.deps.openBrandSandbox({
			brandId: request.brandId,
			// La macchina è dell'AGENTE: lo schermo `:1` è uno solo, e due agenti sulla stessa VM
			// si muovono il puntatore a vicenda.
			agentId: request.agentId,
			mode: MODE,
			timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			runId: context.runId,
			// Dichiarata SEMPRE, non solo quando il desktop si accende: è un parametro di creazione,
			// e chiederla dopo su una VM già nata non ha effetto. Finché nessuno ascolta, quella
			// porta risponde 502 «not listening» — nessuna superficie in più.
			ports: [DESKTOP_PORT],
			abortSignal: context.signal,
			onLog: (line) => context.log?.({ label: 'sandbox', detail: { line } })
		});
		handles.set(handle.name, handle);
		return { kind: 'vercel-sandbox', name: handle.name };
	}

	private handleFor(sandbox: SandboxRef): SandboxHandle {
		const handle = handles.get(sandbox.name);
		if (!handle) {
			throw new Error(
				`vercel-sandbox: '${sandbox.name}' non è provisionata in questo processo — chiama provision() prima`
			);
		}
		return handle;
	}

	async *execute(
		sandbox: SandboxRef,
		request: CommandRequest,
		context: AdapterContext
	): AsyncIterable<ProcessEvent> {
		const handle = this.handleFor(sandbox);
		// Un `CommandRequest` è UN comando, non cmd+args: `sh -lc` come `ensureBrowser` in sandbox.ts.
		const result = await handle.run('sh', ['-lc', request.command], {
			cwd: request.cwd,
			timeoutMs: request.timeoutMs
		});
		context.log?.({ label: 'sandbox.execute', detail: { command: request.command, exitCode: result.exitCode } });
		if (result.stdout) yield { type: 'stdout', data: result.stdout };
		if (result.stderr) yield { type: 'stderr', data: result.stderr };
		yield { type: 'exit', code: result.exitCode };
	}

	async listFiles(sandbox: SandboxRef, path: string, _context: AdapterContext): Promise<FileEntry[]> {
		const handle = this.handleFor(sandbox);
		// Nessuna primitiva di listing in sandbox.ts: si passa da `ls -la`.
		const result = await handle.run('ls', ['-la', path || '.']);
		if (result.exitCode !== 0) {
			throw new Error(`vercel-sandbox: 'ls -la ${path}' fallito — ${result.stderr || result.stdout}`);
		}
		return parseLsOutput(result.stdout, path);
	}

	async readFile(sandbox: SandboxRef, path: string, _context: AdapterContext): Promise<Uint8Array> {
		const handle = this.handleFor(sandbox);
		const buf = await handle.readBuffer(path);
		return new Uint8Array(buf);
	}

	async writeFile(sandbox: SandboxRef, path: string, content: Uint8Array, _context: AdapterContext): Promise<void> {
		const handle = this.handleFor(sandbox);
		// `handle.write` scrive solo utf-8: contenuto non testuale si corrompe qui. La via d'uscita
		// (base64 + `base64 -d` in `execute`) non è scritta perché oggi nessuno scrive binario.
		await handle.write([{ path, content: Buffer.from(content).toString('utf8') }]);
	}

	/**
	 * STOP VERO, non il `release()` locale. sandbox.ts non chiama mai `.stop()` perché fra processi
	 * non ha un refcount; qui ce l'ha: `sleepIdleComputers` (computer.ts) arriva qui SOLO dopo aver
	 * verificato che nessun run del brand è `queued`/`running`. Fermarla da qui è sicuro, da
	 * `release()` no.
	 *
	 * La sandbox si richiede per nome (il cron gira in un'invocazione senza handle) con
	 * `resume: false`, per non risvegliarla solo per spegnerla. Un 404 è "già sparita": lo stato
	 * finale che volevamo, non un errore.
	 */
	async stop(sandbox: SandboxRef, _context: AdapterContext): Promise<void> {
		const handle = handles.get(sandbox.name);
		if (handle) {
			await handle.release();
			handles.delete(sandbox.name);
		}
		if (!sandbox.name) return;

		const { Sandbox, APIError } = await import('@vercel/sandbox');
		const hasOidc = Boolean(this.deps.vercelOidcToken || this.deps.oidcTokenFromRequestContext());
		const creds = hasOidc ? null : this.deps.explicitCredentials();
		try {
			const vm = await Sandbox.get({ name: sandbox.name, resume: false, ...(creds ?? {}) } as never);
			await vm.stop();
		} catch (e) {
			if (e instanceof APIError && e.response?.status === 404) return;
			throw e;
		}
	}
}

/** `ls -la` → `FileEntry[]`. Il nome è tutto ciò che segue l'ora: i nomi con spazi restano interi. */
export function parseLsOutput(stdout: string, basePath = ''): FileEntry[] {
	const prefix = basePath ? `${basePath.replace(/\/$/, '')}/` : '';
	const entries: FileEntry[] = [];
	for (const line of stdout.split('\n')) {
		if (!line.trim() || line.startsWith('total ')) continue;
		const fields = line.trim().split(/\s+/);
		if (fields.length < 9) continue;
		const name = fields.slice(8).join(' ');
		if (name === '.' || name === '..') continue;
		const kind = fields[0].startsWith('d') ? 'dir' : 'file';
		const size = Number(fields[4]) || 0;
		entries.push({ path: `${prefix}${name}`, kind, size });
	}
	return entries;
}
