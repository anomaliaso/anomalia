import { describe, expect, it, beforeEach } from 'vitest';

const { motionAgentModel } = await import('./model');
const { env } = await import('$env/dynamic/private');

/**
 * Il 26/8 l'agente motion e` morto tre volte in un secondo: `@ai-sdk/google@3` risolve
 * `provider-utils@4` mentre `ai@7` normalizza con la 5, e ogni immagine allegata arrivava a
 * Gemini come oggetto invece che base64. Il pin su Google non era una scelta di qualita`, era
 * una riga cablata in mezzo al turno — e costava 20x il modello che il provider attivo serve.
 */
describe('motionAgentModel — il motion segue il centralino, non Google cablato', () => {
	beforeEach(() => {
		for (const key of Object.keys(env)) {
			if (/MODEL|MODELS|PROVIDER|API_KEY/.test(key)) delete env[key];
		}
	});

	/**
	 * SCRIVERE UNA COMPOSIZIONE NON E` UN LAVORO DA MODELLO VELOCE. Il 26/8 `glm-5.3-flash` ha
	 * girato 23 minuti su un brief senza scrivere una riga di sorgente: 95% dell'output in
	 * ragionamento, zero lavoro.
	 *
	 * Quella protezione era il preset Pro — il SECONDO id di LLM_MODELS — e con i preset se n'e`
	 * andata: il motion segue il default come tutto il resto. La scappatoia esplicita
	 * `MOTION_VIDEO_MODEL` e` l'unica cosa che rimane fra un default flash e quei 23 minuti, ed e`
	 * il test qui sotto a tenerla in piedi.
	 */
	it('la composizione segue il default del centralino', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
		env.LLM_MODELS = 'z-ai/glm-5.3-flash,openai/gpt-5.6-sol';
		const m = motionAgentModel();
		expect(m.provider).toBe('llm');
		expect(m.modelId).toBe('z-ai/glm-5.3-flash');
	});

	it('MOTION_VIDEO_MODEL resta la scappatoia esplicita e vince sul picker del centralino', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
		env.MOTION_VIDEO_MODEL = 'gemini-3.7-flash';
		const m = motionAgentModel();
		expect(m.modelId).toBe('gemini-3.7-flash');
		expect(m.provider).toBe('llm');
	});

	it('senza lista né scappatoia cade sul default del centralino, dichiarandolo', () => {
		env.LLM_API_KEY = 'k';
		env.LLM_DEFAULT_MODEL = 'google/gemini-2.5-flash';
		const m = motionAgentModel();
		expect(m.provider).toBe('llm');
		expect(m.modelId).toBe('google/gemini-2.5-flash');
	});
});
