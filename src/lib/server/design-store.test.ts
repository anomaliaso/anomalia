import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseGraphicRow, saveGraphicVersion } from './design-store';
import { graphicHtmlMeta } from '$lib/design/graphic-source';

/**
 * IL SORGENTE NON SI PERDE IN SILENZIO.
 *
 * C'era un ripiego: se l'insert falliva con un errore che conteneva la parola "source", la riga
 * veniva reinserita SENZA `source` e la funzione tornava il numero di versione come se fosse
 * andata bene. Effetto misurato in produzione: `source` NULL su tutte e 18 le righe, e due
 * grafiche HTML v2 con uno `spec` di 41 caratteri e nessun sorgente — che `parseGraphicRow`
 * restituisce come `null`, cioè illeggibili per il codice che le aveva appena scritte.
 */

type Insert = Record<string, unknown>;

function fakeSupabase(opts: { insertError?: string; latest?: Record<string, unknown> | null } = {}) {
	const inserts: Insert[] = [];
	const builder = () => {
		const b: Record<string, unknown> = {};
		for (const m of ['select', 'eq', 'is', 'order', 'limit']) b[m] = () => b;
		b.maybeSingle = async () => ({ data: opts.latest ?? null, error: null });
		b.insert = async (payload: Insert) => {
			inserts.push(payload);
			return { error: opts.insertError ? { message: opts.insertError } : null };
		};
		return b;
	};
	return { supabase: { from: builder } as unknown as SupabaseClient, inserts };
}

const input = {
	brandId: 'b1',
	target: { kind: 'post' as const, id: 'p1', slideIndex: null },
	spec: graphicHtmlMeta('4:5', 'html'),
	source: '<div class="canvas" data-graphic>ciao</div>',
	mediaUrl: 'https://cdn.example.com/a.png'
};

describe('saveGraphicVersion', () => {
	it('writes the source with the version', async () => {
		const { supabase, inserts } = fakeSupabase();
		expect(await saveGraphicVersion(supabase, input)).toBe(1);
		expect(inserts).toHaveLength(1);
		expect(inserts[0].source).toBe(input.source);
	});

	it('numbers the next version from the newest one on file', async () => {
		const { supabase } = fakeSupabase({ latest: { id: 'g1', version: 4, spec: graphicHtmlMeta('4:5'), source: 'x', media_url: 'u', created_at: 'now' } });
		expect(await saveGraphicVersion(supabase, input)).toBe(5);
	});

	it('fails loudly instead of re-inserting the row without its source', async () => {
		const { supabase, inserts } = fakeSupabase({ insertError: "column 'source' does not exist" });
		expect(await saveGraphicVersion(supabase, input)).toBeNull();
		// UN solo tentativo: il secondo, mutilato, è esattamente il bug.
		expect(inserts).toHaveLength(1);
	});
});

describe('parseGraphicRow', () => {
	it('returns null for an HTML v2 row whose source was dropped — the shape the bug produced', () => {
		expect(
			parseGraphicRow({
				id: 'g1',
				version: 1,
				spec: graphicHtmlMeta('4:5', 'html'),
				source: null,
				media_url: 'https://cdn.example.com/a.png',
				brief: null,
				created_at: 'now'
			})
		).toBeNull();
	});

	it('reads an HTML v2 row that kept its source', () => {
		const row = parseGraphicRow({
			id: 'g1',
			version: 2,
			spec: graphicHtmlMeta('9:16', 'tsx'),
			source: 'export const width = 1080;',
			media_url: 'https://cdn.example.com/a.png',
			brief: 'brief',
			created_at: 'now'
		});
		expect(row?.sourceKind).toBe('tsx');
		expect(row?.aspect).toBe('9:16');
		expect(row?.spec).toBeNull();
	});
});
