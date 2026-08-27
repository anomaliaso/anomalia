import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pickTools } from '$lib/server/chat/agents';
import { createChatTools } from '$lib/server/chat/tools';

/**
 * The studio agent and the chat's motion specialist are the same agent on two surfaces. This pins
 * the difference to a reviewed list instead of letting it drift back to fifteen tools against
 * sixty-three, which is what it was.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CHAT_MOTION = new Set(Object.keys(pickTools(createChatTools({} as any, 'b1', 'Europe/Rome', 'u1'), 'motion')));
const AGENT_SRC = readFileSync(new URL('./agent.ts', import.meta.url), 'utf8');

const excluded = () => {
	const block = AGENT_SRC.slice(
		AGENT_SRC.indexOf('const MOTION_STUDIO_EXCLUDED = new Set(['),
		AGENT_SRC.indexOf('/** The chat motion agent')
	);
	return new Set([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
};

describe('the studio takes the chat specialist’s tools', () => {
	it('spreads the scoped chat set before its own, so the selection-bound tools win', () => {
		const chat = AGENT_SRC.indexOf('...chatTools,');
		const own = AGENT_SRC.indexOf('grep_source: tool({');
		expect(chat).toBeGreaterThan(-1);
		expect(chat).toBeLessThan(own);
	});

	it('keeps what a composition actually needs', () => {
		const gone = excluded();
		for (const key of [
			'capture_website',
			'harvest_product_ui',
			'read_posts',
			'read_products',
			'read_people',
			'read_brand_kit',
			'fetch_social_thumbs',
			'read_attachment',
			// Per raggiungere chi tiene voce e identità del brand c'è il DM, non più il consulto
			// muto: il collega risponde con la sua voce, non dentro la nostra.
			'message_agent'
		]) {
			expect(CHAT_MOTION.has(key), `${key} missing from the chat motion agent`).toBe(true);
			expect(gone.has(key), `${key} should not be excluded`).toBe(false);
		}
	});

	/**
	 * `review_video` è stato in questa lista fino al 23/8/2026: lo studio prende i tool dello
	 * specialista motion della chat, e finché la chat ce l'aveva se lo ritrovava anche qui.
	 *
	 * Ora è SMONTATO alla fonte (`CHAT_REVIEW_VIDEO_ENABLED` in chat/agents.ts, filtro dentro
	 * `pickTools`) — 12 chiamate in 10 giorni e zero punteggi salvati, con il difetto vero scritto
	 * accanto all'interruttore. Lo studio lo perde di conseguenza, e va bene così: qui la review
	 * la fa `render_stills`, che i fotogrammi li rende davvero.
	 *
	 * Questo test asserisce l'ASSENZA per la stessa ragione per cui prima asseriva la presenza: se
	 * qualcuno riaccende l'interruttore, deve farlo sapendo che rientra anche di qua.
	 */
	it('non prende più review_video, perché la chat non ce l’ha più', () => {
		expect(CHAT_MOTION.has('review_video')).toBe(false);
		// Il sostituto sulla stessa superficie: guardare i fotogrammi, non chiedere un voto.
		expect(CHAT_MOTION.has('render_stills')).toBe(true);
	});

	it('drops the id-taking source tools — the studio owns those, bound to the selection', () => {
		const gone = excluded();
		for (const key of ['write_motion_source', 'replace_motion_source', 'create_motion_video']) {
			expect(gone.has(key), key).toBe(true);
		}
	});

	it('drops chat affordances this workbench cannot draw', () => {
		// A tool whose output the surface cannot render is worse than a missing one: the model asks
		// and the user never sees the question.
		const workbench = readFileSync(
			new URL('../../components/motion-video/MotionVideoWorkbench.svelte', import.meta.url),
			'utf8'
		);
		for (const key of ['ask_user_questions', 'propose_open_tab', 'offer_upgrade']) {
			expect(excluded().has(key), key).toBe(true);
			expect(workbench.includes(key), `${key} has no renderer, so it must stay excluded`).toBe(false);
		}
	});

	it('drops the goal tools — the base mounts them, and mounts them RIGHT', () => {
		// chat/tools.ts li monta senza condizioni (anche con threadId undefined — i turni di patch
		// della QC non ne hanno uno) e in attach i tool di superficie vincono le collisioni: il
		// set_goal senza thread della chat scavalcava quello condizionato di agent-base
		// (full && threadId). Esclusi qui, resta solo il mount corretto della base.
		const gone = excluded();
		for (const key of ['set_goal', 'update_goal', 'close_goal']) {
			expect(gone.has(key), key).toBe(true);
		}
	});

	/**
	 * La proprietà che conta è che il pacchetto SEO non finisca in mano allo studio, non che un
	 * certo elenco lo nomini. Dal 22/8/2026 metà di quel pacchetto non ci arriva più perché è
	 * tornato a `web` (usciva da SHARED_TOOL_KEYS, dove lo pagavano tutti e cinque), e l'altra metà
	 * continua a essere esclusa a mano. Asserire sul RISULTATO copre tutte e due le strade, e resta
	 * vera qualunque sia quella che le toglie domani.
	 */
	it('drops the SEO research pack, which cannot inform a six-second ad', () => {
		const gone = excluded();
		const studio = new Set([...CHAT_MOTION].filter((k) => !gone.has(k)));
		for (const k of ['dfs_serp', 'read_seo_plan', 'read_seo_geo_audit', 'list_articles', 'read_site_pages']) {
			expect(studio.has(k), k).toBe(false);
		}
	});

	it('every excluded name is a real tool — a typo would silently exclude nothing', () => {
		const unknown = [...excluded()].filter((k) => !CHAT_MOTION.has(k));
		expect(unknown).toEqual([]);
	});

	it('un edit marca l’anteprima come stantia — è ciò che rende legittimo il re-render della QC', () => {
		// Senza il marcatore il modello non distingue il re-render dopo-edit (necessario: la QC
		// confronta anteprima e sorgente) da quello cosmetico che il tetto giornaliero deve fermare.
		expect(AGENT_SRC).toContain('preview_stale');
		expect(AGENT_SRC).toContain('no longer matches this source');
	});

	it('names the new capability in the prompt, or the model will not reach for it', () => {
		expect(AGENT_SRC).toContain('REAL PRODUCT UI');
		expect(AGENT_SRC).toContain('capture_website(url)');
	});
});
