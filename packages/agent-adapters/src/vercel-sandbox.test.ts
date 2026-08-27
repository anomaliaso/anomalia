import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AdapterContext } from '@anomalia/agent-kit/types';

const ctx: AdapterContext = { brandId: 'b1', userId: 'u1', runId: 'r1', locale: 'it' };

async function collect(iter: AsyncIterable<{ type: string; data?: string; code?: number }>) {
	const out: Array<{ type: string; data?: string; code?: number }> = [];
	for await (const e of iter) out.push(e);
	return out;
}

// Mock del modulo ESISTENTE, non di `@vercel/sandbox`: l'adapter non deve mai toccare la VM vera
// nei test, e la superficie che conta è `openBrandSandbox` (vedi CLAUDE.md/istruzioni del compito).
const runMock = vi.fn();
const writeMock = vi.fn();
const readBufferMock = vi.fn();
const releaseMock = vi.fn();

function makeHandle(name: string) {
	return {
		name,
		mode: 'research' as const, // internet aperto, subnet interne negate: il collaudo del 23/8
		root: 'runs/r1',
		browser: false,
		browserProvisioning: 'not_attempted' as const,
		image: 'test-image',
		playwrightEnv: {},
		run: runMock,
		write: writeMock,
		read: vi.fn(),
		readBuffer: readBufferMock,
		release: releaseMock
	};
}

const openBrandSandboxMock = vi.fn();

// Nessuna credenziale esplicita nei test: lo stesso ramo "hasOidc=false, creds=null" di
// produzione quando né OIDC né VERCEL_TOKEN sono configurati.
function deps(): VercelSandboxDeps {
	return {
		openBrandSandbox: (...args: Parameters<VercelSandboxDeps['openBrandSandbox']>) => openBrandSandboxMock(...args),
		explicitCredentials: () => null,
		oidcTokenFromRequestContext: () => undefined
	};
}

// Il vero `.stop()` sulla VM passa da qui — mockato come `@vercel/sandbox`, mai la rete vera.
class FakeAPIError extends Error {
	response: { status: number };
	constructor(status: number) {
		super(`api error ${status}`);
		this.response = { status };
	}
}
const sandboxGetMock = vi.fn();
vi.mock('@vercel/sandbox', () => ({
	Sandbox: { get: (...args: unknown[]) => sandboxGetMock(...args) },
	APIError: FakeAPIError
}));

// Import DOPO i mock, come vuole vi.mock con l'hoisting.
const { VercelSandboxProvider, parseLsOutput } = await import('./vercel-sandbox');
type VercelSandboxDeps = ConstructorParameters<typeof VercelSandboxProvider>[0];

beforeEach(() => {
	runMock.mockReset();
	writeMock.mockReset();
	readBufferMock.mockReset();
	releaseMock.mockReset();
	openBrandSandboxMock.mockReset();
	sandboxGetMock.mockReset();
});

describe('VercelSandboxProvider', () => {
	it('describe() dichiara la VM persistente e grafica (Xvfb+Chromium via graphical-bootstrap.ts)', () => {
		const provider = new VercelSandboxProvider(deps());
		expect(provider.describe().capabilities).toEqual({ graphical: true, persistent: true });
	});

	it('provision apre la sandbox del brand col nome che openBrandSandbox restituisce', async () => {
		openBrandSandboxMock.mockResolvedValue(makeHandle('anomalia-b1-agent-g2'));
		const provider = new VercelSandboxProvider(deps());
		const ref = await provider.provision({ brandId: 'b1' }, ctx);
		expect(ref).toEqual({ kind: 'vercel-sandbox', name: 'anomalia-b1-agent-g2' });
		expect(openBrandSandboxMock).toHaveBeenCalledWith(
			expect.objectContaining({ brandId: 'b1', mode: 'agent', runId: 'r1' })
		);
	});

	it('execute traduce il comando in `sh -lc` e mappa stdout/stderr/exit', async () => {
		openBrandSandboxMock.mockResolvedValue(makeHandle('emu-name'));
		runMock.mockResolvedValue({ exitCode: 0, stdout: 'ok\n', stderr: '', truncated: false, durationMs: 1 });
		const provider = new VercelSandboxProvider(deps());
		const ref = await provider.provision({ brandId: 'b1' }, ctx);

		const events: unknown[] = [];
		for await (const e of provider.execute(ref, { command: 'ls -la /tmp' }, ctx)) events.push(e);

		expect(runMock).toHaveBeenCalledWith('sh', ['-lc', 'ls -la /tmp'], { cwd: undefined, timeoutMs: undefined });
		expect(events).toEqual([{ type: 'stdout', data: 'ok\n' }, { type: 'exit', code: 0 }]);
	});

	it('execute su una sandbox non provisionata lancia, non chiama la VM', async () => {
		const provider = new VercelSandboxProvider(deps());
		const iter = provider.execute({ kind: 'vercel-sandbox', name: 'mai-vista' }, { command: 'echo hi' }, ctx);
		await expect(collect(iter)).rejects.toThrow(/non è provisionata/);
		expect(runMock).not.toHaveBeenCalled();
	});

	it('writeFile scrive utf-8 attraverso handle.write, readFile passa da readBuffer', async () => {
		openBrandSandboxMock.mockResolvedValue(makeHandle('emu-name-2'));
		readBufferMock.mockResolvedValue(Buffer.from('contenuto'));
		const provider = new VercelSandboxProvider(deps());
		const ref = await provider.provision({ brandId: 'b1' }, ctx);

		await provider.writeFile(ref, 'work/x.md', new TextEncoder().encode('# titolo'), ctx);
		expect(writeMock).toHaveBeenCalledWith([{ path: 'work/x.md', content: '# titolo' }]);

		const buf = await provider.readFile(ref, 'work/x.md', ctx);
		expect(new TextDecoder().decode(buf)).toBe('contenuto');
	});

	it('stop() chiama release() (pulizia della run) E lo stop vero della VM (Sandbox.get().stop())', async () => {
		openBrandSandboxMock.mockResolvedValue(makeHandle('emu-name-3'));
		const provider = new VercelSandboxProvider(deps());
		const ref = await provider.provision({ brandId: 'b1' }, ctx);
		const vmStop = vi.fn().mockResolvedValue(undefined);
		sandboxGetMock.mockResolvedValue({ stop: vmStop });

		await provider.stop(ref, ctx);
		expect(releaseMock).toHaveBeenCalledTimes(1);
		expect(sandboxGetMock).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'emu-name-3', resume: false })
		);
		expect(vmStop).toHaveBeenCalledTimes(1);

		// Dopo stop() l'handle è fuori dalla cache: un secondo execute deve tornare a rifiutare.
		const iter = provider.execute(ref, { command: 'echo hi' }, ctx);
		await expect(collect(iter)).rejects.toThrow(/non è provisionata/);
	});

	it('stop() ferma la VM anche senza un handle in questo processo (il caso del cron)', async () => {
		const provider = new VercelSandboxProvider(deps());
		const vmStop = vi.fn().mockResolvedValue(undefined);
		sandboxGetMock.mockResolvedValue({ stop: vmStop });

		await provider.stop({ kind: 'vercel-sandbox', name: 'anomalia-b2-compute-g2' }, ctx);
		expect(releaseMock).not.toHaveBeenCalled();
		expect(vmStop).toHaveBeenCalledTimes(1);
	});

	it('stop() su una VM già sparita (404) non esplode', async () => {
		const provider = new VercelSandboxProvider(deps());
		sandboxGetMock.mockRejectedValue(new FakeAPIError(404));

		await expect(provider.stop({ kind: 'vercel-sandbox', name: 'gia-sparita' }, ctx)).resolves.toBeUndefined();
	});

	it('stop() propaga un errore che NON è un 404', async () => {
		const provider = new VercelSandboxProvider(deps());
		sandboxGetMock.mockRejectedValue(new FakeAPIError(500));

		await expect(provider.stop({ kind: 'vercel-sandbox', name: 'rotta' }, ctx)).rejects.toThrow(/api error 500/);
	});

	it('la VM degli specialisti non nasce con internet aperto', async () => {
		openBrandSandboxMock.mockResolvedValue(makeHandle('anomalia-b1-agent-g2'));
		const provider = new VercelSandboxProvider(deps());
		await provider.provision({ brandId: 'b1' }, ctx);
		expect(openBrandSandboxMock.mock.calls[0][0].mode).not.toBe('research');
	});

	it("la VM degli specialisti non e' quella dell'orchestratore classico, che porta `.github.env` e lo snapshot del brand", async () => {
		openBrandSandboxMock.mockResolvedValue(makeHandle('anomalia-b1-agent-g2'));
		const provider = new VercelSandboxProvider(deps());
		await provider.provision({ brandId: 'b1' }, ctx);
		expect(openBrandSandboxMock.mock.calls[0][0].mode).not.toBe('compute');
	});
});

describe('parseLsOutput', () => {
	it('salta "total", "." e ".." e distingue file da directory', () => {
		const stdout = [
			'total 8',
			'drwxr-xr-x 3 root root 4096 Jan  1 00:00 .',
			'drwxr-xr-x 5 root root 4096 Jan  1 00:00 ..',
			'-rw-r--r-- 1 root root  120 Jan  1 00:00 index.js',
			'drwxr-xr-x 2 root root 4096 Jan  1 00:00 lib'
		].join('\n');
		expect(parseLsOutput(stdout, 'work')).toEqual([
			{ path: 'work/index.js', kind: 'file', size: 120 },
			{ path: 'work/lib', kind: 'dir', size: 4096 }
		]);
	});

	it('senza basePath i path restano nudi', () => {
		const stdout = '-rw-r--r-- 1 root root 3 Jan  1 00:00 a.txt';
		expect(parseLsOutput(stdout)).toEqual([{ path: 'a.txt', kind: 'file', size: 3 }]);
	});
});
