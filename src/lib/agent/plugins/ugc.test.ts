import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import { fakeContext } from '../testkit';

// `ugc_generate_video` avvolge `create_post` con content_type FORZATO a "video" — non esiste un
// `create_video` separato in chat/tools.ts, il ramo video vive dentro create_post (submitVideoRender
// dietro env.KIE_API_KEY, qui assente in test → videoFallback onesto, la copertina mockata spedisce
// comunque il post). Stessi mock di content.test.ts, stessa ragione: isolarsi dal terreno billing
// in conflitto (usage.ts) e dal rendering AI vero (content-preview.ts).
const createSingleContent = vi.fn();
vi.mock('$lib/server/content-preview', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/content-preview')>();
	return { ...actual, createSingleContent };
});

const remainingMock = vi.fn();
const addUsageMock = vi.fn();
vi.mock('$lib/server/usage', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/usage')>();
	return { ...actual, remaining: remainingMock, addUsage: addUsageMock };
});

// content_type:"video" fa contare i render in corso su `video_renders` via l'admin client PRIMA
// di decidere se sottomettere il clip vero a kie — senza questo mock quella conta colpirebbe
// Supabase di produzione ad ogni test.
function fakeAdminClient() {
	return createTestSupabase({ video_renders: [] }).client;
}
vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: fakeAdminClient }));

// KIE_API_KEY è presente in questo ambiente: senza mockare submitVideoRender, ogni test con
// content_type:"video" chiamava DAVVERO l'API a pagamento di kie (misurato: "[kie] kie createTask
// rifiutata..." nello stderr del primo run). submitVideoRender resta null → stesso ripiego onesto
// (videoFallback) che il codice userebbe se kie rifiutasse, ma senza mai toccare la rete.
const submitVideoRender = vi.fn().mockResolvedValue(null);
vi.mock('$lib/server/video', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/video')>();
	return { ...actual, submitVideoRender };
});

const { createUgcPlugin } = await import('./ugc');

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
		caption: 'Mock UGC caption',
		imagePrompt: 'a UGC cover prompt',
		imageUrl: 'https://cdn.test/ugc-cover.png'
	});
	remainingMock.mockReset().mockResolvedValue(AMPLE_BUDGET);
	addUsageMock.mockReset().mockResolvedValue(undefined);
});

describe('ugc plugin — mount', () => {
	it('espone solo ugc_* — niente content_* (il mestiere ugc non li monta)', () => {
		const kit = seed();
		const plugin = createUgcPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const names = plugin.tools.map((t) => t.name).sort();
		expect(names).toEqual(['ugc_check_video', 'ugc_generate_video', 'ugc_list_people', 'ugc_list_talents', 'ugc_review_video']);
		expect(names.some((n) => n.startsWith('content_'))).toBe(false);
	});

	it("ugc_generate_video non espone content_type — è forzato, non un parametro", () => {
		const kit = seed();
		const plugin = createUgcPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const spec = plugin.tools.find((t) => t.name === 'ugc_generate_video')!;
		const props = (spec.inputSchema as { properties: Record<string, unknown> }).properties;
		expect(props.content_type).toBeUndefined();
		expect(props.brief).toBeDefined();
	});
});

describe('ugc_generate_video — chiama create_post con content_type forzato e scrive la riga', () => {
	it('brief semplice: crea un post video (mutazione 1), ugc default true', async () => {
		const kit = seed();
		const plugin = createUgcPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'ugc_generate_video', args: { brief: 'Recensione prodotto' } }, fakeContext());
		expect(res.isError).toBeFalsy();
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.success).toBe(true);
		expect(out.format).toBe('video');
		expect(createSingleContent).toHaveBeenCalledTimes(1);
		expect(createSingleContent.mock.calls[0][0]).toMatchObject({ ugc: true, format: 'reel' });
		const rows = kit.tables.get('posts') ?? [];
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ brand_id: BRAND_ID, format: 'video', status: 'pending_user' });
	});

	it('ugc:false rispettato (b-roll silenzioso), non forzato a true (mutazione 2)', async () => {
		const kit = seed();
		const plugin = createUgcPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'ugc_generate_video', args: { brief: 'B-roll prodotto', ugc: false, video_prompt: 'push-in lento sul prodotto' } },
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		expect(createSingleContent.mock.calls[0][0]).toMatchObject({ ugc: false });
		expect((kit.tables.get('posts') ?? [])).toHaveLength(1);
	});

	it('brief mancante → rifiutato PRIMA di chiamare create_post, nessuna riga scritta', async () => {
		const kit = seed();
		const plugin = createUgcPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'ugc_generate_video', args: {} }, fakeContext());
		expect(res.isError).toBe(true);
		expect(createSingleContent).not.toHaveBeenCalled();
		expect(kit.tables.get('posts') ?? []).toHaveLength(0);
	});

	it('una persona reale senza consent viene DROPPATA in silenzio (non rifiutata) — il post si crea comunque, senza il suo volto (mutazione 3)', async () => {
		const kit = seed({
			people: [{ id: 'person-1', brand_id: BRAND_ID, name: 'Jane', kind: 'real', images: [{ path: 'x.png' }], consent: false }]
		});
		const plugin = createUgcPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'ugc_generate_video', args: { brief: 'Jane parla del prodotto', people_ids: ['person-1'] } },
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		// resolvePeopleVisualRefs (non Detailed) droppa Jane senza sollevare errore: create_post
		// riceve referenceImages vuoto/assente, non un rifiuto.
		expect(createSingleContent.mock.calls[0][0].referenceImages).toBeUndefined();
		expect(kit.tables.get('posts') ?? []).toHaveLength(1);
	});
});

describe('ugc_check_video — stato onesto, non un tool di chat', () => {
	it('rendering:true → is_video_ready false, hint dice di aspettare', async () => {
		const kit = seed({
			posts: [{ id: 'post-1', brand_id: BRAND_ID, status: 'pending_user', content_type: 'generated_image', video_render_status: 'rendering', media_url: 'https://cdn.test/cover.png' }]
		});
		const plugin = createUgcPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'ugc_check_video', args: { post_id: 'post-1' } }, fakeContext());
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.is_video_ready).toBe(false);
		expect(out.hint).toContain('rendering');
	});

	it('post inesistente → errore', async () => {
		const kit = seed();
		const plugin = createUgcPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'ugc_check_video', args: { post_id: 'nope' } }, fakeContext());
		expect(res.isError).toBe(true);
	});
});

describe('ugc_list_people / ugc_list_talents — read_people/read_talents as-is', () => {
	it('elenca le persone del brand con id propagato', async () => {
		const kit = seed({
			people: [{ id: 'person-1', brand_id: BRAND_ID, name: 'Jane', kind: 'ai', images: [] }]
		});
		const plugin = createUgcPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'ugc_list_people', args: {} }, fakeContext());
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.people[0].id).toBe('person-1');
	});
});
