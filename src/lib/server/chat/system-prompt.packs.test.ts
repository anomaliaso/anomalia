import { describe, expect, it } from 'vitest';
import { AGENT_IDS, type AgentId } from './agents';
import { filesIndexFor } from './agent-files';
import { AGENT_PACKS, buildSystemPrompt, type HubPack } from './system-prompt';

/**
 * IL TEST CHE MANCAVA.
 *
 * Il 21/8/2026 `AGENT_IDS` è passato da `brand|publish|grow|web|motion|ugc|media` a
 * `content|ugc|motion|web|analyst`. `system-prompt.ts` decideva quale dump profondo spedire con
 * `agentId === pack`, e nessuno l'ha toccato: per due giorni ogni specialista ha ricevuto un
 * prompt mutilato — niente media library, niente strategia, niente GTM, niente piano editoriale,
 * niente post recenti — mentre l'intestazione `## HUB CONTEXT PACK` continuava ad annunciarli.
 *
 * Nessun test falliva, perché niente legava le due liste. Questo file È quel legame: la prima
 * metà lo verifica sulla tabella, la seconda costruisce il prompt vero e ci cerca dentro i
 * blocchi che ogni mestiere DEVE avere.
 */

const ALL_PACKS: HubPack[] = ['brand', 'publish', 'grow', 'web'];

describe('hub context packs ↔ agent ids', () => {
	it('ogni mestiere ha una riga, e nessuna riga è per un mestiere che non esiste', () => {
		expect(Object.keys(AGENT_PACKS).sort()).toEqual([...AGENT_IDS].sort());
	});

	it('ogni pacchetto è servito da almeno un mestiere, e nessun pacchetto è inventato', () => {
		const served = new Set(Object.values(AGENT_PACKS).flat());
		// Un pacchetto che nessuno riceve è un blocco di prompt che nessuno leggerà mai: o lo si
		// assegna, o lo si cancella. È esattamente lo stato in cui `brand`, `publish` e `grow`
		// erano finiti — codice vivo, lettori zero.
		expect([...served].sort()).toEqual([...ALL_PACKS].sort());
	});

	it('il mestiere che i pacchetti servono è quello che la sua area dichiara', () => {
		// L'Analyst dice "strategia GTM, radar e leads" → deve avere `grow`, ed è l'unico.
		expect(AGENT_PACKS.analyst).toContain('grow');
		// Il Content Creator ha assorbito `brand` + `publish` + `media`: piano editoriale, coda dei
		// post E libreria media, o pianifica senza il piano e sceglie una foto senza il catalogo.
		expect(AGENT_PACKS.content).toContain('publish');
		expect(AGENT_PACKS.content).toContain('brand');
		expect(AGENT_PACKS.web).toContain('web');
	});

	/**
	 * `MAKER_AGENTS` è stato CANCELLATO il 23/8, e questo test è ciò che ne resta.
	 *
	 * Il set esisteva per dare a `motion` e `ugc` il documento Studio intero pur senza pacchetto.
	 * Da quando quel documento è un file (`brand/studio.md`) e i file non hanno mestiere, il set
	 * non aveva più un lavoro: governava due `fetch` che nessuna sezione renderizzava per quei due.
	 * Il difetto che il vecchio test prendeva — un id sparito col rename, dentro un set scritto a
	 * mano — non può più tornare da lì, ma può tornare da `AGENT_PACKS`: quello resta pinnato.
	 */
	it('nessun mestiere senza pacchetto resta senza il documento del brand', () => {
		// La prova che la cancellazione non ha impoverito nessuno: chi non ha pacchetti non ha
		// perso i fatti del brand, li ha in un file — e il file è di TUTTI per costruzione.
		for (const id of ['motion', 'ugc'] as const) {
			expect(AGENT_PACKS[id]).toEqual([]);
			expect(filesIndexFor(id)).toContain('brand/studio.md');
		}
	});
});

// ── Il prompt vero ────────────────────────────────────────────────────────────────────────────
//
// Stub di Supabase: ogni catena (`.select().eq().order().limit()`, `.maybeSingle()`) torna lo
// stesso oggetto, che è anche un thenable. Il `data` lo decide il nome della tabella. Serve a
// far girare `buildSystemPrompt` per intero, perché la sola cosa che prova davvero che un
// pacchetto è arrivato è trovarne l'intestazione nel testo spedito al modello.

const ROWS: Record<string, unknown> = {
	brand_kit: { category: 'SaaS', about: 'Test brand', target_audience: 'PMI', content_pillars: ['a'] },
	brand_strategy: { positioning: 'POSIZIONAMENTO-DI-PROVA', report: { summary: 'sintesi di prova' } },
	editorial_plans: {
		strategy: 'strategia editoriale di prova',
		voice: { mood: 'MOOD-DI-PROVA', tone: 'diretto', goal: 'convertire', personality: 'secca' },
		cadence: '3/settimana',
		platform_mix: [{ platform: 'instagram', share: '60%' }],
		weeks: [{ index: 1, theme: 'TEMA-SETTIMANA-1', focus: 'lancio', status: 'planned' }]
	},
	gtm_plans: {
		horizon: '90d',
		objective: 'OBIETTIVO-GTM-DI-PROVA',
		phases: [{ name: 'Fase 1', objective: 'awareness', platform_weights: [{ platform: 'ig', percent: 60 }] }]
	},
	posts: [
		{ id: 'p1', platform: 'instagram', caption: 'CAPTION-DI-PROVA', status: 'pending_user', scheduled_for: null, slot: null, published_url: null, content_type: 'image', pillar: 'a' }
	],
	products: [{ id: 'pr1', title: 'PRODOTTO-DI-PROVA', description: 'desc', pricing: '10€', kind: 'product', featured: true, url: 'https://x.test/p', images: [] }],
	people: [{ id: 'pe1', name: 'PERSONA-DI-PROVA', role: 'founder', kind: 'real', description: 'd', images: [] }],
	brand_documents: [{ id: 'd1', kind: 'doc', title: 'DOC-DI-PROVA', summary: 's', status: 'ready', chunk_count: 1, collection: null }],
	brand_media: [
		{ id: 'm1', kind: 'image', title: 'ASSET-DI-PROVA', description: 'd', tags: ['t'], subjects: [], media_kind: 'photo', suggested_use: null, when_to_use: null, how_to_use: null, where_to_use: null, width: 1080, height: 1080, catalog_status: 'ready', file_name: 'a.png', times_used: 0, last_used_at: null }
	],
	competitors: [{ name: 'CONCORRENTE-DI-PROVA', website: 'https://c.test', kind: 'direct', rationale: 'r' }],
	social_accounts: [],
	brand_geo_audits: { tech_score: 70, tech: { content: {}, issues: [] }, share_of_voice: 10, citations: [], created_at: '2026-08-01' },
	brand_seo_plans: { grade: 'B', evaluation: { summary: 'SEO-SOMMARIO-DI-PROVA' }, initiatives: [], created_at: '2026-08-01' },
	brand_articles: [{ id: 'a1', title: 'ARTICOLO-DI-PROVA', status: 'draft', scheduled_for: null, created_at: '2026-08-01' }],
	brand_news_items: [],
	brand_pages: [{ url: 'https://x.test/pagina', title: 'PAGINA-DI-PROVA', topics: ['t'], relevance_score: 1 }],
	brand_app_connections: [],
	brand_demo_accounts: null,
	brands: null
};

function stubSupabase() {
	const chain = (table: string) => {
		const data = ROWS[table] ?? null;
		const node: Record<string, unknown> = {
			then: (res: (v: unknown) => unknown) => Promise.resolve({ data, count: 0, error: null }).then(res),
			maybeSingle: async () => ({ data: Array.isArray(data) ? (data[0] ?? null) : data, error: null }),
			single: async () => ({ data: Array.isArray(data) ? (data[0] ?? null) : data, error: null })
		};
		for (const m of ['select', 'eq', 'neq', 'not', 'gte', 'lte', 'in', 'is', 'order', 'limit', 'range', 'filter', 'or', 'contains', 'overlaps', 'update', 'insert', 'upsert', 'delete'])
			node[m] = () => node;
		return node;
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { from: (t: string) => chain(t), rpc: () => chain('__rpc__') } as any;
}

const BRAND = {
	id: '11111111-1111-1111-1111-111111111111',
	slug: 'prova',
	name: 'Brand di prova',
	website: 'https://x.test',
	plan: 'pro',
	status: 'active',
	timezone: 'Europe/Rome',
	target_platforms: ['instagram'],
	content_prefs: { language: 'it' },
	onboarding_state: null,
	activated_at: '2026-01-01',
	org_id: null
};

/** Le intestazioni che ogni pacchetto porta con sé, come appaiono nel prompt spedito. */
const MARKERS: Record<HubPack, string[]> = {
	brand: ['## MEDIA LIBRARY'],
	publish: ['## EDITORIAL PLAN', '## RECENT POSTS'],
	grow: ['## BRAND STRATEGY', '## GTM ROADMAP'],
	web: ['## SEO & GEO AUDIT', '## BLOG ARTICLES']
};

describe('il prompt costruito porta davvero il pacchetto', () => {
	const built = new Map<AgentId, string>();
	async function promptFor(id: AgentId) {
		const cached = built.get(id);
		if (cached) return cached;
		const p = await buildSystemPrompt(stubSupabase(), { ...BRAND }, 'it', id);
		built.set(id, p);
		return p;
	}

	it.each([...AGENT_IDS])('%s riceve tutti i blocchi del suo pacchetto', async (id) => {
		const prompt = await promptFor(id);
		for (const pack of AGENT_PACKS[id]) {
			for (const marker of MARKERS[pack]) {
				expect(prompt.includes(marker), `${id}: manca ${marker} (pacchetto ${pack})`).toBe(true);
			}
		}
	});

	/**
	 * Il verso negativo, ma solo sui blocchi DAVVERO esclusivi. Alcune sovrapposizioni sono volute
	 * e vanno lasciate stare: `## BRAND STRATEGY` e `## GTM ROADMAP` escono anche per `publish`
	 * (in versione corta — chi scrive un post ha bisogno del posizionamento), e `## RECENT POSTS`
	 * esce anche per `grow` (in versione senza orari — chi legge i numeri ha bisogno di sapere
	 * cosa è uscito). Metterle qui come divieti avrebbe pinnato un difetto invece di un contratto.
	 */
	it.each([
		['## EDITORIAL PLAN', 'content'],
		['## MEDIA LIBRARY', 'content'],
		['## SEO & GEO AUDIT', 'web'],
		['## BLOG ARTICLES', 'web'],
		['## SITE CONTENT LIBRARY', 'web']
	] as const)('%s è solo di %s', async (marker, owner) => {
		for (const id of AGENT_IDS) {
			expect(
				(await promptFor(id)).includes(marker),
				`${id}: ${marker} ${id === owner ? 'manca' : 'non è suo'}`
			).toBe(id === owner);
		}
	});

	it('l\'intestazione non promette il vuoto', async () => {
		// Con un pacchetto sotto, l'annuncio è vero e resta.
		expect(await promptFor('analyst')).toContain('## HUB CONTEXT PACK');
		// Senza, sparisce: `motion` e `ugc` non hanno dump profondo, e un'intestazione che dice
		// «sotto c'è il dump» insegna al modello che i dati ci sono e lo trattiene dal chiederli.
		for (const id of ['motion', 'ugc'] as const) {
			expect(await promptFor(id)).not.toContain('## HUB CONTEXT PACK');
		}
	});

	/**
	 * Il piano editoriale porta con sé la voce bloccata dal planner (mood/tone/goal/personality):
	 * fino al 23/8 la stampava anche `renderDesignDoc`, sotto `needBrand && !needPublish` — che
	 * dalla fusione di `brand` e `publish` in `content` è un'espressione sempre falsa, quindi non
	 * la riceveva più nessuno. Adesso il documento Studio è un file (brand/studio.md) e l'unica
	 * copia nel prompt è questa: se sparisce di qui, sparisce e basta.
	 */
	it('chi ha il piano editoriale ha anche la voce bloccata', async () => {
		expect(await promptFor('content')).toContain('MOOD-DI-PROVA');
	});
});
