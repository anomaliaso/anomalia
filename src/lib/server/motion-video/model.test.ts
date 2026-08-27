import { describe, expect, it, beforeEach } from 'vitest';

const { motionAgentModel } = await import('./model');
const { env } = await import('$env/dynamic/private');

/**
 * Il 26/8 l'agente motion e` morto tre volte in un secondo: `@ai-sdk/google@3` risolve
 * `provider-utils@4` mentre `ai@7` normalizza con la 5, e ogni immagine allegata arrivava a
 * Gemini come oggetto invece che base64. Il pin su Google non era una scelta di qualita`, era
 * una riga cablata in mezzo al turno — e costava 20x il modello che il provider attivo serve.
 */
describe('motionAgentModel — il motion segue il provider attivo, non Google cablato', () => {
	beforeEach(() => {
		for (const key of Object.keys(env)) {
			if (/MODEL|MODELS|PROVIDER|API_KEY/.test(key)) delete env[key];
		}
	});

	/**
	 * SCRIVERE UNA COMPOSIZIONE NON E` IL TIER VELOCE. Il 26/8 `glm-5.3-flash` ha girato 23
	 * minuti su un brief e non ha scritto una riga di sorgente: 95% dell'output in ragionamento,
	 * zero lavoro. La chat resta sul tier veloce; questo mestiere no.
	 */
	it('la composizione prende il tier PRO del provider, non quello veloce', () => {
		env.OPENROUTER_API_KEY = 'k';
		env.CHAT_PROVIDER = 'openrouter';
		env.OPENROUTER_FAST_MODEL = 'z-ai/glm-5.3-flash';
		env.OPENROUTER_PRO_MODEL = 'openai/gpt-5.6-sol';
		const m = motionAgentModel();
		expect(m.provider).toBe('openrouter');
		expect(m.modelId).toBe('openai/gpt-5.6-sol');
	});

	it('MOTION_VIDEO_MODEL resta la scappatoia esplicita e vince sul provider del centralino', () => {
		env.LLM_API_KEY = 'k';
		env.CHAT_PROVIDER = 'openrouter';
		env.OPENROUTER_API_KEY = 'k';
		env.OPENROUTER_PRO_MODEL = 'openai/gpt-5.6-sol';
		env.MOTION_VIDEO_MODEL = 'gemini-3.7-flash';
		const m = motionAgentModel();
		expect(m.modelId).toBe('gemini-3.7-flash');
		expect(m.provider).toBe('llm');
	});

	it('senza nessun provider dell’harness cade sul centralino (llm), dichiarandolo', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_DEFAULT_MODEL = 'google/gemini-2.5-flash';
		const m = motionAgentModel();
		expect(m.provider).toBe('llm');
		expect(m.modelId).toBe('google/gemini-2.5-flash');
	});
});
