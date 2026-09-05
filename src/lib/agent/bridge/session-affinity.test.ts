import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('$lib/server/sandbox', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		openBrandSandbox: async () => ({ name: 'anomalia-b1-research-g2', raw: {} })
	};
});

vi.mock('@ai-sdk/sandbox-vercel', () => ({
	createVercelSandbox: () => ({ createSession: async () => ({ fake: true }) })
}));

const { harnessSessionSettings } = await import('./adapters');
const { stickySessionExtension } = await import('@anomalia/agent-adapters/runtime/harness-runtime');

type HeaderEvent = { type: 'before_provider_headers'; headers: Record<string, string | null> };

function captureRegisteredHandler(extension: ReturnType<typeof stickySessionExtension>): (event: HeaderEvent) => unknown {
	const handlers: Record<string, Array<(event: HeaderEvent) => unknown>> = {};
	const pi = { on: (event: string, handler: (event: HeaderEvent) => unknown) => {
		(handlers[event] ??= []).push(handler);
	} };
	void (extension as (pi: typeof pi) => unknown)(pi);
	expect(handlers.before_provider_headers).toHaveLength(1);
	return handlers.before_provider_headers[0];
}

function headerSetBy(extension: ReturnType<typeof stickySessionExtension>): Record<string, string | null> {
	const handler = captureRegisteredHandler(extension);
	const headers: Record<string, string | null> = {};
	handler({ type: 'before_provider_headers', headers });
	return headers;
}

describe('stickySessionExtension', () => {
	it('inietta x-session-id negli header di ogni chiamata provider', () => {
		expect(headerSetBy(stickySessionExtension('thread:t1'))).toEqual({ 'x-session-id': 'thread:t1' });
	});

	it('due fabbriche dello stesso thread producono lo stesso valore', () => {
		expect(headerSetBy(stickySessionExtension('thread:t1'))).toEqual(headerSetBy(stickySessionExtension('thread:t1')));
	});

	it('thread diversi producono valori diversi', () => {
		expect(headerSetBy(stickySessionExtension('thread:t1'))['x-session-id']).not.toBe(
			headerSetBy(stickySessionExtension('thread:t2'))['x-session-id']
		);
	});
});

describe('harnessSessionSettings', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('il thread diventa una extension factory con il prefisso thread:', () => {
		const settings = harnessSessionSettings('t1');
		expect(settings?.extensionFactories).toHaveLength(1);
		expect(headerSetBy(settings!.extensionFactories![0] as never)).toEqual({ 'x-session-id': 'thread:t1' });
	});

	it('senza thread nessuna impostazione: niente header inventato', () => {
		expect(harnessSessionSettings(undefined)).toBeUndefined();
		expect(harnessSessionSettings('')).toBeUndefined();
	});

	it('startHarnessTurn passa le impostazioni al setup del provider', () => {
		const src = readFileSync('src/lib/agent/bridge/adapters.ts', 'utf8');
		expect(src).toContain('harnessSessionSettings(opts.sessionKey)');
		// Le impostazioni che arrivano al setup ora portano anche le credenziali (`customEnv`), ma
		// l'affinità di sessione deve restare dentro: è l'header che tiene il thread sulla stessa
		// sessione, e sparirebbe in silenzio.
		expect(src).toMatch(/\.\.\.sessionAffinity/);
		expect(src).toMatch(/setup\.harness\([^)]*piSettings\)/s);
	});
});
