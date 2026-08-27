import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import { fakeContext } from '../testkit';

// Ogni tool sugli articoli passa da `blogAdmin()` (chat/tools.ts), che apre l'admin client VERO:
// senza mockarlo ogni test colpirebbe Supabase di produzione (stesso motivo di
// schedule-article.test.ts, che questo file estende passando dal plugin invece che dal tool
// nudo). Una closure sola: tutti i test condividono lo stesso stato `articleAdmin`.
let articleAdmin: ReturnType<typeof createTestSupabase>;
vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: () => articleAdmin.client }));

// optimize_article / generate_article_cover / generate_article_images / write_planned_article
// chiamano AI vera (blog-generate.ts, content-preview.ts) — mockati per isolare il wrapper dal
// rendering, come in content.test.ts.
const generateArticleCover = vi.fn();
const generateArticleImages = vi.fn();
vi.mock('$lib/server/content-preview', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/content-preview')>();
	return { ...actual, generateArticleCover, generateArticleImages };
});

const optimizeArticleForScore = vi.fn();
const generatePlannedArticle = vi.fn();
vi.mock('$lib/server/blog-generate', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/blog-generate')>();
	return { ...actual, optimizeArticleForScore, generatePlannedArticle };
});

// dataforseoConfigured() legge env reali (DATAFORSEO_USERNAME/PASSWORD) — forzato qui per non
// dipendere da cosa capita di essere impostato in questo ambiente, e le fetch* mockate perché
// dfs_* è rete a pagamento vera.
const fetchDomainOverview = vi.fn();
vi.mock('$lib/server/dataforseo', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/dataforseo')>();
	return { ...actual, dataforseoConfigured: () => true, fetchDomainOverview };
});

const { createWebPlugin } = await import('./web');

const BRAND_ID = 'b1';
const USER_ID = 'u1';

function seed(articles: Record<string, unknown>[] = [], brandExtra: Record<string, unknown> = {}) {
	articleAdmin = createTestSupabase({
		brands: [{ id: BRAND_ID, name: 'Acme', website: 'https://acme.test', content_prefs: {}, blog_config: {}, plan: 'starter', ...brandExtra }],
		brand_articles: articles
	});
	return createTestSupabase({}); // il client RLS del plugin — i tool blog non lo usano, ma createChatTools lo richiede
}

beforeEach(() => {
	generateArticleCover.mockReset().mockResolvedValue('https://cdn.test/cover.png');
	generateArticleImages.mockReset().mockResolvedValue('# body con immagini');
	optimizeArticleForScore.mockReset().mockResolvedValue(undefined);
	generatePlannedArticle.mockReset().mockResolvedValue('art-new');
	fetchDomainOverview.mockReset().mockResolvedValue({ organicKeywords: 42 });
});

describe('web plugin — mount', () => {
	it('espone i tool blog + i 7 web_dfs_* (dataforseoConfigured forzato true), niente content_*/ugc_*', () => {
		const rls = seed();
		const plugin = createWebPlugin({ supabase: rls.client, brandId: BRAND_ID, userId: USER_ID });
		const names = plugin.tools.map((t) => t.name);
		const dfsNames = names.filter((n) => n.startsWith('web_dfs_'));
		expect(dfsNames).toHaveLength(7);
		expect(names).toContain('web_schedule_article');
		expect(names).toContain('web_seo_audit');
		expect(names.some((n) => n.startsWith('content_') || n.startsWith('ugc_'))).toBe(false);
	});
});

describe('web_schedule_article — solo "approved" pubblica (regola non riscritta, importata)', () => {
	it('con una data futura: scheduled_for + status approved, MAI published (mutazione 1)', async () => {
		const rls = seed([{ id: 'art-1', brand_id: BRAND_ID, title: 'Guida', status: 'draft' }]);
		const plugin = createWebPlugin({ supabase: rls.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'web_schedule_article', args: { article_id: 'art-1', scheduled_for: '2026-09-01T10:00' } },
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.success).toBe(true);
		const row = (articleAdmin.tables.get('brand_articles') ?? []).find((r) => r.id === 'art-1');
		expect(row?.status).toBe('approved');
		expect(row?.status).not.toBe('published');
	});

	it('un articolo già pubblicato si rifiuta, nessuna mutazione', async () => {
		const rls = seed([{ id: 'art-2', brand_id: BRAND_ID, title: 'Vecchio', status: 'published' }]);
		const plugin = createWebPlugin({ supabase: rls.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'web_schedule_article', args: { article_id: 'art-2', scheduled_for: '2026-09-01T10:00' } },
			fakeContext()
		);
		expect(res.isError).toBe(true);
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.error).toBe('Article is already published');
	});
});

describe('web_update_article — patch reale, mai lo status', () => {
	it('aggiorna title/body_md davvero (mutazione 2)', async () => {
		const rls = seed([{ id: 'art-3', brand_id: BRAND_ID, title: 'Bozza', status: 'draft', body_md: 'vecchio' }]);
		const plugin = createWebPlugin({ supabase: rls.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'web_update_article', args: { article_id: 'art-3', title: 'Titolo nuovo', body_md: 'nuovo corpo' } },
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		const row = (articleAdmin.tables.get('brand_articles') ?? []).find((r) => r.id === 'art-3');
		expect(row?.title).toBe('Titolo nuovo');
		expect(row?.body_md).toBe('nuovo corpo');
		expect(row?.status).toBe('draft'); // mai toccato
	});

	it('nessun campo passato → rifiutato, nessuna scrittura', async () => {
		const rls = seed([{ id: 'art-3', brand_id: BRAND_ID, title: 'Bozza', status: 'draft' }]);
		const plugin = createWebPlugin({ supabase: rls.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'web_update_article', args: { article_id: 'art-3' } }, fakeContext());
		expect(res.isError).toBe(true);
	});
});

describe('web_generate_article_cover — chiama la generazione VERA (mockata) e scrive cover_image', () => {
	it('aggiorna cover_image sulla riga reale (mutazione 3)', async () => {
		const rls = seed([{ id: 'art-4', brand_id: BRAND_ID, title: 'Con cover', status: 'draft', meta_description: 'una guida' }]);
		const plugin = createWebPlugin({ supabase: rls.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'web_generate_article_cover', args: { article_id: 'art-4' } }, fakeContext());
		expect(res.isError).toBeFalsy();
		expect(generateArticleCover).toHaveBeenCalledTimes(1);
		const row = (articleAdmin.tables.get('brand_articles') ?? []).find((r) => r.id === 'art-4');
		expect(row?.cover_image).toBe('https://cdn.test/cover.png');
	});
});

describe('web_dfs_domain_overview — avvolge dfs_domain_overview as-is', () => {
	it('propaga il risultato del tool vero', async () => {
		const rls = seed();
		const plugin = createWebPlugin({ supabase: rls.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'web_dfs_domain_overview', args: { url: 'acme.test' } }, fakeContext());
		expect(res.isError).toBeFalsy();
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.organicKeywords).toBe(42);
		expect(fetchDomainOverview).toHaveBeenCalledTimes(1);
	});
});
