/**
 * `SandboxProvider` in-memory: una Map path→contenuto fa da filesystem e `execute` riconosce le
 * forme più comuni (`echo`, `cat`, `ls`, `exit N`), non un vero shell. Quello che non riconosce
 * torna exit 0 muto, ma OGNI comando finisce comunque in `commandsRun`: un test può sapere cosa
 * l'agente ha provato a fare anche quando l'emulatore non sa eseguirlo.
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

/** Non decodifica: prova solo che i bytes arrivano intatti fino a `readFile`. */
const FAKE_PNG_BYTES = 'FAKE-PNG-89504E47';

function unquote(raw: string): string {
	const s = raw.trim();
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		return s.slice(1, -1);
	}
	return s;
}

export class SandboxEmulator implements SandboxProvider {
	/** path → contenuto. Pubblico: i test lo seminano e lo ispezionano. */
	readonly files = new Map<string, string>();
	/** Ogni comando passato a `execute`, anche quelli che l'emulatore non capisce. */
	readonly commandsRun: string[] = [];
	private readonly provisioned = new Set<string>();

	describe(): AdapterDescriptor<SandboxCapabilities> {
		return { id: 'sandbox-emulator', adapterVersion: '1', capabilities: { graphical: false, persistent: false } };
	}

	async provision(request: { brandId: string }, _context: AdapterContext): Promise<SandboxRef> {
		const ref: SandboxRef = { kind: 'sandbox-emulator', name: `emu-${request.brandId}` };
		this.provisioned.add(ref.name);
		return ref;
	}

	private requireProvisioned(sandbox: SandboxRef): void {
		if (!this.provisioned.has(sandbox.name)) {
			throw new Error(`sandbox-emulator: '${sandbox.name}' non provisionata — chiama provision() prima`);
		}
	}

	async *execute(sandbox: SandboxRef, request: CommandRequest, _context: AdapterContext): AsyncIterable<ProcessEvent> {
		this.requireProvisioned(sandbox);
		this.commandsRun.push(request.command);
		const { stdout, stderr, code } = this.run(request.command.trim());
		if (stdout) yield { type: 'stdout', data: stdout };
		if (stderr) yield { type: 'stderr', data: stderr };
		yield { type: 'exit', code };
	}

	private run(cmd: string): { stdout: string; stderr: string; code: number } {
		// Lo screenshot di `graphical-bootstrap.ts`: scrive un PNG finto per provare che
		// `observe`/`act` arrivano a `readFile` e a un content-type immagine. Non un pixel vero.
		let m = cmd.match(/^import\s+-window\s+root\s+-display\s+\S+\s+(\S+)$/);
		if (m) {
			this.files.set(m[1], FAKE_PNG_BYTES);
			return { stdout: '', stderr: '', code: 0 };
		}

		m = cmd.match(/^echo\s+(.*?)\s*(>>|>)\s*(\S+)$/);
		if (m) {
			const text = unquote(m[1]);
			const append = m[2] === '>>';
			const path = m[3];
			const prev = append ? (this.files.get(path) ?? '') : '';
			this.files.set(path, `${prev}${text}\n`);
			return { stdout: '', stderr: '', code: 0 };
		}
		m = cmd.match(/^echo\s+(.*)$/);
		if (m) return { stdout: `${unquote(m[1])}\n`, stderr: '', code: 0 };

		m = cmd.match(/^cat\s+(\S+)$/);
		if (m) {
			const path = m[1];
			if (!this.files.has(path)) return { stdout: '', stderr: `cat: ${path}: No such file or directory`, code: 1 };
			return { stdout: this.files.get(path) ?? '', stderr: '', code: 0 };
		}

		m = cmd.match(/^ls(?:\s+-\w+)?(?:\s+(\S+))?$/);
		if (m) {
			const prefix = m[1] ?? '';
			const names = [...this.files.keys()].filter((p) => p.startsWith(prefix)).sort();
			return { stdout: names.length ? `${names.join('\n')}\n` : '', stderr: '', code: 0 };
		}

		m = cmd.match(/^exit\s+(\d+)$/);
		if (m) return { stdout: '', stderr: '', code: Number(m[1]) };

		// ponytail: tutto il resto è exit 0 muto — l'emulatore serve i test dell'executor, non ogni
		// sfumatura di bash. `commandsRun` resta la prova di cosa è passato di qui.
		return { stdout: '', stderr: '', code: 0 };
	}

	async listFiles(sandbox: SandboxRef, path: string, _context: AdapterContext): Promise<FileEntry[]> {
		this.requireProvisioned(sandbox);
		const prefix = path ? `${path.replace(/\/$/, '')}/` : '';
		const seen = new Set<string>();
		const out: FileEntry[] = [];
		for (const p of this.files.keys()) {
			if (!p.startsWith(prefix)) continue;
			const rest = p.slice(prefix.length);
			const cut = rest.indexOf('/');
			const name = cut < 0 ? rest : rest.slice(0, cut);
			if (!name || seen.has(name)) continue;
			seen.add(name);
			out.push(
				cut < 0
					? { path: `${prefix}${name}`, kind: 'file', size: this.files.get(p)?.length ?? 0 }
					: { path: `${prefix}${name}`, kind: 'dir', size: 0 }
			);
		}
		return out;
	}

	async readFile(sandbox: SandboxRef, path: string, _context: AdapterContext): Promise<Uint8Array> {
		this.requireProvisioned(sandbox);
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`sandbox-emulator: file inesistente '${path}'`);
		return new TextEncoder().encode(content);
	}

	async writeFile(sandbox: SandboxRef, path: string, content: Uint8Array, _context: AdapterContext): Promise<void> {
		this.requireProvisioned(sandbox);
		this.files.set(path, new TextDecoder().decode(content));
	}

	async stop(sandbox: SandboxRef, _context: AdapterContext): Promise<void> {
		this.provisioned.delete(sandbox.name);
	}
}
