import { describe, expect, it } from 'vitest';
import { ensureOrgForUser } from './org';

type Row = Record<string, any>;

/** organizations as production has it: several rows may share one owner_id, no unique constraint. */
function makeDb(seed: Row[] = []) {
	const orgs: Row[] = seed.map((r) => ({ ...r }));
	const members: Row[] = [];
	let clock = orgs.length;

	const client = {
		from: (table: string) => {
			if (table === 'organizations') {
				return {
					select: () => {
						const filters: Record<string, unknown> = {};
						const sorts: { col: string; asc: boolean }[] = [];
						const chain = {
							eq: (k: string, v: unknown) => {
								filters[k] = v;
								return chain;
							},
							order: (col: string, opts?: { ascending?: boolean }) => {
								sorts.push({ col, asc: opts?.ascending !== false });
								return chain;
							},
							limit: () => chain,
							maybeSingle: async () => {
								const rows = orgs
									.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
									.sort((a, b) => {
										for (const { col, asc } of sorts) {
											if (a[col] === b[col]) continue;
											return (a[col] < b[col] ? -1 : 1) * (asc ? 1 : -1);
										}
										return 0;
									});
								return { data: rows[0] ? { id: rows[0].id } : null, error: null };
							}
						};
						return chain;
					},
					insert: (row: Row) => ({
						select: () => ({
							single: async () => {
								const n = ++clock;
								const created = { id: `org-${n}`, created_at: `2026-09-0${n}`, ...row };
								orgs.push(created);
								return { data: { id: created.id }, error: null };
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

	return { client, orgs, members };
}

const USER = { id: 'u1', email: 'ana@example.com' } as never;

describe('ensureOrgForUser', () => {
	it('always answers with the same org when the owner has several', async () => {
		// Stored newest-first on purpose: picking "whatever row comes back" answers wrong.
		const db = makeDb([
			{ id: 'org-new', owner_id: 'u1', created_at: '2026-09-01' },
			{ id: 'org-mid', owner_id: 'u1', created_at: '2026-05-01' },
			{ id: 'org-old', owner_id: 'u1', created_at: '2026-01-01' }
		]);

		const answers = [
			await ensureOrgForUser(db.client as never, USER),
			await ensureOrgForUser(db.client as never, USER),
			await ensureOrgForUser(db.client as never, USER)
		];

		expect(answers).toEqual(['org-old', 'org-old', 'org-old']);
		expect(db.orgs).toHaveLength(3);
	});

	it('gives two concurrent first calls the same org id', async () => {
		const db = makeDb();

		const [a, b] = await Promise.all([
			ensureOrgForUser(db.client as never, USER),
			ensureOrgForUser(db.client as never, USER)
		]);

		expect(a).not.toBeNull();
		expect(a).toBe(b);
	});

	it('creates the org on a first call and reuses it on the next', async () => {
		const db = makeDb();

		const first = await ensureOrgForUser(db.client as never, USER);
		const second = await ensureOrgForUser(db.client as never, USER);

		expect(first).toBe(second);
		expect(db.orgs).toHaveLength(1);
		expect(db.members).toEqual([{ org_id: first, user_id: 'u1', role: 'owner' }]);
	});
});
