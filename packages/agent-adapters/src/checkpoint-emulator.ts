/**
 * `CheckpointStore` in-memory, per provare save/restore di
 * `ensureComputer`/`sleepIdleComputers` senza Supabase. Root e tetti sono duplicati e non
 * importati: un emulatore che dipende dall'adapter vero è un secondo adapter, non un emulatore.
 */
import type { AdapterContext, AdapterDescriptor, FileEntry, SandboxRef } from '@anomalia/agent-kit/types';
import type { CheckpointStore, SandboxProvider } from '@anomalia/agent-kit/interfaces';

/** Gli stessi numeri di checkpoint-storage.ts, duplicati di proposito (vedi sopra). */
export const MAX_FILES = 500;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const WORKSPACE_ROOT = 'work';

export interface CheckpointEmulator extends CheckpointStore {
	/** path opaco → relPath → contenuto. Pubblico: i test ispezionano. */
	readonly saved: Map<string, Map<string, Uint8Array>>;
}

export function createCheckpointEmulator(sandbox: SandboxProvider): CheckpointEmulator {
	const saved = new Map<string, Map<string, Uint8Array>>();
	let counter = 0;

	async function walk(ref: SandboxRef, root: string, ctx: AdapterContext): Promise<FileEntry[]> {
		const out: FileEntry[] = [];
		const stack = [root];
		while (stack.length) {
			const dir = stack.pop()!;
			let entries: FileEntry[];
			try {
				entries = await sandbox.listFiles(ref, dir, ctx);
			} catch {
				continue;
			}
			for (const e of entries) {
				if (e.kind === 'dir') stack.push(e.path);
				else out.push(e);
			}
		}
		return out;
	}

	return {
		saved,
		describe(): AdapterDescriptor<{ maxFileBytes: number; maxFiles: number }> {
			return { id: 'checkpoint-emulator', adapterVersion: '0', capabilities: { maxFileBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES } };
		},
		async save(brandId: string, ref: SandboxRef, ctx: AdapterContext): Promise<string> {
			const path = `${brandId}/${counter++}`;
			const files = await walk(ref, WORKSPACE_ROOT, ctx);
			const store = new Map<string, Uint8Array>();
			for (const file of files) {
				if (store.size >= MAX_FILES || file.size > MAX_FILE_BYTES) continue;
				const rel = file.path.startsWith(`${WORKSPACE_ROOT}/`) ? file.path.slice(WORKSPACE_ROOT.length + 1) : file.path;
				store.set(rel, await sandbox.readFile(ref, file.path, ctx));
			}
			saved.set(path, store);
			return path;
		},
		async restore(_brandId: string, path: string, ref: SandboxRef, ctx: AdapterContext): Promise<void> {
			const files = saved.get(path);
			if (!files) return;
			for (const [rel, content] of files) {
				await sandbox.writeFile(ref, `${WORKSPACE_ROOT}/${rel}`, content, ctx);
			}
		}
	};
}
