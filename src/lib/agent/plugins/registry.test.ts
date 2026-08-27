import { describe, expect, it } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import { SPECIALISTS } from '../specs';
import { kitPluginsFor, tradePluginFor, type KitPluginDeps } from './registry';

const BRAND_ID = 'b1';
const USER_ID = 'u1';

function deps(): KitPluginDeps {
	const kit = createTestSupabase({
		brands: [{ id: BRAND_ID, name: 'Acme', plan: 'starter', timezone: 'Europe/Rome', content_prefs: {} }]
	});
	return { supabase: kit.client, brandId: BRAND_ID, userId: USER_ID, threadId: 't1', locale: 'it' };
}

describe('la tabella agentId → plugin', () => {
	it('dà un mestiere a OGNI specialista, analyst compreso', () => {
		const d = deps();
		for (const spec of SPECIALISTS) {
			const trade = tradePluginFor(spec.id, d);
			expect(trade, `lo specialista '${spec.id}' non ha plugin di mestiere`).not.toBeNull();
			expect(trade!.tools.length, `il plugin di '${spec.id}' non espone tool`).toBeGreaterThan(0);
			const names = kitPluginsFor(spec.id, d).flatMap((pl) => pl.tools.map((t) => t.name));
			expect(names, `'${spec.id}' senza grounding`).toContain('search_knowledge');
		}
	});

	it('un agentId che non è uno specialista non monta niente', () => {
		expect(kitPluginsFor('generalista', deps())).toEqual([]);
	});
});

describe('il plugin analyst', () => {
	it('monta le letture del mestiere e run_analytics_review, che il briefing schedulato nomina a mano', () => {
		const names = tradePluginFor('analyst', deps())!.tools.map((t) => t.name).sort();
		expect(names).toEqual([
			'analyst_list_posts',
			'analyst_post_patterns',
			'analyst_read_leads',
			'analyst_read_strategy',
			'analyst_run_review',
			'analyst_update_gtm_plan'
		]);
	});

	it('legge i post dal database senza sessione utente, dove `query` rifiuta', async () => {
		const kit = createTestSupabase({
			brands: [{ id: BRAND_ID, name: 'Acme', plan: 'starter', timezone: 'Europe/Rome', content_prefs: {} }],
			posts: [
				{ id: 'p-1', brand_id: BRAND_ID, platform: 'instagram', caption: 'Il lancio', status: 'published', created_at: '2026-08-01T10:00:00Z' }
			]
		});
		const plugin = tradePluginFor('analyst', { supabase: kit.client, brandId: BRAND_ID, userId: USER_ID, threadId: 't1', locale: 'it' })!;
		const res = await plugin.execute(
			{ name: 'analyst_list_posts', args: { status: 'published' } },
			{ brandId: BRAND_ID, userId: USER_ID, runId: 'r1', locale: 'it' }
		);
		expect(res.isError).toBeFalsy();
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.posts.map((p: { caption: string }) => p.caption)).toEqual(['Il lancio']);
	});

	it('non monta i tool di un altro mestiere', () => {
		const names = tradePluginFor('analyst', deps())!.tools.map((t) => t.name);
		expect(names.some((n) => n.startsWith('content_') || n.startsWith('motion_') || n.startsWith('web_'))).toBe(false);
	});
});
