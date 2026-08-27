import { describe, expect, it } from 'vitest';
import { env } from '$env/dynamic/private';
import {
	AGENT_IDS,
	AGENTS,
	SHARED_TOOL_KEYS,
	WORK_ETHIC_BLOCK,
	ORCHESTRATION_BLOCK,
	pickTools,
	buildAgentHead,
	teamBlock,
	HANDOFFS,
	type AgentId
} from './agents';
import { SPECIALISTS } from '$lib/agent/specs';
import { modeSystemBlock } from '$lib/chat-modes';
import { MOTION_CRAFT_SPECS } from '$lib/motion-video/craft';
import { createChatTools } from './tools';
import { SUBAGENT_TOOL_KEYS, subagentToolNames, createSubagentTools } from './subagents';
import { SANDBOX_TOOL_KEYS, createSandboxTools } from './sandbox-tools';
import { BUILTIN_AGENT_AVATARS } from '$lib/agent-avatars';
import { AGENT_META, normalizeAgentId } from '$lib/agent-icons';

/**
 * Every tool key an agent claims must exist in the chat registry.
 *
 * `pickTools` filters by name: a key that matches nothing is dropped in silence, and the agent's
 * prompt head goes on promising a tool the model will never be handed. That is the failure this
 * whole file exists to prevent, and it is invisible until a user asks for the thing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stub = {} as any;

/**
 * IL MONTAGGIO, NELLO STESSO ORDINE DELLA PRODUZIONE — ed è la riparazione del 23/8/2026.
 *
 * Prima questo file fondeva i tre gruppi in un unico `ALL` e passava quello a `pickTools`. Ordine
 * che in produzione non esiste: là `pickTools` riceve SOLO `createChatTools`, e i tre tool di
 * delega più i sei della sandbox vengono aggiunti DOPO, da `withSubagentTools` e
 * `withSandboxTools`, sul set già filtrato (chat/+server.ts:1079 e :1093, queue.ts:675 e :689).
 *
 * Costava caro: otto di quei nomi stavano dentro `SHARED_TOOL_KEYS` dove erano INERTI — `pickTools`
 * itera `Object.keys(tools)` e quei nomi lì non c'erano — e il test li vedeva passare comunque,
 * perché era lui a metterceli. Un registro che si dà da solo la risposta che sta verificando.
 */
/**
 * Le stanze ACCESE, perché qui la domanda è un'altra.
 *
 * `create_group_chat` non si offre affatto dove `GROUP_CHATS` è spento (agent-dm-tools.ts): un tool
 * che c'è e fallisce sempre insegna al modello a promettere una stanza che non aprirà. Con la
 * feature spenta — cioè di default, cioè in CI — la chiave in `SHARED_TOOL_KEYS` risulterebbe
 * INERTE e questo file la segnalerebbe, ma per la ragione sbagliata: non è un nome scritto male,
 * è un nome che aspetta un interruttore.
 *
 * Sono due domande diverse e questo file risponde solo alla prima: **la chiave corrisponde a un
 * tool vero?** Se domani qualcuno rinomina il tool e non la chiave, il test fallisce lo stesso —
 * che è tutto ciò che gli si chiede. CHI riceve il tool a interruttore spento lo pinnano i test
 * di `agent-dm-tools.test.ts` ("feature spenta: il tool non si offre affatto").
 */
env.GROUP_CHATS = 'true';
// I tool DataForSEO esistono solo con le credenziali: senza, `createDataForSeoTools` torna {} e
// sette chiavi di `web` non risolvono. Il registro va misurato a tool tutti accesi, o il test
// dipende da cosa ha in .env chi lo lancia — e in CI, che credenziali non ne ha, è rosso sempre.
env.DATAFORSEO_USERNAME = 'test';
env.DATAFORSEO_PASSWORD = 'test';
const CHAT = createChatTools(stub, 'b1', 'Europe/Rome', 'u1');
// I tool di delega hanno bisogno del modello del turno e del set già filtrato per modalità e piano.
const SUBAGENT = createSubagentTools({ supabase: stub, brandId: 'b1', tools: {}, model: stub });
// La factory è pigra: la VM si apre alla prima chiamata di un tool, non qui. `deviceLogin` è il
// mount dell'orchestratore, che è quello che riceve un agente di chat.
const SANDBOX = createSandboxTools({
	supabase: stub,
	brandId: 'b1',
	userId: 'u1',
	agentId: 'motion',
	mode: 'compute',
	deviceLogin: true
}).tools;

/** Tutto ciò che ESISTE come tool di chat, comunque montato. */
const ALL = { ...CHAT, ...SUBAGENT, ...SANDBOX };

/** Ciò che un mestiere ha DAVVERO in mano a fine montaggio, nell'ordine vero. */
function mountedFor(id: AgentId | null): string[] {
	return Object.keys({ ...pickTools(CHAT, id), ...SUBAGENT, ...SANDBOX });
}

describe('agent registry', () => {
	it('every agent key resolves to a real tool', () => {
		const missing: string[] = [];
		for (const id of AGENT_IDS) {
			for (const key of AGENTS[id].toolKeys) {
				if (!(key in ALL)) missing.push(`${id}: ${key}`);
			}
		}
		expect(missing).toEqual([]);
	});

	/**
	 * Un nome in SHARED_TOOL_KEYS che non esiste in `createChatTools` non monta NIENTE: `pickTools`
	 * filtra le chiavi del suo argomento, e il suo argomento in produzione è solo quello. Ci sono
	 * stati otto nomi così per giorni (delegate_task, run_task_pipeline, run_parallel_tasks e i
	 * cinque sandbox_*), messi lì in buona fede da chi credeva di dare qualcosa a tutti i mestieri.
	 * Quindi il confronto è contro CHAT, non contro ALL.
	 */
	it('nessuna chiave condivisa è inerte: SHARED monta solo tool della chat', () => {
		const inert = SHARED_TOOL_KEYS.filter((k) => !(k in CHAT));
		expect(inert, 'chiavi in SHARED_TOOL_KEYS che pickTools non può montare').toEqual([]);
	});

	it('e nemmeno una chiave di mestiere', () => {
		const inert = AGENT_IDS.flatMap((id) =>
			AGENTS[id].toolKeys.filter((k) => !(k in CHAT)).map((k) => `${id}: ${k}`)
		);
		expect(inert).toEqual([]);
	});

	it('the maker agents got the tools their pages are built on', () => {
		const motion = mountedFor('motion');
		expect(motion).toContain('create_motion_video');
		expect(motion).toContain('replace_motion_source');
		expect(motion).toContain('search_motion_references');
		expect(motion).toContain('study_motion_reference');
		expect(motion).toContain('read_media');

		const media = mountedFor('content');
		expect(media).toContain('design_graphic');
		expect(media).toContain('generate_image');
		expect(media).toContain('replace_source');

		const ugc = mountedFor('ugc');
		expect(ugc).toContain('create_post');
		expect(ugc).toContain('read_talents');
		// make_video lives only in the per-post editor tool set. The main chat prompt promised it
		// anyway until this registry test went looking.
		expect(ugc).not.toContain('make_video');
	});

	/**
	 * L'INVERSO, e va scritto il perché o fra un mese qualcuno lo "ripristina".
	 *
	 * `review_video` è SMONTATO dagli agenti di chat dal 23/8/2026 — `CHAT_REVIEW_VIDEO_ENABLED`
	 * in agents.ts, filtrato dentro `pickTools`. Il nome è ancora nelle `toolKeys` di quattro
	 * mestieri e l'implementazione è intera: l'interruttore è la sola cosa da girare per riavere
	 * tutto. Quindi il test NON può guardare `toolKeys` — deve guardare cosa esce da `pickTools`,
	 * che è ciò che il modello riceve davvero.
	 *
	 * Perché è smontato: 12 chiamate in 10 giorni di vita e ZERO righe in `video_reviews`; il tool
	 * non accetta un `video_id`, quindi davanti a un motion video l'agente si costruiva una url di
	 * storage indovinando il path, oppure infilava l'id del video in `post_id` (che interroga solo
	 * `posts`) — `media_not_found` e poi `post_not_found`, due errori che non nominano il difetto.
	 *
	 * L'agente NULLO conta quanto gli altri: `pickTools(ALL, null)` restituiva tutto, ed è la
	 * strada dell'onboarding e del legacy. Uno smontaggio che una strada scavalca non è smontato.
	 */
	it('nessuno riceve review_video, e nemmeno l’agente nullo', () => {
		for (const id of AGENT_IDS) {
			expect(mountedFor(id), `${id} monta ancora review_video`).not.toContain(
				'review_video'
			);
		}
		expect(mountedFor(null)).not.toContain('review_video');
		// Ma il tool ESISTE ancora: si è smontato il montaggio, non l'implementazione.
		expect(ALL).toHaveProperty('review_video');
	});

	/**
	 * Un tool smontato ma ancora NOMINATO manda il modello a chiamare il vuoto — ed è il difetto
	 * che questo file esiste per impedire, nella direzione opposta a `every agent key resolves`.
	 */
	it('e nessun head lo nomina più', () => {
		for (const id of AGENT_IDS) {
			expect(buildAgentHead(id, 'it', 'acme', 'Acme'), id).not.toContain('review_video');
		}
	});

	it('every specialist can propose and run the recurring team', () => {
		// Il team è trasversale: chi sta parlando col cliente in quel momento deve poterlo proporre,
		// altrimenti la funzione esiste solo quando l'utente ha per caso selezionato l'agente giusto.
		for (const id of AGENT_IDS) {
			const keys = mountedFor(id);
			expect(keys).toContain('suggest_agent_team');
			expect(keys).toContain('create_scheduled_agent');
			expect(keys).toContain('list_scheduled_agents');
			expect(keys).toContain('set_scheduled_agent_enabled');
		}
	});

	it('every specialist can make the user connect a new app', () => {
		// Il difetto che ha aperto questa riga: uno specialista, alla domanda "puoi accedere a
		// Google Calendar?", rispondeva di no — e sul proprio set di tool aveva ragione, perché
		// `propose_app_connection` non stava in nessuna toolKeys né fra le condivise. La porta
		// esisteva solo per l'agente nullo e per l'onboarding.
		for (const id of AGENT_IDS) {
			expect(mountedFor(id)).toContain('propose_app_connection');
		}
	});

	it('every specialist can delegate to sub-agents', () => {
		// La delega è il modo in cui un lavoro lungo si spezza in ricerca → esecuzione → verifica.
		// Arrivano da `withSubagentTools` DOPO `pickTools` — non da SHARED_TOOL_KEYS, dove per giorni
		// i loro nomi sono stati inerti. Questo test guarda il montaggio vero, che è il solo modo in
		// cui possa dire qualcosa: sul vecchio `ALL` verificava la propria costruzione.
		for (const id of AGENT_IDS) {
			const keys = mountedFor(id);
			for (const k of SUBAGENT_TOOL_KEYS) expect(keys).toContain(k);
		}
		// E il fatto che li rende trasversali: nessuno dei due wrapper guarda l'agente.
		expect(SUBAGENT_TOOL_KEYS.every((k) => k in SUBAGENT)).toBe(true);
	});

	it('ogni specialista ha la macchina, non solo il sotto-agente sandbox', () => {
		// Prima `createSandboxTools` aveva un solo chiamante — il ruolo `sandbox` — quindi due
		// comandi al volo costavano una delega intera. Se un hub perde questi nomi, ci torna.
		for (const id of AGENT_IDS) {
			const keys = mountedFor(id);
			for (const k of SANDBOX_TOOL_KEYS) expect(keys).toContain(k);
		}
		expect(SANDBOX_TOOL_KEYS.every((k) => k in SANDBOX)).toBe(true);
	});

	it('a maker still cannot write outside its area', () => {
		const motion = mountedFor('motion');
		expect(motion).not.toContain('approve_post');
		expect(motion).not.toContain('update_brand_kit');
		expect(motion).not.toContain('generate_seo_plan');
	});

	it('each maker head names its own craft, not a generic one', () => {
		const head = (id: 'motion' | 'ugc' | 'content') => buildAgentHead(id, 'it', 'acme', 'Acme');
		expect(head('motion')).toContain('search_motion_references');
		expect(head('motion')).toContain('OUT OF REACH');
		expect(head('ugc')).toContain('sound off');
		expect(head('ugc')).toContain('consent');
		expect(head('content')).toContain('design_graphic when the piece is WORDS');
	});

	/**
	 * I consulti `ask_to_*` sono stati RIMOSSI dal prodotto: erano la macchina che produceva
	 * l'impersonazione — la risposta di un collega rientrava nel turno di chi aveva chiesto, e
	 * usciva con la voce sbagliata. In 30 giorni erano stati chiamati 3 volte. Al loro posto:
	 * i `read_*` condivisi per i fatti, `message_agent` per il giudizio (il collega risponde con
	 * la SUA identità), e dentro una stanza il passaggio di parola.
	 */
	it('nessun agente monta più un consulto a un peer', () => {
		for (const id of AGENT_IDS) {
			for (const key of mountedFor(id)) {
				expect(key.startsWith('ask_to_'), `${id} monta ancora ${key}`).toBe(false);
			}
		}
	});
});

/**
 * L'INVERSO del test qui sopra, ed è quello che è mancato.
 *
 * `every agent key resolves to a real tool` verifica che ogni tool PROMESSO esista. Non verifica il
 * contrario: che il PROMPT non imponga un tool che l'agente non ha. Il difetto è arrivato in
 * produzione esattamente da lì — `MOTION_CRAFT_SPECS` è condiviso fra la pagina Motion e l'agente
 * motion della chat, ci è stato scritto "voce e musica sono accese di default, chiama
 * generate_voiceover", e in chat quel tool non c'era. Il registro era coerente con sé stesso e il
 * modello leggeva un obbligo che non poteva eseguire.
 *
 * Un prompt condiviso è un contratto: se nomina un tool, la superficie che lo legge deve averlo.
 */
describe('il prompt non promette tool che l’agente non ha', () => {
	/** I nomi di tool citati dentro le craft specs condivise. */
	const promised = [...MOTION_CRAFT_SPECS.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+){1,3})\b/g)]
		.map((m) => m[1])
		.filter((n) => n in ALL);

	it('le craft specs motion ne citano davvero qualcuno (o il test non prova niente)', () => {
		expect(promised.length).toBeGreaterThan(0);
	});

	it('ogni tool citato dalle craft specs è in mano all’agente motion', () => {
		const motion = new Set(mountedFor('motion'));
		const missing = [...new Set(promised)].filter((n) => !motion.has(n));
		expect(missing).toEqual([]);
	});
});

/**
 * I CINQUE MESTIERI, e la proprietà che li tiene un team invece che cinque prodotti.
 */
describe('i cinque specialisti', () => {
	it('sono cinque, e nominati per il mestiere', () => {
		expect([...AGENT_IDS].sort()).toEqual(['analyst', 'content', 'motion', 'ugc', 'web']);
		for (const id of AGENT_IDS) {
			// Nessuna etichetta che nomini un reparto del nostro prodotto: chi sceglie non deve
			// conoscere com'è fatto dentro.
			expect(AGENTS[id].labels.it, id).not.toMatch(/^(Publish|Brand|Grow|Media)$/);
			expect(AGENTS[id].labels.it.length, id).toBeGreaterThan(2);
		}
	});

	it('ognuno raggiunge i colleghi con message_agent, non con un consulto muto', () => {
		for (const id of AGENT_IDS) {
			expect(mountedFor(id), `${id}`).toContain('message_agent');
		}
	});

	it('ognuno può aprire una sessione utente con open_session_with_user, tranne i sotto-agenti', () => {
		for (const id of AGENT_IDS) {
			expect(mountedFor(id), `${id}`).toContain('open_session_with_user');
		}
		// Chi parla con la persona è uno solo: un sub-agente non apre sessioni utente.
		expect(subagentToolNames('execute', 'web', ['open_session_with_user', 'read_posts'])).not.toContain(
			'open_session_with_user'
		);
	});

	it('il Content Creator ha ereditato i tre mestieri che si sono fusi', () => {
		// publish + brand + media: scrivere un post, tenerne la voce, produrne la grafica.
		const content = mountedFor('content');
		for (const k of ['create_post', 'update_brand_kit', 'design_graphic', 'generate_editorial_plan']) {
			expect(content, k).toContain(k);
		}
	});

	it('l’Analyst tiene i numeri, e non scrive contenuti', () => {
		const analyst = mountedFor('analyst');
		expect(analyst).toContain('run_analytics_review');
		expect(analyst).toContain('read_strategy');
		expect(analyst).not.toContain('create_post');
	});
});

/**
 * Il selettore del composer e il registro del server sono la STESSA lista, o l'utente sceglie
 * un agente che non esiste — e le facce sono l'altra metà: chiavi rimaste ai vecchi id (publish,
 * brand, grow) facevano ricadere ogni agente sull'avatar neutro di `auto`, cinque facce identiche.
 */
describe('il picker del composer e il registro non divergono', () => {
	it('offre esattamente gli agenti che il server conosce', () => {
		const picker = AGENT_META.map((a) => a.id).filter((id) => id !== 'auto');
		expect([...picker].sort()).toEqual([...AGENT_IDS].sort());
	});

	it('dà a ogni agente una faccia sua, e lascia neutra solo Anomalia', () => {
		for (const id of AGENT_IDS) {
			const av = BUILTIN_AGENT_AVATARS[id];
			expect(av, `manca l'avatar di ${id}`).toBeTruthy();
			expect(av.color, `${id} usa il colore di auto`).not.toBe(BUILTIN_AGENT_AVATARS.auto.color);
		}
	});

	it('riapre un thread vecchio sullo stesso specialista del server', () => {
		for (const legacy of ['publish', 'brand', 'media', 'grow', 'stratega', 'analisi', 'seo']) {
			expect(AGENT_IDS as readonly string[]).toContain(normalizeAgentId(legacy));
		}
	});
});

/**
 * IL CONTRATTO DI LAVORO — le proprietà comportamentali del prompt, inchiodate.
 *
 * Il difetto sistemico era di postura, non di capacità: gli agenti rispondevano sullo stato del
 * brand senza leggerlo, consegnavano suggerimenti invece di lavoro fatto, e chiudevano al passo 8
 * di un budget da 75. La cura è testo di prompt (WORK_ETHIC_BLOCK + le righe READY per mestiere),
 * e il testo di un prompt regredisce in silenzio: un refactor che perde una riga non rompe nulla
 * di compilabile. Questi test rendono la regressione rumorosa. La prova VERA restano i turni live.
 */
describe('il contratto di lavoro è nel prompt di ogni specialista', () => {
	const heads = Object.fromEntries(AGENT_IDS.map((id) => [id, buildAgentHead(id, 'it', 'acme', 'Acme')]));

	it('OGNI specialista sa che un media si mostra, non si linka (non solo il Content Creator)', () => {
		for (const id of AGENT_IDS) {
			const head = buildAgentHead(id, 'it', 'brand', 'Brand');
			expect(head).toContain('show_media');
			expect(head).toContain('DEFECT');
		}
		// Anche un consulto: risponde una volta sola, ma con lo stesso modo di consegnare.
		expect(buildAgentHead('motion', 'it', 'brand', 'Brand', false)).toContain('show_media');
	});

	it('ogni testa porta il contratto: triage, tre riflessi, budget', () => {
		for (const id of AGENT_IDS) {
			const head = heads[id];
			// Il blocco intero, non frasi sparse: se qualcuno lo riscrive, deve riscrivere anche i test.
			expect(head, id).toContain(WORK_ETHIC_BLOCK);
			// Le tre condizioni osservabili, per nome.
			expect(head, id).toContain('TRIAGE');
			expect(head, id).toContain('LOOK BEFORE ANSWERING');
			expect(head, id).toContain('DELIVER WORK, NOT HOMEWORK');
			expect(head, id).toContain('CLOSE ONLY AGAINST A DEFINITION OF DONE');
			// Il budget citato nel prompt è quello vero di queue.ts / turn-limits.ts.
			expect(head, id).toContain('75 tool steps');
			expect(head, id).toContain('9 automatic continuations');
		}
	});

	it('la delega distingue sotto-agenti (copia di me) da colleghi (mestiere altrui)', () => {
		// I sotto-agenti sono COPIE del main agent che dividono il SUO goal; i colleghi sono gli altri
		// mestieri. Questa distinzione è il punto: senza, l'orchestratore usa run_parallel_tasks anche
		// per l'audit del Web, e il lavoro giusto non arriva mai al collega.
		expect(ORCHESTRATION_BLOCK).toContain('SUB-AGENTS are copies of YOU');
		expect(ORCHESTRATION_BLOCK).toContain('COLLEAGUES (message_agent)');
		expect(ORCHESTRATION_BLOCK).toContain('open_session_with_user');
		expect(ORCHESTRATION_BLOCK).toMatch(/message_agent \+ open_session_with_user = THEIR craft/);
		expect(ORCHESTRATION_BLOCK).toContain('message_agent');
	});

	it('ogni mestiere dice cosa vuol dire READY per sé', () => {
		expect(heads.content).toContain('READY, for this trade');
		expect(heads.content).toContain('drafts sitting in pending');
		expect(heads.analyst).toContain('READY, for this trade');
		expect(heads.analyst).toContain('APPLIED');
		expect(heads.motion).toContain('RENDERED to MP4');
		expect(heads.ugc).toContain('EXISTS as a post in pending');
		expect(heads.web).toContain('articles actually WRITTEN');
	});

	it('lo specialista ha finalmente il GROUNDING, e il consulto lo tiene senza il contratto', () => {
		// Prima il GROUNDING_BLOCK stava solo nella testa omni: i cinque specialisti non lo
		// leggevano affatto. Il consulto invece risponde una volta e non scrive: grounding sì,
		// obbligo di consegnare draft no.
		for (const id of AGENT_IDS) {
			expect(heads[id], id).toContain('GROUNDING — NEVER INVENT');
			const consult = buildAgentHead(id, 'it', 'acme', 'Acme', false);
			expect(consult, id).toContain('GROUNDING — NEVER INVENT');
			expect(consult, id).not.toContain('WORK ETHIC');
		}
	});
});

/**
 * IL NOME NELLA PROSA È UN CONTRATTO — la direzione da cui sono passati tutti questi difetti.
 *
 * `every agent key resolves to a real tool` guarda il registro: ogni chiave dichiarata esiste come
 * tool. Non guarda il testo. E il testo è dove il modello scopre cosa può fare: se un blocco di
 * prompt scrive `show_media` e quel mestiere non ce l'ha, il modello legge un ordine che non può
 * eseguire e fa la cosa che il blocco vieta nella riga sopra — che è esattamente quello che è
 * successo a `web` (unico senza `show_media`, mentre SHOW_MEDIA_BLOCK sta in tutte e cinque le
 * teste) e a `propose_plan` (nominato come DEFAULT da PLAN_DOC_BLOCK, montato su nessuno dei cinque).
 *
 * Il controllo NON indovina quali parole siano nomi di tool: parte dal registro vero — ogni chiave
 * che `createChatTools`/`createSubagentTools`/`createSandboxTools` producono davvero — e cerca
 * quella parola intera nella prosa. Zero regex sui nomi, zero euristiche: si legge il dato.
 *
 * La prosa presa in esame è tutta quella che arriva a un mestiere e che si possa costruire senza
 * database: la testa (`buildAgentHead` = role + WORK ETHIC + GROUNDING + ORCHESTRATION + GOAL +
 * SHOW_MEDIA + le CAPABILITIES) e i tre blocchi di modalità (`modeSystemBlock`). Le sezioni di
 * `buildSystemPrompt` che dipendono dal brand non ci sono: se un giorno servono, il ponte è passare
 * qui la stringa già costruita.
 *
 * NON esiste il test inverso — «ogni tool montato è nominato» — e la ragione va scritta: sarebbe un
 * cricchetto che spinge a scrivere prosa. Al 23/8/2026 i tool montati e mai nominati in nessuna
 * prosa del prodotto sono ~22 su ~90, e quasi tutti fanno bene a restare muti (`check_job_status`,
 * `set_expression`, `set_notification`, `show_team`): la loro descrizione basta, e una riga in più
 * nel prompt si paga a ogni passo. Il caso che invece andava chiuso — la shell in mano
 * all'orchestratore, nominata solo come cosa da delegare — è stato chiuso a mano in
 * ORCHESTRATION_BLOCK, non da un test.
 */
describe('ogni tool nominato nella prosa è montato su chi legge quella prosa', () => {
	const REGISTRY = [...new Set(Object.keys(ALL))];

	/** I nomi del registro che compaiono come parola intera in `text`. */
	function namedIn(text: string): string[] {
		return REGISTRY.filter((name) => new RegExp(`\\b${name}\\b`).test(text));
	}

	const modes = (['agent', 'plan', 'ask'] as const)
		.map((m) => modeSystemBlock(m, 'Italian'))
		.join('\n');

	it('il controllo trova davvero dei nomi, o non prova niente', () => {
		expect(namedIn(buildAgentHead('content', 'it', 'acme', 'Acme')).length).toBeGreaterThan(20);
	});

	it('nessuna testa promette un tool che quel mestiere non ha', () => {
		const broken: string[] = [];
		for (const id of AGENT_IDS) {
			const mounted = new Set(mountedFor(id));
			const prose = `${buildAgentHead(id, 'it', 'acme', 'Acme')}\n${modes}`;
			for (const name of namedIn(prose)) if (!mounted.has(name)) broken.push(`${id}: ${name}`);
		}
		expect(broken, 'nominati nel prompt e non montati').toEqual([]);
	});

	it('vale anche per un consulto, che legge una testa più corta', () => {
		const broken: string[] = [];
		for (const id of AGENT_IDS) {
			const mounted = new Set(mountedFor(id));
			for (const name of namedIn(buildAgentHead(id, 'it', 'acme', 'Acme', false)))
				if (!mounted.has(name)) broken.push(`${id}: ${name}`);
		}
		expect(broken).toEqual([]);
	});
});

/**
 * LA SQUADRA NON SI SCRIVE A MANO — e questo test è il motivo per cui non ricomincerà.
 *
 * Il precedente sta in `agent-owners.test.ts` (JOB_OWNERS ↔ ROSTER_JOBS) e nel commento di
 * `TeamRoster.svelte`: due volte, in questo repo, un elenco di agenti copiato è diventato falso e
 * l'ha scoperto un utente. `teamBlock` genera da `AGENTS`; qui si verifica che generi DAVVERO —
 * se domani appare un sesto mestiere e la descrizione non lo nomina, questo file fallisce.
 */
describe('la squadra si descrive da sé', () => {
	it('ogni agente nomina TUTTI i colleghi, per etichetta e per mestiere', () => {
		for (const me of AGENT_IDS) {
			const block = teamBlock(me);
			for (const other of AGENT_IDS) {
				if (other === me) continue;
				expect(block, `${me} non nomina ${other}`).toContain(AGENTS[other].labels.en);
				expect(block, `${me} non dice cosa fa ${other}`).toContain(AGENTS[other].area.en);
			}
		}
	});

	it('non si elenca fra i colleghi, e dice il proprio nome', () => {
		for (const me of AGENT_IDS) {
			const block = teamBlock(me);
			expect(block).toContain(`You are the ${AGENTS[me].labels.en}`);
			expect(block, `${me} si elenca fra gli altri`).not.toContain(`(\`${me}\`)`);
		}
	});

	it('il numero dichiarato è quello vero (un sesto mestiere non lascia scritto «cinque»)', () => {
		expect(teamBlock('content')).toContain(`THE TEAM — ${AGENT_IDS.length} specialists`);
	});

	it('ogni mestiere ha una consegna, verso un mestiere che esiste e non è sé stesso', () => {
		for (const me of AGENT_IDS) {
			const targets = HANDOFFS[me];
			expect(targets?.length, `${me} non ha consegne`).toBeGreaterThan(0);
			for (const t of targets) {
				expect(AGENT_IDS, `${me} consegna a ${t}, che non esiste`).toContain(t);
				expect(t, `${me} consegna a sé stesso`).not.toBe(me);
			}
			for (const t of targets) expect(teamBlock(me)).toContain(AGENTS[t].labels.en);
		}
	});

	it('la testa dello specialista lo monta davvero', () => {
		for (const id of AGENT_IDS) {
			expect(buildAgentHead(id, 'it', 'acme', 'Acme')).toContain(teamBlock(id));
		}
	});

	/**
	 * L'ONESTÀ DEL BLOCCO: `message_agent` è nominato solo dove è montato. Il kit
	 * (`agent/bridge/live.ts`) non lo monta e passa `canMessage: false` — il difetto delle craft
	 * specs motion (un prompt che impone un tool assente) non si ripete qui.
	 */
	it('senza message_agent, non lo promette', () => {
		for (const id of AGENT_IDS) {
			expect(teamBlock(id, { canMessage: false })).not.toContain('message_agent');
			expect(teamBlock(id, { canMessage: false })).toContain(AGENTS[id].labels.en);
			expect(teamBlock(id)).toContain('message_agent');
			// open_session_with_user è il partner del DM: stesso gate "può parlare coi colleghi".
			expect(teamBlock(id, { canMessage: false })).not.toContain('open_session_with_user');
			expect(teamBlock(id)).toContain('open_session_with_user');
		}
	});

	/**
	 * Le due vestizioni sono gli STESSI cinque id: il kit riusa `AGENTS` per il suo blocco squadra
	 * (via `resolveAgent(spec.id)`), quindi uno specialista nuovo nel kit senza riga nel registro
	 * girerebbe senza squadra e in silenzio.
	 */
	it('i cinque del kit sono i cinque del registro', () => {
		expect(SPECIALISTS.map((s) => s.id).sort()).toEqual([...AGENT_IDS].sort());
	});
});
