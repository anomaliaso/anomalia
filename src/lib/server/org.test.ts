import { describe, expect, it } from 'vitest';
import { ensureOrgForUser, OWNER_CONSTRAINT } from './org';

type Row = Record<string, any>;

/** organizations with the unique index production enforces on owner_id. */
function makeDb() {
	const orgs: Row[] = [];
	const members: Row[] = [];
	let orgInsertCalls = 0;

	const client = {
		from: (table: string) => {
			if (table === 'organizations') {
				return {
					select: () => {
						const filters: Record<string, unknown> = {};
						const chain = {
							eq: (k: string, v: unknown) => {
								filters[k] = v;
								return chain;
							},
							limit: () => chain,
							maybeSingle: async () => {
								const row = orgs.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
								return { data: row ? { id: row.id } : null, error: null };
							},
							single: async () => {
								const row = orgs.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
								return row
									? { data: { id: row.id }, error: null }
									: { data: null, error: { message: 'no rows returned' } };
							}
						};
						return chain;
					},
					insert: (row: Row) => ({
						select: () => ({
							single: async () => {
								orgInsertCalls++;
								if (orgs.some((r) => r.owner_id === row.owner_id)) {
									return {
										data: null,
										error: {
											message: `duplicate key value violates unique constraint "${OWNER_CONSTRAINT}"`
										}
									};
								}
								const id = `org-${orgs.length + 1}`;
								orgs.push({ id, ...row });
								return { data: { id }, error: null };
							}
						})
					})
				};
			}
			if (table === 'org_members') {
				return {
					insert: async (row: Row) => {
						members.push(row);
						return { data: null, error: null };
					}
				};
			}
			throw new Error(`unexpected table ${table}`);
		}
	};

	return { client, orgs, members, get orgInsertCalls() { return orgInsertCalls; } };
}

describe('ensureOrgForUser', () => {
	it('gives two concurrent calls for the same user the same org, not two', async () => {
		const db = makeDb();
		const user = { id: 'u1', email: 'ana@example.com' } as never;

		const [a, b] = await Promise.all([
			ensureOrgForUser(db.client as never, user),
			ensureOrgForUser(db.client as never, user)
		]);

		expect(a).not.toBeNull();
		expect(a).toBe(b);
		expect(db.orgs).toHaveLength(1);
	});

	it('still returns the existing org id on a normal, non-concurrent second call', async () => {
		const db = makeDb();
		const user = { id: 'u1', email: 'ana@example.com' } as never;

		const first = await ensureOrgForUser(db.client as never, user);
		const second = await ensureOrgForUser(db.client as never, user);

		expect(first).toBe(second);
		expect(db.orgs).toHaveLength(1);
	});
});
