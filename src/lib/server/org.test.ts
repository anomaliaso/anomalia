import { describe, expect, it } from 'vitest';
import { ensureOrgForUser } from './org';

type Row = Record<string, any>;

/**
 * organizations as production has it: several rows may share one owner_id, no unique constraint.
 * brands rows carry the billing columns the paying-org lookup joins through.
 */
function makeDb(seed: Row[] = [], brands: Row[] = []) {
	const orgs: Row[] = seed.map((r) => ({ ...r }));
	const brandRows: Row[] = brands.map((r) => ({ ...r }));
	const members: Row[] = [];
	let clock = orgs.length;

	function sorted(rows: Row[], sorts: { col: string; asc: boolean }[]) {
		return [...rows].sort((a, b) => {
			for (const { col, asc } of sorts) {
				if (a[col] === b[col]) continue;
				return (a[col] < b[col] ? -1 : 1) * (asc ? 1 : -1);
			}
			return 0;
		});
	}

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
								const rows = sorted(
									orgs.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v)),
									sorts
								);
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
			if (table === 'brands') {
				return {
					select: () => {
						let rows = [...brandRows];
						const sorts: { col: string; asc: boolean }[] = [];
						const chain = {
							// Only shape used: the embedded organizations.owner_id filter.
							eq: (k: string, v: unknown) => {
								if (k === 'organizations.owner_id') {
									const owned = new Set(
										orgs.filter((o) => o.owner_id === v).map((o) => o.id)
									);
									rows = rows.filter((b) => owned.has(b.org_id));
								} else {
									rows = rows.filter((b) => b[k] === v);
								}
								return chain;
							},
							not: (k: string, _op: string, _v: unknown) => {
								rows = rows.filter((b) => b[k] !== null && b[k] !== undefined);
								return chain;
							},
							in: (k: string, vals: unknown[]) => {
								rows = rows.filter((b) => vals.includes(b[k]));
								return chain;
							},
							order: (col: string, opts?: { ascending?: boolean }) => {
								sorts.push({ col, asc: opts?.ascending !== false });
								return chain;
							},
							limit: () => chain,
							maybeSingle: async () => {
								const hit = sorted(rows, sorts)[0];
								return { data: hit ? { org_id: hit.org_id } : null, error: null };
							}
						};
						return chain;
					}
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

	return { client, orgs, brandRows, members };
}

const USER = { id: 'u1', email: 'ana@example.com' } as never;

const THREE_ORGS = [
	{ id: 'org-new', owner_id: 'u1', created_at: '2026-09-01' },
	{ id: 'org-mid', owner_id: 'u1', created_at: '2026-05-01' },
	{ id: 'org-old', owner_id: 'u1', created_at: '2026-01-01' }
];

describe('ensureOrgForUser', () => {
	it('answers with the paying org, not the oldest one', async () => {
		const db = makeDb(THREE_ORGS, [
			{ org_id: 'org-mid', plan: 'pro', stripe_subscription_id: 'sub_1' },
			{ org_id: 'org-old', plan: null, stripe_subscription_id: null }
		]);

		expect(await ensureOrgForUser(db.client as never, USER)).toBe('org-mid');
	});

	it('ignores a brand whose subscription was cancelled (plan cleared)', async () => {
		const db = makeDb(THREE_ORGS, [
			{ org_id: 'org-mid', plan: null, stripe_subscription_id: 'sub_dead' }
		]);

		expect(await ensureOrgForUser(db.client as never, USER)).toBe('org-old');
	});

	it('ignores another owner’s paying brand', async () => {
		const db = makeDb(
			[...THREE_ORGS, { id: 'org-theirs', owner_id: 'u2', created_at: '2026-02-01' }],
			[{ org_id: 'org-theirs', plan: 'pro', stripe_subscription_id: 'sub_2' }]
		);

		expect(await ensureOrgForUser(db.client as never, USER)).toBe('org-old');
	});

	it('always answers with the same org when the owner has several and none pays', async () => {
		// Stored newest-first on purpose: picking "whatever row comes back" answers wrong.
		const db = makeDb(THREE_ORGS);

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
