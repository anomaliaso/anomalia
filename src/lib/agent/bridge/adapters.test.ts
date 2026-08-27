import { describe, expect, it, vi, beforeEach } from 'vitest';

const openCalls: Array<Record<string, unknown>> = [];

vi.mock('$lib/server/sandbox', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		openBrandSandbox: async (opts: Record<string, unknown>) => {
			openCalls.push(opts);
			return { name: 'anomalia-b1-research-g2', raw: {} };
		}
	};
});

vi.mock('@ai-sdk/sandbox-vercel', () => ({
	createVercelSandbox: () => ({ createSession: async () => ({ fake: true }) })
}));

const { openBrandHarnessSession, resolveHarnessModelRef, harnessSdkModel } = await import('./adapters');
const { KIE_LUNA_MODEL } = await import('$lib/server/kie');
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

describe('resolveHarnessModelRef — la catena preferenza → tier → env → lista', () => {
	beforeEach(() => {
		for (const key of Object.keys(env)) {
			if (/MODEL|MODELS|PROVIDER|API_KEY/.test(key)) delete env[key];
		}
	});

	it('senza provider configurato torna null', () => {
		expect(resolveHarnessModelRef({ tier: 'pro' })).toBeNull();
	});

	it('la preferenza famiglia servibile dal provider attivo vince sul tier', () => {
		env.KIE_API_KEY = 'k';
		const ref = resolveHarnessModelRef({ family: 'grok', tier: 'fast' });
		expect(ref).toEqual({ provider: 'kie', id: 'kie/grok-4-6', label: 'grok-4-6' });
	});

	it('una famiglia di un altro provider degrada sul tier, non si forza', () => {
		env.OPENROUTER_API_KEY = 'o';
		env.OPENROUTER_PRO_MODEL = 'vendor/pro-model';
		const ref = resolveHarnessModelRef({ family: 'grok', tier: 'pro' });
		expect(ref?.id).toBe('openrouter/vendor/pro-model');
	});

	it('il tier del turno arriva davvero al provider non-kie', () => {
		env.OPENCODE_API_KEY = 'x';
		env.OPENCODE_FAST_MODEL = 'oc-fast';
		expect(resolveHarnessModelRef({ tier: 'fast' })?.id).toBe('opencode/oc-fast');
	});

	it('il tier mappa la famiglia di catalogo quando il provider la serve (kie pro → grok)', () => {
		env.KIE_API_KEY = 'k';
		expect(resolveHarnessModelRef({ tier: 'pro' })?.id).toBe('kie/grok-4-6');
		expect(resolveHarnessModelRef({ tier: 'auto' })?.id).toBe(`kie/${KIE_LUNA_MODEL}`);
	});

	it('senza *_MODEL ma con la lista dichiarata: il primo della lista', () => {
		env.OPENROUTER_API_KEY = 'o';
		env.OPENROUTER_MODELS = 'stealth/ox-alpha, openai/gpt-5.6-luna';
		const ref = resolveHarnessModelRef({ tier: 'auto' });
		expect(ref?.id).toBe('openrouter/stealth/ox-alpha');
	});

	it("il fallback 'ox-alpha' è morto: env e lista assenti → null", () => {
		env.OPENROUTER_API_KEY = 'o';
		const ref = resolveHarnessModelRef({ tier: 'pro' });
		if (ref) console.log('RESIDUAL REF', JSON.stringify(ref));
		expect(ref).toBeNull();
		expect(resolveHarnessModelRef()).toBeNull();
	});
});


/**
 * IL SEAM verso le superfici che chiamano `streamText` da sole invece di passare dal runtime
 * dell'harness — oggi il motion video, inchiodato a `google(...)`. La conoscenza del provider
 * (base url, chiave, quale env porta quale tier) resta in questo file: chi lo usa chiede un tier.
 */
describe('harnessSdkModel — un modello dell’AI SDK sul provider attivo', () => {
	beforeEach(() => {
		for (const key of Object.keys(env)) {
			if (/MODEL|MODELS|PROVIDER|API_KEY/.test(key)) delete env[key];
		}
	});

	it('senza provider configurato torna null, invece di cadere su Google in silenzio', () => {
		expect(harnessSdkModel('pro')).toBeNull();
	});

	it('col provider attivo risolve il modello del tier e lo dichiara come tale', () => {
		env.OPENROUTER_API_KEY = 'k';
		env.CHAT_PROVIDER = 'openrouter';
		env.OPENROUTER_FAST_MODEL = 'z-ai/glm-5.3-flash';
		const m = harnessSdkModel('fast');
		expect(m?.provider).toBe('openrouter');
		expect(m?.modelId).toBe('z-ai/glm-5.3-flash');
		expect(m?.model).toBeTruthy();
	});

	it('cade sulla lista dichiarata quando il tier non ha un env suo', () => {
		env.OPENROUTER_API_KEY = 'k';
		env.CHAT_PROVIDER = 'openrouter';
		env.OPENROUTER_MODELS = 'z-ai/glm-5.3-flash,qwen/qwen3.8-27b';
		expect(harnessSdkModel('pro')?.modelId).toBe('z-ai/glm-5.3-flash');
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

	it('il motore lo chiama quando il turno finisce male', () => {
		const src = fs.readFileSync(new URL('./live.ts', import.meta.url), 'utf8');
		expect(src).toContain('dropLiveHarnessSession');
		// Sul percorso d'errore, non solo su quello felice.
		const errAt = src.indexOf('Errore del turno: ${why');
		const catchAt = src.lastIndexOf('} catch (error) {', errAt);
		expect(src.slice(catchAt, errAt + 400)).toContain('dropLiveHarnessSession');
	});
});
