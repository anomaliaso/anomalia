/**
 * `BrandFs` in-memory: stessa regola di scrittura del vero `brand-fs.ts` (solo sotto le radici
 * override), ma senza bucket, database o registro di mestiere — un test semina `files` a mano.
 */
import type { AdapterContext, AdapterDescriptor, FileEntry } from '@anomalia/agent-kit/types';
import type { BrandFs } from '@anomalia/agent-kit/interfaces';

/** Le stesse radici di `OVERRIDABLE_PREFIXES` (agent-files.ts) — duplicate come dato, non logica. */
const DEFAULT_WRITABLE_ROOTS = ['how/', 'skills/', 'library/'] as const;

export class BrandFsEmulator implements BrandFs {
	/** path → contenuto. Pubblico: i test seminano e ispezionano. */
	readonly files = new Map<string, string>();

	constructor(private readonly writableRoots: readonly string[] = DEFAULT_WRITABLE_ROOTS) {}

	describe(): AdapterDescriptor<{ writable: boolean }> {
		return { id: 'brand-fs-emulator', adapterVersion: '1', capabilities: { writable: true } };
	}

	async list(path: string, recursive: boolean, _context: AdapterContext): Promise<FileEntry[]> {
		const prefix = path ? (path.endsWith('/') ? path : `${path}/`) : '';
		if (recursive) {
			return [...this.files.keys()]
				.filter((p) => p.startsWith(prefix))
				.map((p) => ({ path: p, kind: 'file', size: this.files.get(p)?.length ?? 0 }));
		}
		const dirCounts = new Map<string, number>();
		const files: FileEntry[] = [];
		for (const p of this.files.keys()) {
			if (!p.startsWith(prefix)) continue;
			const rest = p.slice(prefix.length);
			const cut = rest.indexOf('/');
			if (cut < 0) {
				files.push({ path: p, kind: 'file', size: this.files.get(p)?.length ?? 0 });
			} else {
				const dir = `${prefix}${rest.slice(0, cut)}/`;
				dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
			}
		}
		const dirs: FileEntry[] = [...dirCounts.keys()].map((d) => ({ path: d, kind: 'dir', size: 0 }));
		return [...dirs, ...files];
	}

	async read(path: string, _context: AdapterContext): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`brand-fs-emulator: file inesistente '${path}'`);
		return content;
	}

	async grep(pattern: string, path: string | null, _context: AdapterContext): Promise<string> {
		const prefix = path ?? '';
		const needle = pattern.toLowerCase();
		const lines: string[] = [];
		for (const [p, content] of this.files) {
			if (!p.startsWith(prefix)) continue;
			content.split('\n').forEach((line, i) => {
				if (line.toLowerCase().includes(needle)) lines.push(`${p}:${i + 1}: ${line}`);
			});
		}
		return lines.length ? lines.join('\n') : 'nessun risultato';
	}

	async write(path: string, content: string, _context: AdapterContext): Promise<void> {
		if (!this.writableRoots.some((root) => path.startsWith(root))) {
			throw new Error(
				`brand-fs-emulator: '${path}' non è scrivibile — radici scrivibili: ${this.writableRoots.join(', ')}`
			);
		}
		this.files.set(path, content);
	}
}
