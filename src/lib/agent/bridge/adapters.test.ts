import { describe, expect, it, vi, beforeEach } from 'vitest';

const openCalls: Array<Record<string, unknown>> = [];
const sandboxReleases: Array<ReturnType<typeof vi.fn>> = [];

vi.mock('$lib/server/sandbox', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		openBrandSandbox: async (opts: Record<string, unknown>) => {
			openCalls.push(opts);
			const release = vi.fn(async () => {});
			sandboxReleases.push(release);
			return { name: 'anomalia-b1-research-g2', raw: {}, release };
		}
	};
});

vi.mock('@ai-sdk/sandbox-vercel', () => ({
	createVercelSandbox: () => ({ createSession: async () => ({ fake: true }) })
}));

const { openBrandHarnessSession, dropLiveHarnessSession, resolveHarnessModelRef, harnessSdkModel } =
	await import('./adapters');
const { env } = await import('$env/dynamic/private');

describe('openBrandHarnessSession', () => {
	beforeEach(() => {
		openCalls.length = 0;
		delete env.HARNESS_SANDBOX_MODE;
	});

	it('la rete della macchina è SEMPRE research: nessuna env può restringerla', async () => {
		env.HARNESS_SANDBOX_MODE = 'compute';
		const s = await openBrandHarnessSession('b1', 'r1');
		expect(openCalls[0]?.mode).toBe('research');
		expect(s.name).toBe('anomalia-b1-research-g2');
		expect(s.session).toEqual({ fake: true });
	});

	it('identifica la run e paga il lease massimo dichiarato', async () => {
		await openBrandHarnessSession('b1', 'r1');
		expect(openCalls[0]?.runId).toBe('r1');
		expect(openCalls[0]?.timeoutMs).toBeGreaterThan(0);
	});
});

describe('openBrandHarnessSession — riuso per sessionKey (task 85)', () => {
	beforeEach(() => {
		openCalls.length = 0;
		sandboxReleases.length = 0;
		delete env.HARNESS_SANDBOX_MODE;
	});

	it('due turni con la stessa sessionKey aprono la sandbox UNA sola volta', async () => {
		const first = await openBrandHarnessSession('b1', 'r1', 'a1', 'thread-1');
		const second = await openBrandHarnessSession('b1', 'r2', 'a1', 'thread-1');
		expect(openCalls).toHaveLength(1);
		expect(second).toBe(first);
	});

	it('sessionKey diverse restano macchine (chiamate) separate', async () => {
		await openBrandHarnessSession('b1', 'r1', 'a1', 'thread-3');
		await openBrandHarnessSession('b1', 'r2', 'a1', 'thread-4');
		expect(openCalls).toHaveLength(2);
	});

	it('due aperture concorrenti sulla stessa sessionKey non aprono due sandbox (race)', async () => {
		const [a, b] = await Promise.all([
			openBrandHarnessSession('b1', 'r1', 'a1', 'thread-race'),
			openBrandHarnessSession('b1', 'r1', 'a1', 'thread-race')
		]);
		expect(openCalls).toHaveLength(1);
		expect(a).toBe(b);
	});

	/**
	 * `dropLiveHarnessSession` rilasciava la sandbox SOLO se esisteva anche una sessione harness
	 * in `moduleLiveSessions` — se l'harness non arrivava mai a cacciarsi lì (un `startHarnessTurn`
	 * mai chiamato, o fallito prima di scriverci), l'`if (!entry) return` usciva subito e la
	 * sandbox restava aperta per sempre nella mappa module-level. Qui non si passa da `live.ts`:
	 * si chiama solo `openBrandHarnessSession`, quindi `moduleLiveSessions` resta vuota — la
	 * riprova diretta del difetto.
	 */
	it('rilascia la sandbox anche senza una sessione harness cacciata per la stessa chiave', async () => {
		await openBrandHarnessSession('b1', 'r1', 'a1', 'thread-orphan-sandbox');
		await dropLiveHarnessSession('thread-orphan-sandbox');
		expect(sandboxReleases[0]).toHaveBeenCalledOnce();
	});

	it('dopo il drop, la stessa sessionKey riapre una sandbox nuova', async () => {
		await openBrandHarnessSession('b1', 'r1', 'a1', 'thread-reopen');
		await dropLiveHarnessSession('thread-reopen');
		await openBrandHarnessSession('b1', 'r2', 'a1', 'thread-reopen');
		expect(openCalls).toHaveLength(2);
	});
});

describe('resolveHarnessModelRef — la catena preferenza → tier → lista, tutta sul centralino', () => {
	beforeEach(() => {
		for (const key of Object.keys(env)) {
			if (/MODEL|MODELS|PROVIDER|API_KEY/.test(key)) delete env[key];
		}
	});

	it('senza il centralino configurato torna null', () => {
		expect(resolveHarnessModelRef({ tier: 'pro' })).toBeNull();
	});

	it('la preferenza famiglia vale quando il centralino serve quel modello', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
		env.LLM_MODELS = 'z-ai/glm-5.3-flash,x-ai/grok-4-6';
		const ref = resolveHarnessModelRef({ family: 'grok', tier: 'fast' });
		expect(ref).toEqual({ provider: 'llm', id: 'llm/x-ai/grok-4-6', label: 'grok-4-6' });
	});

	/**
	 * Il picker offre il catalogo del gateway e il tier PUÒ essere un id di modello. Qui veniva
	 * ignorato e si finiva sul primo di LLM_MODELS: il menu diceva un nome e rispondeva un altro
	 * modello — visto nel browser, non nei test, con il default di brand su qwen e il turno su
	 * deepseek.
	 */
	it('un id del catalogo scelto dall\'utente arriva al gateway', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
		env.LLM_MODELS = 'z-ai/glm-5.3-flash,openai/gpt-5.6-sol';
		expect(resolveHarnessModelRef({ tier: 'openai/gpt-5.6-sol' })?.id).toBe('llm/openai/gpt-5.6-sol');
		// La preferenza salvata sul thread porta l'id nel campo `model`: vince sulla famiglia, che
		// lì dentro dice solo la scala di ragionamento.
		expect(resolveHarnessModelRef({ family: 'luna', model: 'openai/gpt-5.6-sol', tier: 'fast' })?.id).toBe(
			'llm/openai/gpt-5.6-sol'
		);
	});

	it('un id che il gateway non serve non diventa una chiamata persa', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
		env.LLM_MODELS = 'z-ai/glm-5.3-flash';
		expect(resolveHarnessModelRef({ tier: 'vendor/mai-visto' })?.id).toBe('llm/z-ai/glm-5.3-flash');
	});

	it('una famiglia che il centralino non serve degrada sul default, mai sul wireId nudo', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
		env.LLM_MODELS = 'z-ai/glm-5.3-flash,openai/gpt-5.6-sol';
		expect(resolveHarnessModelRef({ family: 'luna' })?.id).toBe('llm/z-ai/glm-5.3-flash');
	});

	it('una famiglia che non esiste degrada sul default', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
		env.LLM_MODELS = 'z-ai/glm-5.3-flash,openai/gpt-5.6-sol';
		expect(resolveHarnessModelRef({ family: 'inesistente' })?.id).toBe('llm/z-ai/glm-5.3-flash');
	});

	/**
	 * Un preset in ingresso non sceglie piu` niente. Contava il SECONDO id di LLM_MODELS, che era
	 * il modo piu` sorprendente possibile di scegliere un modello: per posizione in una lista.
	 */
	it('un preset sparito non sale piu\' al secondo id della lista', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
		env.LLM_MODELS = 'z-ai/glm-5.3-flash,openai/gpt-5.6-sol';
		for (const gone of ['auto', 'fast', 'pro']) {
			expect(resolveHarnessModelRef({ tier: gone })?.id).toBe('llm/z-ai/glm-5.3-flash');
		}
	});

	it('senza tier né famiglia: il primo della lista dichiarata', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_MODELS = 'stealth/ox-alpha, openai/gpt-5.6-luna';
		const ref = resolveHarnessModelRef({});
		expect(ref?.id).toBe('llm/stealth/ox-alpha');
	});

	it('chiave ma lista e default vuoti: niente da risolvere, null', () => {
		env.LLM_API_KEY = 'k';
		expect(resolveHarnessModelRef()).toBeNull();
		expect(resolveHarnessModelRef('auto')).toBeNull();
	});
});


/**
 * IL SEAM verso le superfici che chiamano `streamText` da sole invece di passare dal runtime
 * dell'harness — oggi il motion video, inchiodato a `google(...)`. La conoscenza del provider
 * (base url, chiave, quale env porta quale tier) resta in questo file: chi lo usa chiede un tier.
 */
describe('harnessSdkModel — un modello dell’AI SDK sul centralino', () => {
	beforeEach(() => {
		for (const key of Object.keys(env)) {
			if (/MODEL|MODELS|PROVIDER|API_KEY/.test(key)) delete env[key];
		}
	});

	it('senza il centralino configurato torna null', () => {
		expect(harnessSdkModel('pro')).toBeNull();
	});

	it('risolve il tier del picker e lo dichiara come llm', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
		env.LLM_MODELS = 'z-ai/glm-5.3-flash,openai/gpt-5.6-sol';
		const m = harnessSdkModel();
		expect(m?.provider).toBe('llm');
		expect(m?.modelId).toBe('z-ai/glm-5.3-flash');
		expect(m?.model).toBeTruthy();
	});

	it('le env dei provider legacy non attivano più niente', () => {
		env.OPENROUTER_API_KEY = 'k';
		env.OPENROUTER_MODELS = 'z-ai/glm-5.3-flash';
		env.CHAT_PROVIDER = 'openrouter';
		env.HARNESS_PROVIDER = 'kie';
		env.KIE_API_KEY = 'k';
		expect(harnessSdkModel('pro')).toBeNull();
	});
});

/**
 * UNA SESSIONE ABORTITA NON SI EREDITA — 26/8, regressione dello Stop.
 *
 * Da quando Stop aborta davvero il turno, la sessione viva resta con un turno NON finito. Il
 * messaggio successivo la ritrovava in cache, provava a drenarla con `continueGenerate` e
 * moriva: «Harness session ... already has a turn in progress». Cioe` fermare una chat la
 * rompeva per il turno dopo — il contrario di cio` che Stop deve fare.
 *
 * Riusare una sessione e` un'ottimizzazione; ricrearla costa un avvio. Quindi ogni inciampo nel
 * riuso sfratta la voce e si riparte puliti, invece di propagare una sessione avvelenata.
 */
describe('startHarnessTurn — il riuso della sessione non puo` rompere il turno dopo', async () => {
	const fs = await import('node:fs');
	const src = fs.readFileSync(new URL('./adapters.ts', import.meta.url), 'utf8');
	const reuse = src.slice(src.indexOf('const cached = opts.sessionKey'), src.indexOf('const session = opts.resumeFrom'));

	it('il drenaggio della sessione in cache e` protetto, non solo l’attesa del testo', () => {
		// `continueGenerate` stesso lanciava: il try copriva solo `await drained.text`, quindi il
		// try che conta deve aprirsi PRIMA di lui e restare aperto fino allo sfratto.
		expect(reuse).toMatch(/try\s*\{[\s\S]*continueGenerate[\s\S]*catch[\s\S]*liveSessions\.delete/);
	});

	it('un riuso fallito sfratta la sessione invece di ripropagarla', () => {
		expect(reuse).toMatch(/liveSessions\.delete|moduleLiveSessions\.delete/);
	});
});

/**
 * IL LIMBO — 26/8.
 *
 * Due vite che nessuno riconciliava: la riga `agent_kit_runs`, che il FE mostra e che decide
 * «sta generando» e la coda, e la sessione harness in memoria, per thread, che il FE non vede.
 * Un turno morto a meta` chiudeva la prima e lasciava la seconda con un turno NON chiuso — e
 * `destroy()` per contratto non la tocca finche` e` in cache, perche` esiste per riusarla.
 *
 * Risultato: il run risulta chiuso, il FE non mostra niente, l'utente scrive — e il messaggio
 * eredita la sessione avvelenata e muore uguale. Ogni messaggio successivo, finche` qualcuno non
 * premeva Stop. Il riuso protetto piu` sotto lo ripara quando inciampa; questo lo previene, che
 * e` la differenza fra «il primo messaggio dopo il guasto si perde» e «non si perde».
 */
describe('dropLiveHarnessSession — un turno morto non lascia in eredita` la sua sessione', async () => {
	const { dropLiveHarnessSession } = await import('./adapters');
	const fs = await import('node:fs');

	it('esiste, ed e` innocuo su una chiave che non c’e`', async () => {
		await expect(dropLiveHarnessSession('mai-vista')).resolves.toBeUndefined();
		await expect(dropLiveHarnessSession(undefined)).resolves.toBeUndefined();
	});

});
