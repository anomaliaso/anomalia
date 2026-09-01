/**
 * LE PROTEZIONI CHE v1 AVEVA E IL KIT NO.
 *
 * Quattro ricerche parallele sui due motori, 25/8. Il kit vinceva sulla durabilità (chiusura
 * atomica, battito attorno ai tool, scoperta attiva dello sfratto) e perdeva su ciò che v1 aveva
 * imparato in mesi di produzione. Questi test pinnano le tre voci riparate — non descrivono un
 * desiderio, tengono ferme tre righe che erano già state dimenticate una volta.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const BRIDGE = readFileSync('src/lib/agent/bridge/live.ts', 'utf8');
const QUEUE = readFileSync('src/lib/server/chat/queue.ts', 'utf8');
const PAGE = readFileSync('src/routes/app/[brand]/chat/[thread]/+page.svelte', 'utf8');
const CHAT = readFileSync('src/routes/app/[brand]/chat/+server.ts', 'utf8');
// Il ritmo del poll vive ora nel modulo estratto col resto del run orfano.
const KIT_RUN = readFileSync('src/routes/app/[brand]/chat/components/kit-run.ts', 'utf8');

describe('il kit ha le protezioni che il motore classico aveva già', () => {
	it('gli errori escono dalla riga del run: Sentry, PostHog, la mail agli ops', () => {
		// Prima esistevano solo in `agent_kit_runs.question`, e per trovarli bisognava sapere già
		// dove guardare: il 25/8 è costato mezz'ora di query scoprire una manutenzione di kie.
		expect(BRIDGE).toMatch(/reportChatError\(/);
	});

	it('il tetto degli step è quello di v1, non il valore con cui il kit è nato', () => {
		expect(BRIDGE).toMatch(/TURN_MAX_STEPS = 75/);
		expect(BRIDGE).not.toMatch(/stepCountIs\(20\)/);
	});

	it('la coda compatta PRIMA di caricare la storia, anche nel ramo kit', () => {
		// Il ramo kit usciva prima della compattazione del percorso classico: i turni accodati non
		// venivano compattati mai. Ed è il posto peggiore in cui saltarla — la coda serve le
		// continuazioni e i turni schedulati, cioè proprio i thread che diventano lunghi.
		const bivio = QUEUE.indexOf('const kitSpec = shouldUseKit');
		const compattaDopoIlBivio = QUEUE.indexOf('maybeCompactThread', bivio);
        const caricaStoria = QUEUE.indexOf('loadHistory', bivio);
		expect(bivio).toBeGreaterThan(-1);
		expect(compattaDopoIlBivio).toBeGreaterThan(-1);
		expect(compattaDopoIlBivio).toBeLessThan(caricaStoria);
	});

	it('il client chiede lo stato di un turno vivo al ritmo di v1, non tre volte più lento', () => {
		expect(KIT_RUN).toMatch(/LIVE_POLL_MS = 350/);
		expect(PAGE).not.toMatch(/setInterval\(poll, 1_200\)/);
	});

	it('il ramo interattivo porta il persona del custom agent al bridge, come la coda', () => {
		// Il classico montava customAgentSystemBlock nel prompt; il ramo kit buttava via systemPrompt
		// e con lui il brief dell'utente: meno parità della coda, che l'overlay lo porta già (26/8).
		const bivio = CHAT.indexOf('const kitSpec = shouldUseKit');
		const fine = CHAT.indexOf('--- fine AGENT_KIT ---', bivio);
		const ramo = CHAT.slice(bivio, fine);
		expect(bivio).toBeGreaterThan(-1);
		expect(fine).toBeGreaterThan(bivio);
		expect(ramo).toContain('persona: kitPersona');
		expect(ramo).toMatch(/kitPersonaOverlay\(persona, bilingualNoticeLocale\(locale\)\)/);
	});
});
