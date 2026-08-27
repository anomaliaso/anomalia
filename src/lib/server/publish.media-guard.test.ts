import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publishApprovedPost, type ApprovablePost } from './publish';

/**
 * UN POST VISIVO SENZA IMMAGINE NON DEVE PARTIRE.
 *
 * Misurato in produzione su 90 giorni: 31 post non-testuali senza `media_url` né `media_urls`, di
 * cui 5 approvati, 5 schedulati e uno PUBBLICATO. Il controllo deterministico esisteva già
 * (`deterministicPrepublishIssues`) ma girava solo dal cron poco prima dello slot, e c'è una porta
 * che gli passa davanti: il ramo "nessun account collegato" scrive `status = 'approved'` e torna
 * prima del gate.
 *
 * Questi test chiamano la strozzatura condivisa — quella da cui passano approve UI, CLI, chat,
 * approvazione via email, repost e riprogrammazione — e verificano che si fermi PRIMA di guardare
 * gli account, cioè prima di qualunque scrittura di stato.
 */

/** Supabase finto: risponde solo alla prima lettura (video_render_status) e conta le query. */
function fakeSupabase() {
	const tables: string[] = [];
	const builder = (table: string) => {
		tables.push(table);
		const b: Record<string, unknown> = {};
		for (const m of ['select', 'eq', 'in', 'is', 'not', 'order', 'limit', 'update']) {
			b[m] = () => b;
		}
		b.maybeSingle = async () => ({ data: { video_render_status: null }, error: null });
		b.single = async () => ({ data: null, error: null });
		b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
			resolve({ data: [], error: null });
		return b;
	};
	return { supabase: { from: builder } as unknown as SupabaseClient, tables };
}

const post = (over: Partial<ApprovablePost> = {}): ApprovablePost => ({
	id: 'p1',
	brand_id: 'b1',
	platform: 'instagram',
	caption: 'Una caption vera che non è un segnaposto.',
	media_url: null,
	slot: 'monday-09:00',
	scheduled_for: null,
	content_type: 'image',
	...over
});

describe('publishApprovedPost — la guardia sul media', () => {
	it('refuses a visual post with no media at all', async () => {
		const { supabase, tables } = fakeSupabase();
		const res = await publishApprovedPost(supabase, post(), 'Europe/Rome');
		expect(res.scheduled).toBe(0);
		expect(res.failed).toBe(1);
		expect(res.noAccount).toBe(false);
		expect(res.error).toMatch(/no image or video/i);
		// Si ferma prima di guardare gli account: nessuna riga di stato può essere scritta dopo.
		expect(tables).not.toContain('social_accounts');
	});

	it('refuses an empty-string media_url the same way a null one is refused', async () => {
		const { supabase } = fakeSupabase();
		const res = await publishApprovedPost(supabase, post({ media_url: '   ' }), 'Europe/Rome');
		expect(res.failed).toBe(1);
	});

	it('refuses a carousel whose slide list is empty', async () => {
		const { supabase } = fakeSupabase();
		const res = await publishApprovedPost(
			supabase,
			post({ content_type: 'carousel', media_urls: [] }),
			'Europe/Rome'
		);
		expect(res.failed).toBe(1);
	});

	it('lets a post with media through the guard (it then fails on no connected account)', async () => {
		const { supabase, tables } = fakeSupabase();
		const res = await publishApprovedPost(
			supabase,
			post({ media_url: 'https://cdn.example.com/a.png' }),
			'Europe/Rome'
		);
		expect(res.failed).toBe(0);
		expect(res.noAccount).toBe(true);
		expect(tables).toContain('social_accounts');
	});

	it('lets a carousel through on media_urls alone', async () => {
		const { supabase } = fakeSupabase();
		const res = await publishApprovedPost(
			supabase,
			post({
				content_type: 'carousel',
				media_urls: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png']
			}),
			'Europe/Rome'
		);
		expect(res.noAccount).toBe(true);
	});

	it('never blocks a text or link post — those have no visual to miss', async () => {
		const { supabase } = fakeSupabase();
		for (const content_type of ['text', 'link']) {
			const res = await publishApprovedPost(supabase, post({ content_type }), 'Europe/Rome');
			expect(res.noAccount, content_type).toBe(true);
		}
	});
});
