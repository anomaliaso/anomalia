import { describe, expect, it } from 'vitest';
import { BrandFsEmulator } from './brand-fs-emulator';
import type { AdapterContext } from '@anomalia/agent-kit/types';

const ctx: AdapterContext = { brandId: 'b1', userId: 'u1', runId: 'r1', locale: 'it' };

describe('BrandFsEmulator', () => {
	it('describe() dichiara writable:true', () => {
		expect(new BrandFsEmulator().describe().capabilities).toEqual({ writable: true });
	});

	it('write sotto una radice scrivibile, poi read la rilegge', async () => {
		const fs = new BrandFsEmulator();
		await fs.write('how/guide.md', '# Guida', ctx);
		expect(await fs.read('how/guide.md', ctx)).toBe('# Guida');
	});

	it('write fuori dalle radici scrivibili rifiuta nominandole', async () => {
		const fs = new BrandFsEmulator();
		await expect(fs.write('brand/studio.md', 'x', ctx)).rejects.toThrow(/how\/, skills\/, library\//);
	});

	it('list separa cartelle e file a un livello, senza scendere oltre senza recursive', async () => {
		const fs = new BrandFsEmulator();
		await fs.write('how/motion/a.md', 'a', ctx);
		await fs.write('how/motion/b.md', 'b', ctx);
		await fs.write('how/top.md', 'top', ctx);

		const flat = await fs.list('how', false, ctx);
		expect(flat).toEqual(
			expect.arrayContaining([
				{ path: 'how/motion/', kind: 'dir', size: 0 },
				{ path: 'how/top.md', kind: 'file', size: 3 }
			])
		);
		expect(flat.find((e) => e.path === 'how/motion/a.md')).toBeUndefined();

		const deep = await fs.list('how', true, ctx);
		expect(deep.map((e) => e.path).sort()).toEqual(['how/motion/a.md', 'how/motion/b.md', 'how/top.md']);
	});

	it('grep cerca dentro i file, non nei nomi, e riporta path:linea', async () => {
		const fs = new BrandFsEmulator();
		await fs.write('how/guide.md', 'riga uno\nriga con PAROLA\nriga tre', ctx);
		const out = await fs.grep('parola', 'how/', ctx);
		expect(out).toBe('how/guide.md:2: riga con PAROLA');
	});

	it('grep senza risultati non torna una stringa vuota', async () => {
		const fs = new BrandFsEmulator();
		await fs.write('how/guide.md', 'niente qui', ctx);
		expect(await fs.grep('assente', null, ctx)).toBe('nessun risultato');
	});

	it('read su un path assente lancia', async () => {
		const fs = new BrandFsEmulator();
		await expect(fs.read('how/mai-scritto.md', ctx)).rejects.toThrow(/inesistente/);
	});

	it('radici scrivibili configurabili al costruttore — tre mutazioni sullo stesso path', async () => {
		const fs = new BrandFsEmulator(['work/']);
		await expect(fs.write('how/x.md', 'a', ctx)).rejects.toThrow();
		await fs.write('work/notes.md', 'prima versione', ctx);
		expect(await fs.read('work/notes.md', ctx)).toBe('prima versione');
		await fs.write('work/notes.md', 'seconda versione', ctx);
		expect(await fs.read('work/notes.md', ctx)).toBe('seconda versione');
	});
});
