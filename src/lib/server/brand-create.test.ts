import { describe, expect, it } from 'vitest';
import { ID_CONSTRAINT, insertBrandWithSlug, SLUG_CONSTRAINT } from './brand-create';

type Row = Record<string, any>;

/** brands with the global unique index production enforces (brands_slug_key). */
function makeDb(rows: Row[]) {
	const table: Row[] = rows.map((r) => ({ ...r }));
	let insertCalls = 0;
	return {
		get insertCalls() {
			return insertCalls;
		},
		client: {
			from: (_t: string) => ({
				insert: (row: Row) => ({
					select: () => ({
						single: async () => {
							insertCalls++;
							// La chiave primaria collide PRIMA dello slug, come in Postgres.
							if (table.some((r) => r.id === row.id)) {
								return {
									data: null,
									error: {
										message: `duplicate key value violates unique constraint "${ID_CONSTRAINT}"`
									}
								};
							}
							if (table.some((r) => r.slug === row.slug)) {
								return {
									data: null,
									error: { message: `duplicate key value violates unique constraint "${SLUG_CONSTRAINT}"` }
								};
							}
							table.push(row);
							return { data: { id: row.id, slug: row.slug, timezone: null }, error: null };
						}
					})
				}),
				select: () => {
					const filters: Record<string, unknown> = {};
					const chain = {
						eq: (k: string, v: unknown) => {
							filters[k] = v;
							return chain;
						},
						maybeSingle: async () => {
							const row = table.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
							return { data: row ? { id: row.id, slug: row.slug, timezone: null } : null, error: null };
						}
					};
					return chain;
				}
			})
		},
		table
	};
}

const VALUES = {
	id: 'b2',
	org_id: 'org-2',
	created_by: 'u1',
	onboarding_completed_at: null,
	name: 'يونس بن عمارة',
	website: 'https://youdo.blog',
	slug: 'brand',
	target_platforms: null
};

describe('insertBrandWithSlug', () => {
	it('retries with a random tail when another org already owns the slug', async () => {
		const db = makeDb([{ id: 'b1', org_id: 'org-1', slug: 'brand' }]);
		const { data, error } = await insertBrandWithSlug(db.client as never, VALUES);
		expect(error).toBeNull();
		expect(data?.slug).toMatch(/^brand-[a-z0-9]{4}$/);
		expect(db.insertCalls).toBe(2);
		expect(db.table.some((r) => r.id === 'b2')).toBe(true);
	});

	it('resumes the existing row when THIS org already owns the slug — no second brand, no abort', async () => {
		const db = makeDb([{ id: 'b-existing', org_id: 'org-2', slug: 'brand', timezone: null }]);
		const { data, error } = await insertBrandWithSlug(db.client as never, VALUES);
		expect(error).toBeNull();
		expect(data?.id).toBe('b-existing');
		expect(data?.slug).toBe('brand');
		expect(db.insertCalls).toBe(1);
		expect(db.table.filter((r) => r.org_id === 'org-2')).toHaveLength(1);
	});

	it('keeps the proposed slug when free', async () => {
		const db = makeDb([]);
		const { data, error } = await insertBrandWithSlug(db.client as never, VALUES);
		expect(error).toBeNull();
		expect(data?.slug).toBe('brand');
		expect(db.insertCalls).toBe(1);
	});

	it('surfaces non-slug errors without retrying', async () => {
		const client = {
			from: () => ({
				insert: () => ({
					select: () => ({
						single: async () => ({
							data: null,
							error: { message: 'null value in column "org_id" violates not-null constraint' }
						})
					})
				})
			})
		};
		const { data, error } = await insertBrandWithSlug(client as never, VALUES);
		expect(data).toBeNull();
		expect(error).toContain('org_id');
	});

	// L'id lo conia il BROWSER e arriva nel draft: non è una garanzia che sia libero. Quando è già
	// preso l'onboarding moriva qui, e l'utente non vedeva mai i suoi post (PostHog: `early_create`,
	// `duplicate key ... "brands_pkey"`, ultimo caso 25 agosto 2026).
	describe('id proposto dal client', () => {
		it("ne conia uno nuovo quando l'id proposto è già preso", async () => {
			const db = makeDb([{ id: 'b2', org_id: 'org-altro', slug: 'altro-slug' }]);
			const { data, error } = await insertBrandWithSlug(db.client as never, VALUES, {
				idSource: 'client-proposed'
			});
			expect(error).toBeNull();
			expect(data?.id).not.toBe('b2');
			expect(data?.id).toMatch(/^[0-9a-f-]{36}$/);
			expect(data?.slug).toBe('brand');
			expect(db.insertCalls).toBe(2);
		});

		it('non adotta MAI la riga di qualcun altro', async () => {
			const altrui = { id: 'b2', org_id: 'org-altro', slug: 'altro-slug', timezone: 'Asia/Tokyo' };
			const db = makeDb([altrui]);
			const { data } = await insertBrandWithSlug(db.client as never, VALUES, {
				idSource: 'client-proposed'
			});
			expect(data?.id).not.toBe(altrui.id);
			expect(db.table.filter((r) => r.org_id === 'org-altro')).toHaveLength(1);
			expect(db.table.find((r) => r.id === 'b2')).toEqual(altrui);
		});

		it('un id di cui ci fidiamo non viene sostituito: l’errore emerge', async () => {
			const db = makeDb([{ id: 'b2', org_id: 'org-altro', slug: 'altro-slug' }]);
			const { data, error } = await insertBrandWithSlug(db.client as never, VALUES);
			expect(data).toBeNull();
			expect(error).toContain(ID_CONSTRAINT);
			expect(db.insertCalls).toBe(1);
		});

		// Due submit dello STESSO brand devono convergere su una riga sola. Il secondo sbatte sulla
		// chiave primaria, conia un id nuovo, sbatte sullo slug e a quel punto riprende il brand che
		// il primo ha appena creato: un brand, non due.
		it('doppio submit concorrente: un brand solo, non due', async () => {
			const db = makeDb([]);
			const opts = { idSource: 'client-proposed' as const };
			const [a, b] = await Promise.all([
				insertBrandWithSlug(db.client as never, VALUES, opts),
				insertBrandWithSlug(db.client as never, VALUES, opts)
			]);
			expect(a.error).toBeNull();
			expect(b.error).toBeNull();
			expect(a.data?.id).toBe(b.data?.id);
			expect(db.table.filter((r) => r.org_id === 'org-2')).toHaveLength(1);
		});
	});

	it('gives up after the attempt budget', async () => {
		const client = {
			from: () => ({
				insert: () => ({
					select: () => ({
						single: async () => ({
							data: null,
							error: { message: `duplicate key value violates unique constraint "${SLUG_CONSTRAINT}"` }
						})
					})
				}),
				select: () => ({
					eq: () => ({
						eq: () => ({
							maybeSingle: async () => ({ data: null, error: null })
						})
					})
				})
			})
		};
		const { data, error } = await insertBrandWithSlug(client as never, VALUES);
		expect(data).toBeNull();
		expect(typeof error).toBe('string');
	});
});
