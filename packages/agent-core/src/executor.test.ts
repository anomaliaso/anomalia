import { describe, it, expect, vi } from 'vitest';
import { createApplyTool, buildSystemPrompt, type ApplyToolDeps } from './executor';
import { BUILTIN_TOOLS } from './tools/builtin';
import { SYSTEM_PROMPT_MAX_CHARS, type AgentSpec } from '@anomalia/agent-contracts/contracts';
import { SandboxEmulator } from '@anomalia/agent-adapters/sandbox-emulator';
import {
	createMemoryBrandFs,
	createMemorySandbox,
	createMemoryStore,
	fakeContext,
	fakePlugin,
	createMemoryEffectsLedger
} from '@anomalia/agent-kit/testkit';

function baseDeps(overrides: Partial<ApplyToolDeps> = {}): ApplyToolDeps {
	return {
		brandFs: createMemoryBrandFs({ 'notes/a.md': 'ciao\nmondo' }),
		sandbox: createMemorySandbox(),
		sandboxRef: null,
		memory: createMemoryStore(),
		plugins: [],
		// Finto: solo la firma che `ensureGraphicalMode` chiede (vedi graphical-bootstrap.ts nel
		// pacchetto agent-adapters) — l'emulatore non installa mai pacchetti veri, quindi il
		// risultato non dipende da cosa risponde davvero Playwright per una distro.
		graphicalBootstrap: {
			runDetached: async () => {}, resolvePlaywrightEnv: () => ({}) },
		...overrides
	};
}

describe('createApplyTool — smistamento builtin', () => {
	it('brand_ls chiama brandFs.list', async () => {
		const apply = createApplyTool(baseDeps());
		const res = await apply({ name: 'brand_ls', args: { recursive: true } }, fakeContext());
		expect(res.isError).toBeFalsy();
		expect(res.content[0]).toMatchObject({ type: 'text' });
		expect((res.content[0] as { text: string }).text).toContain('notes/a.md');
	});

	it('brand_read chiama brandFs.read e propaga il contenuto', async () => {
		const apply = createApplyTool(baseDeps());
		const res = await apply({ name: 'brand_read', args: { path: 'notes/a.md' } }, fakeContext());
		expect((res.content[0] as { text: string }).text).toBe('ciao\nmondo');
	});

	it('brand_grep chiama brandFs.grep', async () => {
		const apply = createApplyTool(baseDeps());
		const res = await apply({ name: 'brand_grep', args: { pattern: 'mondo' } }, fakeContext());
		expect((res.content[0] as { text: string }).text).toContain('notes/a.md:2:mondo');
	});

	it('accetta ancora i nomi pre-rename (righe storiche in produzione) ma non li rimette nel catalogo', async () => {
		const apply = createApplyTool(baseDeps());
		const res = await apply({ name: 'read', args: { path: 'notes/a.md' } }, fakeContext());
		expect(res.isError).toBeFalsy();
		expect((res.content[0] as { text: string }).text).toBe('ciao\nmondo');
		expect(BUILTIN_TOOLS.map((t) => t.name)).not.toContain('read');
		expect(BUILTIN_TOOLS.map((t) => t.name)).toContain('brand_read');
	});

	it('brand_write chiama brandFs.write quando il fs è scrivibile', async () => {
		const brandFs = createMemoryBrandFs({}, { writable: true });
		const apply = createApplyTool(baseDeps({ brandFs }));
		const res = await apply({ name: 'brand_write', args: { path: 'x.md', content: 'y' } }, fakeContext());
		expect(res.isError).toBeFalsy();
		const read = await brandFs.read('x.md', fakeContext());
		expect(read).toBe('y');
	});

	it('brand_write fallisce quando il fs non è scrivibile', async () => {
		const brandFs = createMemoryBrandFs({}, { writable: false });
		const apply = createApplyTool(baseDeps({ brandFs }));
		const res = await apply({ name: 'brand_write', args: { path: 'x.md', content: 'y' } }, fakeContext());
		expect(res.isError).toBe(true);
	});

	it('query chiama il queryTool iniettato', async () => {
		const queryTool = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'righe' }] }));
		const apply = createApplyTool(baseDeps({ queryTool }));
		const res = await apply({ name: 'query', args: { table: 'posts' } }, fakeContext());
		expect(queryTool).toHaveBeenCalledWith({ table: 'posts' }, expect.anything());
		expect((res.content[0] as { text: string }).text).toBe('righe');
	});

	it('query senza queryTool torna un errore che lo dice', async () => {
		const apply = createApplyTool(baseDeps());
		const res = await apply({ name: 'query', args: {} }, fakeContext());
		expect(res.isError).toBe(true);
	});

	it('shell senza sandboxRef spiega che la sandbox non è montata', async () => {
		const apply = createApplyTool(baseDeps({ sandboxRef: null }));
		const res = await apply({ name: 'shell', args: { command: 'ls' } }, fakeContext());
		expect(res.isError).toBe(true);
		expect((res.content[0] as { text: string }).text).toMatch(/sandbox/i);
	});

	it('shell con sandboxRef esegue e riporta stdout + exit code', async () => {
		const sandbox = createMemorySandbox([
			{ type: 'stdout', data: 'ok\n' },
			{ type: 'exit', code: 0 }
		]);
		const apply = createApplyTool(
			baseDeps({ sandbox, sandboxRef: { kind: 'memory', name: 'test' } })
		);
		const res = await apply({ name: 'shell', args: { command: 'echo ok' } }, fakeContext());
		expect(res.isError).toBeFalsy();
		expect((res.content[0] as { text: string }).text).toContain('ok');
		expect((res.content[0] as { text: string }).text).toContain('[exit 0]');
	});

	it('remember chiama memory.commit', async () => {
		const memory = createMemoryStore();
		const apply = createApplyTool(baseDeps({ memory }));
		await apply({ name: 'remember', args: { content: 'fatto' } }, fakeContext());
		expect(memory.entries).toHaveLength(1);
		expect(memory.entries[0].content).toBe('fatto');
	});

	it.each(['reply', 'ask_user', 'plan'])('%s non tocca nessuna dipendenza: torna ok', async (name) => {
		const brandFs = createMemoryBrandFs();
		const listSpy = vi.spyOn(brandFs, 'list');
		const apply = createApplyTool(baseDeps({ brandFs }));
		const res = await apply({ name, args: {} }, fakeContext());
		expect(res.isError).toBeFalsy();
		expect(listSpy).not.toHaveBeenCalled();
	});

	it.each(['observe', 'act'])('%s senza sandbox spiega che non c\'è schermo da guardare', async (name) => {
		const apply = createApplyTool(baseDeps({ sandboxRef: null }));
		const args = name === 'act' ? { actions: [{ kind: 'wait', ms: 10 }] } : {};
		const res = await apply({ name, args }, fakeContext());
		expect(res.isError).toBe(true);
		expect((res.content[0] as { text: string }).text).toMatch(/schermo/i);
	});

	it('observe con una sandbox grafica accende il modo, cattura e torna un content immagine', async () => {
		const sandbox = new SandboxEmulator();
		const sandboxRef = await sandbox.provision({ brandId: 'b1' }, fakeContext());
		const apply = createApplyTool(baseDeps({ sandbox, sandboxRef }));
		const res = await apply({ name: 'observe', args: {} }, fakeContext());
		expect(res.isError).toBeFalsy();
		expect(res.content.some((c) => c.type === 'image')).toBe(true);
		const image = res.content.find((c) => c.type === 'image') as { mimeType: string; base64: string };
		expect(image.mimeType).toBe('image/png');
		expect(image.base64.length).toBeGreaterThan(0);
	});

	it('act rifiuta oltre 24 azioni senza eseguire niente', async () => {
		const sandbox = new SandboxEmulator();
		const sandboxRef = await sandbox.provision({ brandId: 'b1' }, fakeContext());
		const apply = createApplyTool(baseDeps({ sandbox, sandboxRef }));
		const actions = Array.from({ length: 25 }, () => ({ kind: 'wait', ms: 1 }));
		const res = await apply({ name: 'act', args: { actions } }, fakeContext());
		expect(res.isError).toBe(true);
		expect((res.content[0] as { text: string }).text).toMatch(/24/);
	});

	it('act esegue le azioni e torna uno screenshot aggiornato', async () => {
		const sandbox = new SandboxEmulator();
		const sandboxRef = await sandbox.provision({ brandId: 'b1' }, fakeContext());
		const apply = createApplyTool(baseDeps({ sandbox, sandboxRef }));
		const res = await apply(
			{ name: 'act', args: { actions: [{ kind: 'click', x: 5, y: 5 }] } },
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		expect(res.content.some((c) => c.type === 'image')).toBe(true);
	});
});

describe('createApplyTool — plugin e nomi ignoti', () => {
	it('risolve un tool non-builtin nel primo plugin che lo dichiara', async () => {
		const plugin = fakePlugin('post_create', { content: [{ type: 'text', text: 'creato' }] });
		const apply = createApplyTool(baseDeps({ plugins: [plugin] }));
		const res = await apply({ name: 'post_create', args: {} }, fakeContext());
		expect((res.content[0] as { text: string }).text).toBe('creato');
	});

	it('un nome ignoto torna isError e NOMINA i tool disponibili', async () => {
		const plugin = fakePlugin('post_create', { content: [{ type: 'text', text: 'creato' }] });
		const apply = createApplyTool(baseDeps({ plugins: [plugin] }));
		const res = await apply({ name: 'non_esiste', args: {} }, fakeContext());
		expect(res.isError).toBe(true);
		const text = (res.content[0] as { text: string }).text;
		expect(text).toContain('non_esiste');
		expect(text).toContain('brand_ls');
		expect(text).toContain('post_create');
	});
});

describe('createApplyTool — tetto sui risultati', () => {
	it('taglia un risultato oltre il tetto e lo dichiara nel testo', async () => {
		const long = 'a'.repeat(25_000);
		const brandFs = createMemoryBrandFs({ 'big.txt': long });
		const apply = createApplyTool(baseDeps({ brandFs }));
		const res = await apply({ name: 'brand_read', args: { path: 'big.txt' } }, fakeContext());
		const text = (res.content[0] as { text: string }).text;
		expect(text.length).toBeLessThan(long.length);
		expect(text).toMatch(/troncat/i);
		expect(text).toContain('25000');
	});

	it('non tocca un risultato sotto il tetto', async () => {
		const brandFs = createMemoryBrandFs({ 'small.txt': 'breve' });
		const apply = createApplyTool(baseDeps({ brandFs }));
		const res = await apply({ name: 'brand_read', args: { path: 'small.txt' } }, fakeContext());
		expect((res.content[0] as { text: string }).text).toBe('breve');
	});
});

describe('buildSystemPrompt', () => {
	const spec: AgentSpec = {
		id: 'social-agent',
		name: 'Vega',
		title: 'social media',
		instructions: 'Rispondi in italiano.',
		color: '#000',
		model: null
	};

	it('compone identità + instructions + memoria + indice', () => {
		const prompt = buildSystemPrompt(spec, { memoryMd: '- ricorda X', fileIndex: '/brand/voice.md' });
		expect(prompt).toContain('Vega');
		expect(prompt).toContain('Rispondi in italiano.');
		expect(prompt).toContain('ricorda X');
		expect(prompt).toContain('/brand/voice.md');
	});

	it('sta sotto SYSTEM_PROMPT_MAX_CHARS per una spec normale (parte fissa)', () => {
		expect(() => buildSystemPrompt(spec, { memoryMd: '', fileIndex: '' })).not.toThrow();
	});

	it('esplode se la parte fissa supera SYSTEM_PROMPT_MAX_CHARS', () => {
		// Il tipo AgentSpec non impedisce a runtime un nome fuori dai limiti dichiarati da zod:
		// qui bypassiamo la validazione apposta per colpire la guardia di buildSystemPrompt.
		const oversized: AgentSpec = { ...spec, name: 'x'.repeat(SYSTEM_PROMPT_MAX_CHARS + 1) };
		expect(() => buildSystemPrompt(oversized, { memoryMd: '', fileIndex: '' })).toThrow(
			/SYSTEM_PROMPT_MAX_CHARS/
		);
	});
});

describe('attach — mai più lo stub che mente', () => {
	it("senza la dep, attach RIFIUTA con la verità (niente «allegato: /tmp/...» a vuoto)", async () => {
		const apply = createApplyTool(baseDeps());
		const out = await apply({ name: 'attach', args: { path: '/tmp/x.mp4' } }, fakeContext());
		expect(out.isError).toBe(true);
		expect(out.content[0]).toMatchObject({ type: 'text' });
		expect((out.content[0] as { text: string }).text).toContain('NON è stato allegato');
	});

	it('con la dep, delega e propaga il risultato', async () => {
		const deps = baseDeps();
		deps.attach = async (a) => ({ content: [{ type: 'text', text: `fatto:${a.path}` }] });
		const apply = createApplyTool(deps);
		const out = await apply({ name: 'attach', args: { path: '/tmp/x.mp4' } }, fakeContext());
		expect(out.isError).toBeFalsy();
		expect((out.content[0] as { text: string }).text).toBe('fatto:/tmp/x.mp4');
	});
});

describe('createApplyTool — il gate sugli effetti', () => {
	function effectfulPlugin(counter: { calls: number }) {
		return {
			name: 'content',
			tools: [{ name: 'content_schedule', description: 'schedula', inputSchema: { type: 'object' }, effectful: true, consequential: true }],
			async execute() {
				counter.calls += 1;
				return { content: [{ type: 'text' as const, text: `post ${counter.calls}` }] };
			}
		};
	}

	const CALL = { name: 'content_schedule', id: 'call-1', args: { post_id: 'p1' } };

	it('claim PRIMA di eseguire, resolve completed dopo', async () => {
		const counter = { calls: 0 };
		const ledger = createMemoryEffectsLedger();
		const apply = createApplyTool(baseDeps({ plugins: [effectfulPlugin(counter)], effects: ledger }));
		const out = await apply(CALL, fakeContext());
		expect(out.isError).toBeFalsy();
		expect(ledger.rows).toHaveLength(1);
		expect(ledger.rows[0].status).toBe('completed');
		expect(counter.calls).toBe(1);
	});

	it('resume della stessa intenzione esegue una sola volta', async () => {
		const counter = { calls: 0 };
		const ledger = createMemoryEffectsLedger();
		const apply = createApplyTool(baseDeps({ plugins: [effectfulPlugin(counter)], effects: ledger }));

		await apply(CALL, fakeContext({ runId: 'run-1' }));
		expect(counter.calls).toBe(1);

		const out = await apply(CALL, fakeContext({ runId: 'run-2' }));
		expect(counter.calls).toBe(1);
		expect(out.isError).toBeFalsy();
		expect((out.content[0] as { text: string }).text).toContain('post 1');
	});

	it('due intenzioni nuove con args identici eseguono due volte', async () => {
		const counter = { calls: 0 };
		const ledger = createMemoryEffectsLedger();
		const apply = createApplyTool(baseDeps({ plugins: [effectfulPlugin(counter)], effects: ledger }));

		await apply(CALL, fakeContext({ runId: 'run-1' }));
		await apply({ ...CALL, id: 'call-2' }, fakeContext({ runId: 'run-2' }));

		expect(counter.calls).toBe(2);
		expect(ledger.rows).toHaveLength(2);
	});

	it('un tool effectful senza identità stabile non viene eseguito', async () => {
		const counter = { calls: 0 };
		const ledger = createMemoryEffectsLedger();
		const apply = createApplyTool(baseDeps({ plugins: [effectfulPlugin(counter)], effects: ledger }));

		const out = await apply({ name: 'content_schedule', args: { post_id: 'p1' } }, fakeContext());

		expect(counter.calls).toBe(0);
		expect(out.isError).toBe(true);
		expect(out.content[0]).toMatchObject({ type: 'text' });
	});

	it('due worker concorrenti ottengono un solo claim', async () => {
		const counter = { calls: 0 };
		const ledger = createMemoryEffectsLedger();
		const apply = createApplyTool(baseDeps({ plugins: [effectfulPlugin(counter)], effects: ledger }));

		const [first, second] = await Promise.all([
			apply(CALL, fakeContext({ runId: 'run-1' })),
			apply(CALL, fakeContext({ runId: 'run-2' }))
		]);

		expect(counter.calls).toBe(1);
		expect([first, second].filter((result) => !result.isError)).toHaveLength(1);
		expect(ledger.rows).toHaveLength(1);
	});

	it('un worker tardivo non risolve un effetto già riconciliato', async () => {
		const counter = { calls: 0 };
		const ledger = createMemoryEffectsLedger();
		const claim = await ledger.claim({
			brandId: 'brand-test',
			runId: 'run-dead',
			invocationId: CALL.id,
			toolName: CALL.name,
			request: CALL.args
		});
		await ledger.reconcileRun('run-dead');
		await ledger.resolve(claim.effect.id, 'completed', { content: [{ type: 'text', text: 'late' }] });
		const apply = createApplyTool(baseDeps({ plugins: [effectfulPlugin(counter)], effects: ledger }));

		const out = await apply(CALL, fakeContext({ runId: 'run-new' }));
		expect(counter.calls).toBe(0);
		expect(out.isError).toBe(true);
		expect((out.content[0] as { text: string }).text).toMatch(/già registrato/);
		expect(ledger.rows[0].status).toBe('ambiguous');
	});

	it('failed lascia rieseguire (l\'effetto non è avvenuto, non è un doppione)', async () => {
		const counter = { calls: 0 };
		const injected = createMemoryEffectsLedger();
		const claim = await injected.claim({
			brandId: 'brand-test',
			runId: 'r0',
			invocationId: CALL.id,
			toolName: CALL.name,
			request: CALL.args
		});
		await injected.resolve(claim.effect.id, 'failed', { message: 'net' });
		const apply = createApplyTool(baseDeps({ plugins: [effectfulPlugin(counter)], effects: injected }));

		const out = await apply(CALL, fakeContext());
		expect(counter.calls).toBe(1);
		expect((out.content[0] as { text: string }).text).toBe('post 1');
	});

	it('un risultato ambiguo resta congelato anche se il tool lo segnala come errore', async () => {
		const counter = { calls: 0 };
		const ledger = createMemoryEffectsLedger();
		const plugin = {
			...effectfulPlugin(counter),
			async execute() {
				counter.calls += 1;
				return { content: [{ type: 'text' as const, text: 'esito incerto' }], isError: true, effectStatus: 'ambiguous' as const };
			}
		};
		const apply = createApplyTool(baseDeps({ plugins: [plugin], effects: ledger }));

		const first = await apply(CALL, fakeContext({ runId: 'run-1' }));
		const second = await apply(CALL, fakeContext({ runId: 'run-2' }));

		expect(first.effectStatus).toBe('ambiguous');
		expect(second).toEqual(first);
		expect(counter.calls).toBe(1);
		expect(ledger.rows[0]?.status).toBe('ambiguous');
	});

	it('un eccezione durante un effetto diventa ambiguous, non un retry cieco', async () => {
		const counter = { calls: 0 };
		const ledger = createMemoryEffectsLedger();
		const plugin = {
			...effectfulPlugin(counter),
			async execute() {
				counter.calls += 1;
				throw new Error('connessione interrotta dopo la scrittura');
			}
		};
		const apply = createApplyTool(baseDeps({ plugins: [plugin], effects: ledger }));

		await expect(apply(CALL, fakeContext({ runId: 'run-1' }))).rejects.toThrow('connessione interrotta');
		const second = await apply(CALL, fakeContext({ runId: 'run-2' }));

		expect(second.isError).toBe(true);
		expect(counter.calls).toBe(1);
		expect(ledger.rows[0]?.status).toBe('ambiguous');
	});

	it('la stessa identità con payload diverso viene rifiutata', async () => {
		const counter = { calls: 0 };
		const ledger = createMemoryEffectsLedger();
		const apply = createApplyTool(baseDeps({ plugins: [effectfulPlugin(counter)], effects: ledger }));

		await apply(CALL, fakeContext({ runId: 'run-1' }));
		const out = await apply(
			{ ...CALL, args: { post_id: 'p2' } },
			fakeContext({ runId: 'run-2' })
		);

		expect(counter.calls).toBe(1);
		expect(out.isError).toBe(true);
		expect((out.content[0] as { text: string }).text).toMatch(/payload|identità|identity/i);
	});

	it('solo i tool marcat effectful passano dal gate; gli altri no', async () => {
		const counter = { calls: 0 };
		const ledger = createMemoryEffectsLedger();
		const plugin = { ...effectfulPlugin(counter), tools: [{ name: 'content_read', description: 'legge', inputSchema: { type: 'object' }, effectful: false, consequential: false }] };
		const apply = createApplyTool(baseDeps({ plugins: [plugin], effects: ledger }));
		const out = await apply({ name: 'content_read', args: {} }, fakeContext());
		expect(out.isError).toBeFalsy();
		expect(ledger.rows).toHaveLength(0); // nessuna riga: il tool non ha effetti
		expect(counter.calls).toBe(1);
	});
});
