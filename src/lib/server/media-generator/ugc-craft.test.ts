import { describe, expect, it, beforeEach, vi } from 'vitest';

const { env } = await import('$env/dynamic/private');
const { craftAgentModel } = await import('$lib/server/craft-model');
const { ugcAgentModel, buildCraftPrompt, craftUgcShotBrief } = await import('./ugc-craft');
const { buildUgcShotBrief, formatUgcShotBrief } = await import('$lib/server/ugc');

/**
 * LA RESA DI UN VIDEO GENERATIVO NON È IL TIER VELOCE — stessa misura del motion: il brief che
 * il generatore esegue è la cosa più difficile che il prodotto chiede a un modello, e la chat
 * (o il planner flash) resta sul veloce mentre questa resa no. `ugcAgentModel` segue il
 * provider attivo dell'harness con tier PRO, come `motionAgentModel`.
 */
describe('ugcAgentModel — la resa UGC segue il provider attivo, non il flash cablato', () => {
	beforeEach(() => {
		for (const key of Object.keys(env)) {
			if (/MODEL|MODELS|PROVIDER|API_KEY/.test(key)) delete env[key];
		}
	});

	it('la resa prende il tier PRO del provider attivo', () => {
		env.OPENROUTER_API_KEY = 'k';
		env.CHAT_PROVIDER = 'openrouter';
		env.OPENROUTER_FAST_MODEL = 'z-ai/glm-5.3-flash';
		env.OPENROUTER_PRO_MODEL = 'openai/gpt-5.6-sol';
		const m = ugcAgentModel();
		expect(m.provider).toBe('openrouter');
		expect(m.modelId).toBe('openai/gpt-5.6-sol');
	});

	it('UGC_VIDEO_MODEL è la scappatoia esplicita e vince sul provider', () => {
		env.OPENROUTER_API_KEY = 'k';
		env.CHAT_PROVIDER = 'openrouter';
		env.OPENROUTER_PRO_MODEL = 'openai/gpt-5.6-sol';
		env.UGC_VIDEO_MODEL = 'gemini-3.7-flash';
		const m = ugcAgentModel();
		expect(m.modelId).toBe('gemini-3.7-flash');
		expect(m.provider).toBe('gemini');
	});

	it('craftAgentModel è la stessa fabbrica del motion: nessuna seconda fonte di verità', async () => {
		const { motionAgentModel } = await import('$lib/server/motion-video/model');
		env.OPENROUTER_API_KEY = 'k';
		env.CHAT_PROVIDER = 'openrouter';
		env.OPENROUTER_PRO_MODEL = 'openai/gpt-5.6-sol';
		const viaShared = craftAgentModel({ envModel: env.UGC_VIDEO_MODEL, fallbackId: 'gemini-3.7-flash' });
		expect(viaShared.modelId).toBe('openai/gpt-5.6-sol');
		expect(motionAgentModel().modelId).toBe('openai/gpt-5.6-sol');
	});
});

describe('craftUgcShotBrief — il secondo agente scrive la resa, il deterministico è la rete', () => {
	const base = buildUgcShotBrief({
		seconds: 12,
		hook: 'Still drowning in spreadsheets',
		hookVisual: 'close-up on a cluttered desk',
		format: 'tutorial',
		platform: 'tiktok',
		product: 'FlowDeck',
		setting: 'a home office at night',
		person: 'Maya',
		desire: 'look competent'
	});
	const baseBrief = formatUgcShotBrief(base, { script: 'you close books in minutes', product: 'FlowDeck' });

	it('il prompt porta hook, setting, prodotto, battuto, riferimenti e il divieto di toccare le RULE', () => {
		const p = buildCraftPrompt({
			baseBrief,
			script: 'you close books in minutes',
			product: 'FlowDeck',
			platform: 'tiktok',
			seconds: 12,
			hook: 'Still drowning in spreadsheets',
			setting: 'a home office at night',
			person: 'Maya',
			references: ['@Image1 is the product cover']
		});
		expect(p).toContain('Still drowning in spreadsheets');
		expect(p).toContain('a home office at night');
		expect(p).toContain('FlowDeck');
		expect(p).toContain('you close books in minutes');
		expect(p).toContain('@Image1 is the product cover');
		// Le invarianti di sicurezza del generatore non sono negoziabili: il crafter non le riscrive.
		expect(p).toMatch(/RULE lines? verbatim|keep every RULE/i);
	});

	it('il modello risponde: il brief craftato torna pulito', async () => {
		const out = await craftUgcShotBrief(
			{ baseBrief, product: 'FlowDeck', platform: 'tiktok', seconds: 12 },
			async () => '  CRAFTED BRIEF — RULE lines kept verbatim  \n'
		);
		expect(out).toBe('CRAFTED BRIEF — RULE lines kept verbatim');
	});

	it('modello a terra o muto: si torna al brief deterministico, mai un render senza brief', async () => {
		const down = await craftUgcShotBrief(
			{ baseBrief, product: 'FlowDeck', platform: 'tiktok', seconds: 12 },
			async () => {
				throw new Error('provider down');
			}
		);
		expect(down).toBe(baseBrief);

		const mute = await craftUgcShotBrief(
			{ baseBrief, product: 'FlowDeck', platform: 'tiktok', seconds: 12 },
			async () => '   '
		);
		expect(mute).toBe(baseBrief);
	});
});
