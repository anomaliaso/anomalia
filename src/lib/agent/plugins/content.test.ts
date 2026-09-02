import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import { aDateInTheFuture, fakeContext } from '../testkit';

// `content_create_post` avvolge `create_post` di chat/tools.ts, che a sua volta chiama
// `createSingleContent` (rendering AI vero) e `remaining`/`addUsage` (crediti/quota, dietro
// `billingProvider`/`getCreditsUsage` — terreno del conflitto billing attivo, vedi CLAUDE.md:
// si mocka `usage.ts` invece di dipendere dal suo interno). Il resto (posts, brand_kit, people)
// resta il mock supabase in-memory VERO: i gate su quello girano per davvero.
const createSingleContent = vi.fn();
const generateStandaloneImage = vi.fn();
const regeneratePost = vi.fn();
vi.mock('$lib/server/content-preview', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/content-preview')>();
	return { ...actual, createSingleContent, generateStandaloneImage, regeneratePost };
});

const remainingMock = vi.fn();
const addUsageMock = vi.fn();
vi.mock('$lib/server/usage', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/usage')>();
	return { ...actual, remaining: remainingMock, addUsage: addUsageMock };
});

const { createContentPlugin } = await import('./content');

const BRAND_ID = 'b1';
const USER_ID = 'u1';

const AMPLE_BUDGET = {
	posts: 10,
	videos: 5,
	postsUsed: 0,
	videosUsed: 0,
	postsQuota: 10,
	videosCap: 5,
	credits: { remaining: 100, quota: 100, used: 0, periodEnd: new Date('2026-09-01') }
};

function seed(extra: Record<string, unknown[]> = {}) {
	return createTestSupabase({
		brands: [{ id: BRAND_ID, name: 'Acme', plan: 'starter', timezone: 'Europe/Rome', content_prefs: {}, target_platforms: ['instagram'] }],
		brand_kit: [],
		...extra
	});
}

beforeEach(() => {
	createSingleContent.mockReset().mockResolvedValue({
		caption: 'Mock caption',
		imagePrompt: 'a mock prompt',
		imageUrl: 'https://cdn.test/mock.png',
		contentType: 'generated_image'
	});
	generateStandaloneImage.mockReset().mockResolvedValue({ imageUrl: 'https://cdn.test/standalone.png', notes: 'ok' });
	regeneratePost.mockReset().mockResolvedValue({ imageUrl: 'https://cdn.test/regenerated.png', caption: 'Updated caption' });
	remainingMock.mockReset().mockResolvedValue(AMPLE_BUDGET);
	addUsageMock.mockReset().mockResolvedValue(undefined);
});

describe('content plugin — mount', () => {
	// I due tool video non sono di un mestiere: rifinire una clip serve a chi la gira e a chi la
	// mette in un post, quindi portano il nome della chat e stanno in entrambi (come
	// `search_knowledge`). Il prefisso resta per cio' che appartiene davvero a content.
	it('espone i content_* piu\' i due tool video comuni, e nessun tool di un altro mestiere', () => {
		const kit = seed();
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const names = plugin.tools.map((t) => t.name).sort();
		expect(names).toEqual(['content_create_post', 'content_cross_post', 'content_design_graphic', 'content_generate_image', 'content_list_posts', 'content_reschedule_post', 'content_schedule', 'content_update_post', 'create_post_from_asset', 'generate_video', 'motion_control_video', 'read_media', 'refine_video', 'use_library_image']);
		// `motion_control_video` non e' del mestiere motion: quello monta motion_write/render/edit,
		// che sono Remotion. Il prefisso da solo non basta a distinguerli, quindi si nominano.
		const OTHER_TRADES = ['motion_write', 'motion_render', 'motion_edit', 'motion_stills', 'motion_list'];
		expect(names.some((n) => n.startsWith('ugc_') || n.startsWith('web_') || OTHER_TRADES.includes(n))).toBe(false);
	});
});

describe('content_create_post — chiama la strada VERA e scrive la riga (mutazione 1)', () => {
	it('un brief semplice crea un post pending_user con la caption/immagine mockate', async () => {
		const kit = seed();
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'content_create_post', args: { brief: 'Lancio prodotto' } }, fakeContext());
		expect(res.isError).toBeFalsy();
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.success).toBe(true);
		expect(out.media_url).toBe('https://cdn.test/mock.png');
		expect(createSingleContent).toHaveBeenCalledTimes(1);
		const rows = kit.tables.get('posts') ?? [];
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ brand_id: BRAND_ID, status: 'pending_user', caption: 'Mock caption', platform: 'instagram' });
	});

	it('crediti esauriti → errore onesto, nessuna riga scritta', async () => {
		remainingMock.mockResolvedValue({ ...AMPLE_BUDGET, credits: { ...AMPLE_BUDGET.credits, remaining: 0 } });
		const kit = seed();
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'content_create_post', args: { brief: 'Lancio prodotto' } }, fakeContext());
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(res.isError).toBe(true);
		expect(out.error).toBe('credits_exhausted');
		expect(kit.tables.get('posts') ?? []).toHaveLength(0);
	});
});

describe('content_generate_image — il gate di consenso AI-Act rifiuta (non riscritto, importato)', () => {
	it('una persona reale senza consent viene rifiutata per nome, generateStandaloneImage non viene chiamata', async () => {
		const kit = seed({
			people: [{ id: 'person-1', brand_id: BRAND_ID, name: 'Jane', kind: 'real', images: [], consent: false }]
		});
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'content_generate_image', args: { prompt: 'foto di Jane', people_ids: ['person-1'] } },
			fakeContext()
		);
		expect(res.isError).toBe(true);
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.error).toContain('Jane');
		expect(out.consent_blocked).toEqual(['Jane']);
		expect(generateStandaloneImage).not.toHaveBeenCalled();
	});

	it('con post_id su una foto ai_generated, rigenera davvero e aggiorna media_url (mutazione 3)', async () => {
		const kit = seed({
			posts: [
				{
					id: 'post-2',
					brand_id: BRAND_ID,
					content_type: 'ai_generated',
					platform: 'instagram',
					caption: 'Old caption',
					image_prompt: 'old prompt',
					media_url: 'https://cdn.test/old.png',
					status: 'pending_user'
				}
			]
		});
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'content_generate_image', args: { prompt: 'più luce', post_id: 'post-2' } },
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		expect(regeneratePost).toHaveBeenCalledTimes(1);
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.media_url).toBe('https://cdn.test/regenerated.png');
		const row = (kit.tables.get('posts') ?? []).find((r) => r.id === 'post-2');
		expect(row?.media_url).toBe('https://cdn.test/regenerated.png');
		expect(row?.caption).toBe('Updated caption');
	});
});

describe('content_create_post — il cancello PRIMA della spesa (piattaforma non collegata)', () => {
	it('piattaforma chiesta esplicitamente e non collegata → rifiuto, zero rendering, zero righe', async () => {
		const kit = seed({ social_accounts: [{ id: 'a1', brand_id: BRAND_ID, platform: 'instagram', status: 'active' }] });
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'content_create_post', args: { brief: 'Lancio prodotto', platform: 'tiktok', content_type: 'video' } },
			fakeContext()
		);
		expect(res.isError).toBe(true);
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.error).toBe('platform_not_connected');
		expect(out.platform).toBe('tiktok');
		expect(out.message).toMatch(/Settings > Connectors/);
		expect(out.message).toMatch(/allow_unconnected/);
		// Il punto del cancello: niente rendering AI, niente riga.
		expect(createSingleContent).not.toHaveBeenCalled();
		expect(kit.tables.get('posts') ?? []).toHaveLength(0);
	});

	it('un account attivo su quella piattaforma → si lavora come sempre', async () => {
		const kit = seed({ social_accounts: [{ id: 'a1', brand_id: BRAND_ID, platform: 'tiktok', status: 'active' }] });
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'content_create_post', args: { brief: 'Lancio prodotto', platform: 'tiktok' } },
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		expect(createSingleContent).toHaveBeenCalledTimes(1);
	});

	it('un account SCOLLEGATO (status non active) non conta come collegato', async () => {
		const kit = seed({ social_accounts: [{ id: 'a1', brand_id: BRAND_ID, platform: 'tiktok', status: 'revoked' }] });
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'content_create_post', args: { brief: 'Lancio', platform: 'tiktok' } },
			fakeContext()
		);
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.error).toBe('platform_not_connected');
		expect(createSingleContent).not.toHaveBeenCalled();
	});

	it('il cancello non è un muro: allow_unconnected fa comunque la bozza', async () => {
		const kit = seed({ social_accounts: [] });
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'content_create_post', args: { brief: 'Lancio', platform: 'tiktok', allow_unconnected: true } },
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		expect(createSingleContent).toHaveBeenCalledTimes(1);
		expect((kit.tables.get('posts') ?? [])[0]).toMatchObject({ status: 'pending_user', platform: 'tiktok' });
	});

	it('senza piattaforma esplicita il cancello tace: le bozze sul default del brand restano lavoro legittimo', async () => {
		const kit = seed({ social_accounts: [] });
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'content_create_post', args: { brief: 'Lancio' } }, fakeContext());
		expect(res.isError).toBeFalsy();
		expect(createSingleContent).toHaveBeenCalledTimes(1);
	});
});

describe('content_schedule — approve_post, il gate di stato/prepublish reale', () => {
	it("post inesistente → 'Post not found', nessuna mutazione", async () => {
		const kit = seed();
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'content_schedule', args: { post_id: 'nope' } },
			fakeContext()
		);
		expect(res.isError).toBe(true); // execChatTool marca isError su ogni { error } del tool vero
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.error).toBe('Post not found');
	});

	it('con media reale e nessun account collegato: approva ma NON programma, e lo DICE (mutazione 2)', async () => {
		const kit = seed({
			posts: [
				{
					id: 'post-1',
					brand_id: BRAND_ID,
					status: 'pending_user',
					content_type: 'generated_image',
					media_url: 'https://cdn.test/ready.png',
					media_urls: null,
					platform: 'instagram',
					caption: 'Pronto'
				}
			],
			social_accounts: []
		});
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'content_schedule', args: { post_id: 'post-1' } }, fakeContext());
		const out = JSON.parse((res.content[0] as { text: string }).text);
		// `success: true` accanto a `noAccount: true` si leggeva come "programmato": ora il
		// risultato dice a parole che il post NON esce finché l'account non è collegato.
		expect(out.success).toBe(false);
		expect(out.noAccount).toBe(true);
		expect(out.approved).toBe(true);
		expect(out.scheduled).toBe(false);
		expect(out.message).toMatch(/no connected account for instagram/i);
		expect(out.message).toMatch(/Settings > Connectors/);
		const row = (kit.tables.get('posts') ?? []).find((r) => r.id === 'post-1');
		expect(row?.status).toBe('approved');
	});

	it("post senza media (visual senza immagine/video) → il prepublish gate rifiuta l'approvazione, niente mutazione", async () => {
		const kit = seed({
			posts: [
				{
					id: 'post-1',
					brand_id: BRAND_ID,
					status: 'pending_user',
					content_type: 'generated_image',
					media_url: null,
					media_urls: null,
					platform: 'instagram',
					caption: 'Senza immagine'
				}
			]
		});
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'content_schedule', args: { post_id: 'post-1' } }, fakeContext());
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.error).toContain('no image or video');
		const row = (kit.tables.get('posts') ?? []).find((r) => r.id === 'post-1');
		expect(row?.status).toBe('pending_user'); // mai approvato
	});
});

describe('content_list_posts — read_posts, filtro reale sullo status (mutazione 3: nessuna scrittura, ma legge lo stato vero)', () => {
	it('filtra per status ed esclude gli altri', async () => {
		const kit = seed({
			posts: [
				{ id: 'p1', brand_id: BRAND_ID, status: 'pending_user', caption: 'A', platform: 'instagram', created_at: '2026-08-01T00:00:00Z' },
				{ id: 'p2', brand_id: BRAND_ID, status: 'published', caption: 'B', platform: 'instagram', created_at: '2026-08-02T00:00:00Z' }
			]
		});
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'content_list_posts', args: { status: 'pending_user' } }, fakeContext());
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.count).toBe(1);
		expect(out.posts[0].id).toBe('p1');
	});
});

describe('le scritture di dominio che il kit non aveva', () => {
	it('content_update_post cambia davvero la caption della riga (mutazione)', async () => {
		const kit = seed({
			posts: [{ id: 'post-9', brand_id: BRAND_ID, platform: 'instagram', caption: 'Vecchia', status: 'pending_user' }]
		});
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'content_update_post', args: { post_id: 'post-9', caption: 'Nuova caption' } },
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		expect(JSON.parse((res.content[0] as { text: string }).text)).toMatchObject({ success: true, updated_fields: ['caption'] });
		expect((kit.tables.get('posts') ?? [])[0]).toMatchObject({ caption: 'Nuova caption', status: 'pending_user' });
	});

	it('content_reschedule_post RIFIUTA una bozza pending_user: spostarla la pubblicherebbe senza approvazione', async () => {
		const kit = seed({
			posts: [{ id: 'post-10', brand_id: BRAND_ID, platform: 'instagram', caption: 'Bozza', status: 'pending_user', scheduled_for: null }]
		});
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'content_reschedule_post', args: { post_id: 'post-10', scheduled_for: aDateInTheFuture() } },
			fakeContext()
		);
		expect(res.isError).toBe(true);
		expect(JSON.parse((res.content[0] as { text: string }).text).error).toContain('approve_post');
		expect((kit.tables.get('posts') ?? [])[0].scheduled_for).toBeNull();
	});

	it('content_cross_post allarga la bozza senza duplicare la piattaforma che aveva', async () => {
		const kit = seed({
			posts: [{ id: 'post-11', brand_id: BRAND_ID, platform: 'instagram', platforms: ['instagram'], caption: 'Bozza', status: 'pending_user' }]
		});
		const plugin = createContentPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'content_cross_post', args: { post_id: 'post-11', platforms: ['linkedin', 'instagram'] } },
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		expect(JSON.parse((res.content[0] as { text: string }).text)).toMatchObject({ success: true, platforms: ['instagram', 'linkedin'] });
		expect((kit.tables.get('posts') ?? [])[0].platforms).toEqual(['instagram', 'linkedin']);
	});
});
