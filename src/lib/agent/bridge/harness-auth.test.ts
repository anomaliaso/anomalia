/**
 * IL MODELLO CHE CHIEDIAMO E IL PROVIDER CHE RISPONDE devono essere gli stessi. Un turno è finito
 * in un 403 del gateway Vercel su `zai/glm-5.1` mentre il log diceva `gemini-3.8-flash`: l'id che
 * avevamo scelto non era fra quelli dichiarati all'harness, e con una chiave del gateway
 * nell'ambiente `harness-pi` ripiega lì da solo — `pi-model-resolver` cerca un match sul provider
 * `vercel-ai-gateway` PRIMA del nostro. Questi test recintano le due metà.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { harnessCredentials, ensureKieAgentDir, resolveHarnessModelRef } = await import('./adapters');
const { env } = await import('$env/dynamic/private');

const GATEWAY_KEYS = ['AI_GATEWAY_API_KEY', 'AI_GATEWAY_BASE_URL', 'VERCEL_OIDC_TOKEN'];

describe('harnessCredentials — quello che consegniamo a pi', () => {
	beforeEach(() => {
		for (const key of Object.keys(env)) {
			if (/MODEL|MODELS|API_KEY|BASE_URL|OIDC/.test(key)) delete env[key];
		}
	});

	it('non porta MAI una credenziale del gateway, per quanto ce ne siano nell ambiente', () => {
		env.LLM_API_KEY = 'k';
		env.AI_GATEWAY_API_KEY = 'vck_qualcosa';
		env.AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh';
		env.VERCEL_OIDC_TOKEN = 'oidc-qualcosa';

		const creds = harnessCredentials();

		for (const key of GATEWAY_KEYS) expect(creds[key]).toBeUndefined();
	});

	it('porta le chiavi dei provider che usiamo davvero', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_BASE_URL = 'https://openrouter.ai/api/v1';
		env.ANTHROPIC_API_KEY = 'sk-ant';

		const creds = harnessCredentials();

		expect(creds.LLM_API_KEY).toBe('k');
		expect(creds.LLM_BASE_URL).toBe('https://openrouter.ai/api/v1');
		expect(creds.ANTHROPIC_API_KEY).toBe('sk-ant');
	});

	it('senza nemmeno una chiave torna vuoto: non si dichiara una configurazione che non c e', () => {
		expect(Object.keys(harnessCredentials())).toHaveLength(0);
	});
});

describe('ensureKieAgentDir — l harness conosce il modello che stiamo per chiedere', () => {
	beforeEach(() => {
		for (const key of Object.keys(env)) {
			if (/MODEL|MODELS|API_KEY|BASE_URL|OIDC/.test(key)) delete env[key];
		}
	});

	function declaredIn(dir: string): string[] {
		const parsed = JSON.parse(readFileSync(join(dir, 'models.json'), 'utf8'));
		return parsed.providers.llm.models.map((m: { id: string }) => m.id);
	}

	/**
	 * IL DIFETTO, NUDO: `LLM_MODELS` elenca due id, il turno ne chiede un terzo (il default del
	 * catalogo, che vive nel database e non in questa lista). Prima di qui il file non lo
	 * dichiarava, pi non lo conosceva e il turno finiva sul gateway.
	 */
	it('il modello del turno è dichiarato anche quando non sta in LLM_MODELS', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_MODELS = 'deepseek/deepseek-v4-flash-vision-exp,openai/gpt-5.6-sol';

		const dir = ensureKieAgentDir('google/gemini-3.8-flash');

		expect(dir).toBeTruthy();
		expect(declaredIn(dir as string)).toContain('google/gemini-3.8-flash');
	});

	it('lo scope `llm/` del ref non entra nel file: pi cerca l id nudo dentro il provider', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_MODELS = 'openai/gpt-5.6-sol';

		const ref = resolveHarnessModelRef({ tier: 'openai/gpt-5.6-sol' });
		const dir = ensureKieAgentDir(ref?.id);

		expect(ref?.id).toBe('llm/openai/gpt-5.6-sol');
		expect(declaredIn(dir as string)).toContain('openai/gpt-5.6-sol');
		expect(declaredIn(dir as string)).not.toContain('llm/openai/gpt-5.6-sol');
	});

	it('un id già dichiarato non si duplica', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_MODELS = 'openai/gpt-5.6-sol';

		const declared = declaredIn(ensureKieAgentDir('openai/gpt-5.6-sol') as string);

		expect(declared.filter((id) => id === 'openai/gpt-5.6-sol')).toHaveLength(1);
	});
});

describe('startHarnessTurn — le due metà arrivano davvero a pi', () => {
	const source = readFileSync(new URL('./adapters.ts', import.meta.url), 'utf8');

	it('dichiara il modello del turno, non solo la lista dell env', () => {
		expect(source).toMatch(/ensureKieAgentDir\(\s*opts\.model\.id/);
	});

	it('passa le credenziali come customEnv, che è ciò che spegne il ramo gateway di pi', () => {
		expect(source).toMatch(/auth:\s*\{\s*customEnv/);
	});
});
