import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import { fakeContext } from '../testkit';

const searchKnowledge = vi.fn();
vi.mock('$lib/server/knowledge', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/knowledge')>();
	return { ...actual, searchKnowledge };
});

const { createGroundingPlugin } = await import('./grounding');

const BRAND_ID = 'b1';
const USER_ID = 'u1';

function plugin() {
	const kit = createTestSupabase({ brands: [{ id: BRAND_ID, name: 'Acme', content_prefs: {} }] });
	return createGroundingPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID, threadId: 'th-1' });
}

beforeEach(() => {
	searchKnowledge.mockReset().mockResolvedValue([
		{ chunkId: 'c1', documentId: 'd1', documentTitle: 'Contratto quadro', headingPath: 'Garanzie', text: 'La garanzia dura 24 mesi.' }
	]);
});

describe('grounding — la ricerca semantica che `query` non sa fare', () => {
	it('espone search_knowledge, e nient’altro: il grounding non è un mestiere', () => {
		expect(plugin().tools.map((t) => t.name)).toEqual(['search_knowledge']);
	});

	it('lo schema è quello del tool vero: query, limit, collection, document_ids', () => {
		const schema = plugin().tools[0].inputSchema as { properties?: Record<string, unknown>; required?: string[] };
		expect(Object.keys(schema.properties ?? {}).sort()).toEqual(['collection', 'document_ids', 'limit', 'query']);
		expect(schema.required).toContain('query');
	});

	it('passa la domanda alla ricerca ibrida vera e restituisce i passaggi con il documento', async () => {
		const res = await plugin().execute(
			{ name: 'search_knowledge', args: { query: 'quanto dura la garanzia', limit: 3, collection: 'legal' } },
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		expect(searchKnowledge).toHaveBeenCalledTimes(1);
		const [, brandId, query, opts] = searchKnowledge.mock.calls[0];
		expect(brandId).toBe(BRAND_ID);
		expect(query).toBe('quanto dura la garanzia');
		expect(opts).toMatchObject({ limit: 3, collection: 'legal' });
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.count).toBe(1);
		expect(out.results[0].documentTitle).toBe('Contratto quadro');
	});

	it('un tool che non è suo si rifiuta dicendolo, non in silenzio', async () => {
		const res = await plugin().execute({ name: 'content_create_post', args: {} }, fakeContext());
		expect(res.isError).toBe(true);
	});
});

describe('grounding — montato su ogni specialista, non su uno solo', () => {
	it('ogni spec del kit riceve il plugin di grounding', async () => {
		const { kitPluginsFor } = await import('./registry');
		const { SPECIALISTS } = await import('../specs');
		const kit = createTestSupabase({ brands: [{ id: BRAND_ID, name: 'Acme', content_prefs: {} }] });
		for (const spec of SPECIALISTS) {
			const mounted = kitPluginsFor(spec.id, {
				supabase: kit.client,
				brandId: BRAND_ID,
				userId: USER_ID,
				threadId: 'th-1',
				locale: 'it'
			});
			const names = mounted.flatMap((p) => p.tools.map((t) => t.name));
			expect(names, spec.id).toContain('search_knowledge');
		}
	});
});
