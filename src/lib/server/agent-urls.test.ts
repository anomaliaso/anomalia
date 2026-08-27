import { describe, expect, it } from 'vitest';
import { AGENT_URL_POLICY, brandReferenceUrl, inspectOnlyUrl, openUrl } from './agent-urls';

// Il permesso deve stare NEL DATO. Se un domani `use` sparisse dal payload, l'agente tornerebbe a
// indovinare cosa fare di un mp4 altrui — e la risposta sbagliata costa una clip pagata.
describe('agent url payload', () => {
	// Erano DUE fino al 23/8/2026: `review_video` è uscito perché è stato smontato dagli agenti di
	// chat (CHAT_REVIEW_VIDEO_ENABLED in chat/agents.ts). `tools` è una promessa attaccata al dato —
	// l'URL dice quali strumenti lo accettano — quindi nominarne uno che il modello non ha in mano
	// è peggio di non nominarne nessuno: lo manda a chiamare il vuoto su un mp4 di un terzo.
	// Da un video altrui esce comunque solo testo, e a produrlo resta `breakdown_reference_video`.
	it('a competitor clip is inspect_only and names the only tool that may touch it', () => {
		const u = inspectOnlyUrl('https://video.xx.fbcdn.net/hd.mp4', 'video', 'competitor ad video');
		expect(u.use).toBe('inspect_only');
		expect(u.owner).toBe('competitor');
		expect(u.tools).toEqual(['breakdown_reference_video']);
		expect(AGENT_URL_POLICY).not.toContain('review_video');
	});

	it('a competitor still has no tool at all — it is looked at, not fed to anything', () => {
		expect(inspectOnlyUrl('https://scontent.xx.fbcdn.net/a.jpg', 'image', 'still').tools).toEqual(
			[]
		);
	});

	it('brand media is the only category a generation accepts', () => {
		const img = brandReferenceUrl('https://ours/p.jpg', 'image', 'product photo');
		expect(img.use).toBe('reference');
		expect(img.owner).toBe('brand');
		expect(img.tools).toContain('generate_image');
		expect(brandReferenceUrl('https://ours/c.mp4', 'video', 'clip').tools).toEqual([
			'generate_video'
		]);
	});

	it('an ad page is for the human, not for a tool', () => {
		const u = openUrl('https://www.facebook.com/ads/library/?id=1', 'this ad on Meta');
		expect(u.use).toBe('open');
		expect(u.kind).toBe('page');
		expect(u.tools).toEqual([]);
	});

	it('the policy states the rule the categories encode', () => {
		expect(AGENT_URL_POLICY).toContain('inspect_only');
		expect(AGENT_URL_POLICY).toContain('reference');
		expect(AGENT_URL_POLICY).toContain('never pass it to a generation');
	});
});
