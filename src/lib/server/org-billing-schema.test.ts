import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Step A of the org-level billing migration is pure SQL, so the invariants the follow-up steps
 * (credits/gating, settings-actions, UI) will lean on live only in the migration file. These pin
 * the three that break silently rather than loudly if someone edits it.
 */
const MIGRATION = readFileSync(
	new URL('../../../supabase/migrations/20260903190000_org_billing_schema.sql', import.meta.url),
	'utf8'
);

describe('org billing schema migration', () => {
	it('syncs the org before falling back to the brand', () => {
		const orgUpdate = MIGRATION.indexOf('update public.organizations o set');
		const brandFallback = MIGRATION.indexOf('update public.brands b set');
		expect(orgUpdate).toBeGreaterThan(-1);
		expect(brandFallback).toBeGreaterThan(orgUpdate);
		// The fallback runs ONLY when no org claimed the customer; without this guard a migrated
		// org would have its frozen brand columns rewritten on every webhook.
		expect(MIGRATION).toMatch(/if _org_id is not null then[\s\S]*?return NEW;\s*end if;/);
	});

	it('lets a credit grant target exactly one of brand or org', () => {
		expect(MIGRATION).toContain('alter column brand_id drop not null');
		expect(MIGRATION).toMatch(
			/check \(\(brand_id is null\) <> \(org_id is null\)\)/
		);
		// An org-targeted grant has a null brand_id, so a brand-only policy would hide it.
		expect(MIGRATION).toMatch(/or org_id in \(select public\.auth_org_ids\(\)\)/);
	});

	it('keeps the new org-scoped tables and functions behind RLS', () => {
		expect(MIGRATION).toContain('alter table public.org_usage enable row level security');
		expect(MIGRATION).toMatch(
			/revoke execute on function public\.sum_org_ai_cost_usd\(uuid, timestamptz, timestamptz\) from public, anon/
		);
		expect(MIGRATION).toMatch(/revoke execute on function public\.auth_org_ids\(\) from public, anon/);
	});
});
