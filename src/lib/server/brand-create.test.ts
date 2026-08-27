import { describe, expect, it } from 'vitest';
import { insertBrandWithSlug, SLUG_CONSTRAINT } from './brand-create';

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
							error: { message: 'duplicate key value violates unique constraint "brands_pkey"' }
						})
					})
				})
			})
		};
		const { data, error } = await insertBrandWithSlug(client as never, VALUES);
		expect(data).toBeNull();
		expect(error).toContain('brands_pkey');
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
