/**
 * L'avviso all'80% adesso parte da una rotta che il layout interroga ogni 45s, da ogni scheda
 * aperta: la deduplica non è più un dettaglio, è l'unica cosa che separa "una mail per periodo"
 * da "una mail ogni 45 secondi". Qui si pinna che due chiamate in parallelo ne mandano una sola.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const notifyBrandContacts = vi.fn(async () => {});

vi.mock('$lib/server/brand-notify', () => ({
	notifyBrandContacts: (...args: unknown[]) => notifyBrandContacts(...(args as [])),
}));
vi.mock('./scheduler', () => ({
	brandContacts: async () => [{ userId: 'u1', email: 'owner@example.com', locale: 'it' }]
}));

import { maybeSendCreditWarning, type CreditsUsage } from './credits';

/** org_usage con il vincolo unico (org_id, month) che fa perdere il secondo insert. */
function makeDb(rows: Row[]) {
	const table: Row[] = rows.map((r) => ({ ...r }));
	const build = (mode: 'select' | 'update', patch?: Row) => {
		const filters: Array<(r: Row) => boolean> = [];
		const run = () => {
			const hits = table.filter((r) => filters.every((f) => f(r)));
			if (mode === 'update') hits.forEach((r) => Object.assign(r, patch));
			return hits;
		};
		const api: Row = {
			eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
			or: (expr: string) => {
				const lt = /credits_warned_at\.lt\.([^,)]+)/.exec(expr)?.[1];
				filters.push(
					(r) => r.credits_warned_at == null || (!!lt && String(r.credits_warned_at) < lt)
				);
				return api;
			},
			select: () => api,
			maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
			then: (res?: (v: { data: Row[]; error: null }) => unknown) =>
				Promise.resolve(res ? res({ data: run(), error: null }) : { data: run(), error: null })
		};
		return api;
	};
	return {
		table,
		client: {
			from: () => ({
				select: () => build('select'),
				update: (patch: Row) => build('update', patch),
				insert: async (row: Row) => {
					if (table.some((r) => r.org_id === row.org_id && r.month === row.month)) {
						return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
					}
					table.push({ id: `u-${table.length + 1}`, ...row });
					return { data: null, error: null };
				}
			})
		}
	};
}

const BRAND = { id: 'brand-1', name: 'Brand', org_id: 'org-1', plan: 'pro', slug: 'brand' };

function usageAt(percent: number): CreditsUsage {
	const start = new Date('2026-08-01T00:00:00.000Z');
	return {
		used: percent * 120,
		quota: 12000,
		bonus: 0,
		remaining: Math.max(0, 12000 - percent * 120),
		periodStart: start,
		periodEnd: new Date('2026-09-01T00:00:00.000Z'),
		percent
	};
}

beforeEach(() => notifyBrandContacts.mockClear());

describe('maybeSendCreditWarning', () => {
	it('due poll simultanei mandano una mail sola', async () => {
		const db = makeDb([]);
		await Promise.all([
			maybeSendCreditWarning(db.client as never, BRAND, usageAt(85)),
			maybeSendCreditWarning(db.client as never, BRAND, usageAt(85))
		]);
		expect(notifyBrandContacts).toHaveBeenCalledTimes(1);
		expect(db.table).toHaveLength(1);
		expect(db.table[0].credits_warned_at).toBeTruthy();
	});

	it('non rimanda nello stesso periodo, ma riparte nel successivo', async () => {
		const db = makeDb([
			{ org_id: 'org-1', month: '2026-08-01', credits_warned_at: '2026-08-03T10:00:00.000Z' }
		]);
		await maybeSendCreditWarning(db.client as never, BRAND, usageAt(90));
		expect(notifyBrandContacts).not.toHaveBeenCalled();

		// Periodo dopo: riga nuova (month diverso), l'avviso torna a partire.
		const next = usageAt(90);
		next.periodStart = new Date('2026-09-01T00:00:00.000Z');
		next.periodEnd = new Date('2026-10-01T00:00:00.000Z');
		await maybeSendCreditWarning(db.client as never, BRAND, next);
		expect(notifyBrandContacts).toHaveBeenCalledTimes(1);
	});

	it('sotto la soglia non fa niente', async () => {
		const db = makeDb([]);
		await maybeSendCreditWarning(db.client as never, BRAND, usageAt(70));
		expect(notifyBrandContacts).not.toHaveBeenCalled();
		expect(db.table).toHaveLength(0);
	});
});
