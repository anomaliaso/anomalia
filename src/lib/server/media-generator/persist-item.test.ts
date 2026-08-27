import { describe, expect, it } from 'vitest';
import { updateMediaGeneratorItemUrl } from './persist';

/**
 * L'edit di `design_graphic` deve aggiornare la SUA tessera: prima salvava storage e riga di
 * versione ma nessuno toccava `media_generator_items.url` — la griglia mostrava l'immagine
 * vecchia e l'edit sembrava non essere mai successo.
 */

function fakeClient() {
	const calls: Array<{ payload: Record<string, unknown>; filters: Record<string, string> }> = [];
	const client = {
		from: (table: string) => ({
			update: (payload: Record<string, unknown>) => {
				const filters: Record<string, string> = {};
				const entry = { table, payload, filters };
				calls.push(entry);
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const q: any = {
					eq: (col: string, val: string) => {
						filters[col] = val;
						return q;
					},
					then: (resolve: (v: unknown) => void) => resolve({ error: null })
				};
				return q;
			}
		})
	};
	return { client: client as never, calls };
}

describe('updateMediaGeneratorItemUrl', () => {
	it('aggiorna url (e prompt) della tessera, scopata per brand + id', async () => {
		const { client, calls } = fakeClient();
		const res = await updateMediaGeneratorItemUrl(client, {
			brandId: 'b1',
			itemId: 'item-1',
			url: 'https://media/x-v2.png',
			prompt: 'make the price red'
		});
		expect(res.ok).toBe(true);
		expect(calls[0].payload).toMatchObject({ url: 'https://media/x-v2.png', prompt: 'make the price red' });
		// Senza il filtro sul brand un id indovinato aggiornerebbe la tessera di un altro brand.
		expect(calls[0].filters).toEqual({ brand_id: 'b1', id: 'item-1' });
	});

	it('rifiuta un url non-https senza toccare il database', async () => {
		const { client, calls } = fakeClient();
		const res = await updateMediaGeneratorItemUrl(client, {
			brandId: 'b1',
			itemId: 'item-1',
			url: 'data:image/png;base64,xxx'
		});
		expect(res.ok).toBe(false);
		expect(calls.length).toBe(0);
	});
});
