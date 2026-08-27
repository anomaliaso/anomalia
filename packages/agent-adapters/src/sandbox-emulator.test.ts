import { describe, expect, it } from 'vitest';
import { SandboxEmulator } from './sandbox-emulator';
import type { AdapterContext } from '@anomalia/agent-kit/types';

const ctx: AdapterContext = { brandId: 'b1', userId: 'u1', runId: 'r1', locale: 'it' };

async function collect(iter: AsyncIterable<{ type: string; data?: string; code?: number }>) {
	const out: Array<{ type: string; data?: string; code?: number }> = [];
	for await (const e of iter) out.push(e);
	return out;
}

describe('SandboxEmulator', () => {
	it('describe() dichiara le capacità: non persistente, non grafica', () => {
		const sb = new SandboxEmulator();
		expect(sb.describe().capabilities).toEqual({ graphical: false, persistent: false });
	});

	it('rifiuta execute prima di provision', async () => {
		const sb = new SandboxEmulator();
		await expect(collect(sb.execute({ kind: 'x', name: 'nope' }, { command: 'echo hi' }, ctx))).rejects.toThrow(
			/non provisionata/
		);
	});

	it('echo scrive stdout, echo > file scrive il file, cat lo rilegge', async () => {
		const sb = new SandboxEmulator();
		const ref = await sb.provision({ brandId: 'b1' }, ctx);

		const echoOut = await collect(sb.execute(ref, { command: 'echo hello' }, ctx));
		expect(echoOut).toEqual([
			{ type: 'stdout', data: 'hello\n' },
			{ type: 'exit', code: 0 }
		]);

		await collect(sb.execute(ref, { command: 'echo "ciao mondo" > work/note.txt' }, ctx));
		expect(sb.files.get('work/note.txt')).toBe('ciao mondo\n');

		const catOut = await collect(sb.execute(ref, { command: 'cat work/note.txt' }, ctx));
		expect(catOut).toEqual([
			{ type: 'stdout', data: 'ciao mondo\n' },
			{ type: 'exit', code: 0 }
		]);
	});

	it('cat su un file inesistente esce 1 con stderr', async () => {
		const sb = new SandboxEmulator();
		const ref = await sb.provision({ brandId: 'b1' }, ctx);
		const out = await collect(sb.execute(ref, { command: 'cat work/missing.txt' }, ctx));
		expect(out).toEqual([
			{ type: 'stderr', data: 'cat: work/missing.txt: No such file or directory' },
			{ type: 'exit', code: 1 }
		]);
	});

	it('exit N restituisce esattamente quel codice', async () => {
		const sb = new SandboxEmulator();
		const ref = await sb.provision({ brandId: 'b1' }, ctx);
		const out = await collect(sb.execute(ref, { command: 'exit 3' }, ctx));
		expect(out).toEqual([{ type: 'exit', code: 3 }]);
	});

	it('ls elenca i path scritti sotto il prefisso', async () => {
		const sb = new SandboxEmulator();
		const ref = await sb.provision({ brandId: 'b1' }, ctx);
		await collect(sb.execute(ref, { command: 'echo a > work/a.txt' }, ctx));
		await collect(sb.execute(ref, { command: 'echo b > work/b.txt' }, ctx));
		const out = await collect(sb.execute(ref, { command: 'ls -la work' }, ctx));
		expect(out[0]).toEqual({ type: 'stdout', data: 'work/a.txt\nwork/b.txt\n' });
	});

	it('un comando non riconosciuto esce 0 muto ma resta in commandsRun', async () => {
		const sb = new SandboxEmulator();
		const ref = await sb.provision({ brandId: 'b1' }, ctx);
		const out = await collect(sb.execute(ref, { command: 'python3 render.py' }, ctx));
		expect(out).toEqual([{ type: 'exit', code: 0 }]);
		expect(sb.commandsRun).toContain('python3 render.py');
	});

	it('listFiles/readFile/writeFile: round-trip completo', async () => {
		const sb = new SandboxEmulator();
		const ref = await sb.provision({ brandId: 'b1' }, ctx);
		await sb.writeFile(ref, 'work/report.md', new TextEncoder().encode('# Report'), ctx);
		const entries = await sb.listFiles(ref, 'work', ctx);
		expect(entries).toEqual([{ path: 'work/report.md', kind: 'file', size: 8 }]);
		const back = await sb.readFile(ref, 'work/report.md', ctx);
		expect(new TextDecoder().decode(back)).toBe('# Report');
	});

	it('readFile su un path assente lancia', async () => {
		const sb = new SandboxEmulator();
		const ref = await sb.provision({ brandId: 'b1' }, ctx);
		await expect(sb.readFile(ref, 'work/nope.md', ctx)).rejects.toThrow(/inesistente/);
	});

	it('stop() de-provisiona: execute successivo torna a rifiutare', async () => {
		const sb = new SandboxEmulator();
		const ref = await sb.provision({ brandId: 'b1' }, ctx);
		await sb.stop(ref, ctx);
		await expect(collect(sb.execute(ref, { command: 'echo hi' }, ctx))).rejects.toThrow(/non provisionata/);
	});
});
