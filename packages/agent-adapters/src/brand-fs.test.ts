import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AdapterContext } from '@anomalia/agent-kit/types';
import { ServerBrandFs, type BrandFsDeps, type BrandFileTools } from './brand-fs';

/**
 * `ServerBrandFs` PROVATO CON `createFileTools`/`isOverridable`/`createAdminClient` FINTI — il
 * comportamento REALE di quelle funzioni (il registro `how/`, il perimetro per mestiere, il
 * contenuto di `DISRUPTIVE-IDEAS.md`) è già coperto da `agent-files.test.ts` nell'app (53 test);
 * qui si prova SOLO la traduzione che questo adapter fa sopra, con deps che rispondono canned.
 */
const ctx: AdapterContext = { brandId: 'b1', userId: 'u1', runId: 'r1', locale: 'it' };
const fakeSupabase = {} as never;

const uploadMock = vi.fn();

function deps(overrides: Partial<BrandFsDeps> = {}): BrandFsDeps {
	return {
		createFileTools: () => noopTools(),
		isOverridable: (path: string) => /^(how|skills|library)\//.test(path),
		overridablePrefixes: ['how/', 'skills/', 'library/'],
		agentDocsBucket: 'agent-docs',
		createAdminClient: () => ({ storage: { from: () => ({ upload: uploadMock }) } }),
		...overrides
	};
}

function noopTools(): BrandFileTools {
	return {
		ls: { execute: async () => ({ files: [], folders: [] }) },
		read_file: { execute: async () => ({ content: '' }) },
		grep: { execute: async () => ({ matches: [] }) }
	};
}

beforeEach(() => {
	uploadMock.mockReset();
	uploadMock.mockResolvedValue({ error: null });
});

describe('ServerBrandFs.read', () => {
	it('legge un file — il contenuto è quello che createFileTools() torna', async () => {
		const fs = new ServerBrandFs(
			fakeSupabase,
			deps({
				createFileTools: () => ({
					...noopTools(),
					read_file: { execute: async () => ({ content: 'IDEE DIROMPENTI' }) }
				})
			})
		);
		const content = await fs.read('how/DISRUPTIVE-IDEAS.md', ctx);
		expect(content).toBe('IDEE DIROMPENTI');
	});

	it('un path fuori registro lancia con l’errore del modulo wrappato', async () => {
		const fs = new ServerBrandFs(
			fakeSupabase,
			deps({
				createFileTools: () => ({
					...noopTools(),
					read_file: { execute: async () => ({ error: 'No such file or directory' }) }
				})
			})
		);
		await expect(fs.read('how/non-esiste.md', ctx)).rejects.toThrow(/No such file/);
	});

	it('il mestiere letto passa a createFileTools — un file di un altro mestiere è rifiutato per nome', async () => {
		const seenAgents: Array<string | null | undefined> = [];
		const fs = new ServerBrandFs(
			fakeSupabase,
			deps({
				createFileTools: (agent) => {
					seenAgents.push(agent);
					return {
						...noopTools(),
						read_file: {
							execute: async () =>
								agent === 'analyst' ? { error: 'MAKE-MOTION-VIDEO.md belongs to another trade' } : { content: 'ok' }
						}
					};
				}
			}),
			'analyst'
		);
		await expect(fs.read('how/MAKE-MOTION-VIDEO.md', ctx)).rejects.toThrow(/belongs to another trade/);
		expect(seenAgents).toEqual(['analyst']);
	});
});

describe('ServerBrandFs.list', () => {
	it('elenca cartelle e file separando kind', async () => {
		const fs = new ServerBrandFs(
			fakeSupabase,
			deps({
				createFileTools: () => ({
					...noopTools(),
					ls: {
						execute: async () => ({
							files: ['how/DISRUPTIVE-IDEAS.md'],
							folders: ['how/ — 3 file (...)']
						})
					}
				})
			})
		);
		const entries = await fs.list('', false, ctx);
		expect(entries.some((e) => e.kind === 'dir' && e.path === 'how/')).toBe(true);
		expect(entries.some((e) => e.kind === 'file' && e.path === 'how/DISRUPTIVE-IDEAS.md')).toBe(true);
	});
});

describe('ServerBrandFs.grep', () => {
	it('trova testo dentro i file e lo rende come stringa "path:linea: testo"', async () => {
		const fs = new ServerBrandFs(
			fakeSupabase,
			deps({
				createFileTools: () => ({
					...noopTools(),
					grep: {
						execute: async () => ({ matches: [{ path: 'how/DISRUPTIVE-IDEAS.md', line: 3, text: 'IDEE DIROMPENTI' }] })
					}
				})
			})
		);
		const out = await fs.grep('IDEE DIROMPENTI', 'how/DISRUPTIVE-IDEAS.md', ctx);
		expect(out).toBe('how/DISRUPTIVE-IDEAS.md:3: IDEE DIROMPENTI');
	});

	it('nessun risultato torna una spiegazione, non una stringa vuota', async () => {
		const fs = new ServerBrandFs(
			fakeSupabase,
			deps({
				createFileTools: () => ({
					...noopTools(),
					grep: { execute: async () => ({ matches: [], blind: 'nessun risultato' }) }
				})
			})
		);
		const out = await fs.grep('parola-che-non-esiste', 'how/DISRUPTIVE-IDEAS.md', ctx);
		expect(out.length).toBeGreaterThan(0);
	});
});

describe('ServerBrandFs.write — la mutazione fuori dal contratto (nessuna write in agent-files.ts da wrappare)', () => {
	it('rifiuta un path fuori dalle radici scrivibili, nominandole', async () => {
		const fs = new ServerBrandFs(fakeSupabase, deps());
		await expect(fs.write('brand/studio.md', 'x', ctx)).rejects.toThrow(/how\/.*skills\/.*library\//s);
		expect(uploadMock).not.toHaveBeenCalled();
	});

	it('scrive un override sotto `how/` chiamando lo storage admin, non il database di produzione', async () => {
		const fs = new ServerBrandFs(fakeSupabase, deps());
		await fs.write('how/MAKE-MOTION-VIDEO.md', '# override', ctx);
		expect(uploadMock).toHaveBeenCalledTimes(1);
		expect(uploadMock.mock.calls[0][0]).toBe('overrides/how/MAKE-MOTION-VIDEO.md');
	});
});
