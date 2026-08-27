/**
 * I file del workspace si salvano su Supabase Storage prima dello stop vero della VM
 * (computer.ts) e tornano dentro al prossimo `ensureComputer`.
 *
 * File singoli e NON un tar: `tar | base64` passerebbe dallo stdout di `execute()`, clampato a
 * 20.000 caratteri — e un base64 tagliato a metà non è un archivio più corto, è un archivio
 * corrotto che dice di essere stato troncato. `readFile`/`writeFile` stanno fuori da quel clamp:
 * più lenti, ma ogni file che non passa finisce nominato nel manifest.
 *
 * ponytail: tetti dichiarati (`MAX_FILES`, `MAX_FILE_BYTES`) che SALTANO il file in eccesso
 * scrivendolo in `manifest.skipped`, e un root fisso `work/` — chi scrive fuori da lì non
 * sopravvive al sonno, e nessuna euristica prova a indovinare cosa contava. Il binario si
 * corrompe nell'adapter (vedi `VercelSandboxProvider.writeFile`), non qui.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterContext, AdapterDescriptor, FileEntry, SandboxRef } from '@anomalia/agent-kit/types';
import type { CheckpointStore, SandboxProvider } from '@anomalia/agent-kit/interfaces';

export const MAX_FILES = 500;
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB per file — un checkpoint non è un data lake
export const WORKSPACE_ROOT = 'work';
export const BUCKET = 'agent-homes';

type Manifest = {
	generatedAt: string;
	root: string;
	files: Array<{ path: string; bytes: number }>;
	skipped: Array<{ path: string; reason: string }>;
};

/** Ricorsivo, componendo solo le primitive del kit. */
async function walk(sandbox: SandboxProvider, ref: SandboxRef, root: string, ctx: AdapterContext): Promise<FileEntry[]> {
	const out: FileEntry[] = [];
	const stack = [root];
	while (stack.length) {
		const dir = stack.pop()!;
		let entries: FileEntry[];
		try {
			entries = await sandbox.listFiles(ref, dir, ctx);
		} catch {
			// Cartella assente (VM appena nata): checkpoint vuoto, non un errore.
			continue;
		}
		for (const e of entries) {
			if (e.kind === 'dir') stack.push(e.path);
			else out.push(e);
		}
	}
	return out;
}

function relativeToRoot(path: string): string {
	return path.startsWith(`${WORKSPACE_ROOT}/`) ? path.slice(WORKSPACE_ROOT.length + 1) : path;
}

export function createCheckpointStorage(sandbox: SandboxProvider, db: SupabaseClient): CheckpointStore {
	return {
		describe(): AdapterDescriptor<{ maxFileBytes: number; maxFiles: number }> {
			return {
				id: 'checkpoint-storage',
				adapterVersion: '1',
				capabilities: { maxFileBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES }
			};
		},

		async save(brandId: string, ref: SandboxRef, ctx: AdapterContext): Promise<string> {
			const path = `${brandId}/${Date.now()}`;
			const files = await walk(sandbox, ref, WORKSPACE_ROOT, ctx);
			const manifest: Manifest = { generatedAt: new Date().toISOString(), root: WORKSPACE_ROOT, files: [], skipped: [] };

			for (const file of files) {
				if (manifest.files.length >= MAX_FILES) {
					manifest.skipped.push({ path: file.path, reason: `oltre il tetto di ${MAX_FILES} file` });
					continue;
				}
				if (file.size > MAX_FILE_BYTES) {
					manifest.skipped.push({ path: file.path, reason: `${file.size}B supera il tetto di ${MAX_FILE_BYTES}B` });
					continue;
				}
				const content = await sandbox.readFile(ref, file.path, ctx);
				const rel = relativeToRoot(file.path);
				const { error } = await db.storage.from(BUCKET).upload(`${path}/files/${rel}`, content, { upsert: true });
				if (error) throw new Error(`checkpoint: upload di '${file.path}' fallito — ${error.message}`);
				manifest.files.push({ path: rel, bytes: file.size });
			}

			const { error: manifestErr } = await db.storage
				.from(BUCKET)
				.upload(`${path}/manifest.json`, new TextEncoder().encode(JSON.stringify(manifest)), {
					upsert: true,
					contentType: 'application/json'
				});
			if (manifestErr) throw new Error(`checkpoint: scrittura manifest fallita — ${manifestErr.message}`);
			return path;
		},

		async restore(brandId: string, path: string, ref: SandboxRef, ctx: AdapterContext): Promise<void> {
			const { data, error } = await db.storage.from(BUCKET).download(`${path}/manifest.json`);
			if (error || !data) {
				// Manifest sparito (retention, bucket ripulito a mano): meglio una VM vuota che bloccare
				// ogni ensureComputer futuro di questo brand su un errore che non si risolve da solo.
				ctx.log?.({
					label: 'checkpoint.restore.manifest_missing',
					detail: { brandId, path, error: error?.message ?? 'manifest assente' }
				});
				return;
			}
			const manifest = JSON.parse(await data.text()) as Manifest;
			for (const file of manifest.files) {
				const dl = await db.storage.from(BUCKET).download(`${path}/files/${file.path}`);
				if (dl.error || !dl.data) {
					ctx.log?.({ label: 'checkpoint.restore.file_missing', detail: { brandId, path, file: file.path, error: dl.error?.message } });
					continue;
				}
				const bytes = new Uint8Array(await dl.data.arrayBuffer());
				await sandbox.writeFile(ref, `${WORKSPACE_ROOT}/${file.path}`, bytes, ctx);
			}
		}
	};
}
