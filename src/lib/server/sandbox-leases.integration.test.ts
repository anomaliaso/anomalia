import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { acquireHolder, releaseHolder } from './sandbox-leases';

const enabled = process.env.SANDBOX_HOLDER_INTEGRATION === '1';
const integration = describe.skipIf(!enabled);
const url = process.env.SANDBOX_TEST_SUPABASE_URL;
const serviceKey = process.env.SANDBOX_TEST_SERVICE_ROLE_KEY;

if (enabled && (!url || !serviceKey)) {
	throw new Error('SANDBOX_TEST_SUPABASE_URL and SANDBOX_TEST_SERVICE_ROLE_KEY are required');
}

type LeaseDb = NonNullable<Parameters<typeof acquireHolder>[0]['db']>;

integration('sandbox holder lifecycle', () => {
	const client = createClient(url!, serviceKey!) as SupabaseClient;
	const db = client as LeaseDb;
	const sandboxName = `task85-integration-${Date.now()}`;
	let brandId = '';
	let stopCalls = 0;

	beforeAll(async () => {
		const { data, error } = await client.from('brands').select('id').eq('slug', 'demo').single();
		if (error || !data) throw new Error(`demo brand lookup failed: ${error?.message ?? 'no row'}`);
		brandId = data.id;
	});

	beforeEach(() => {
		stopCalls = 0;
	});

	afterEach(async () => {
		await client.from('sandbox_holders').delete().eq('sandbox_name', sandboxName);
	});

	afterAll(async () => {
		await client.from('sandbox_holders').delete().eq('sandbox_name', sandboxName);
	});

	it('refreshes one holder without duplicating it', async () => {
		const firstId = await acquireHolder({
			name: sandboxName,
			brandId,
			key: 'turn:refresh',
			kind: 'turn',
			ttlMs: 120_000,
			db
		});
		const { data: before } = await client
			.from('sandbox_holders')
			.select('id,expires_at')
			.eq('sandbox_name', sandboxName)
			.eq('holder_key', 'turn:refresh')
			.single();

		await new Promise((resolve) => setTimeout(resolve, 20));
		const secondId = await acquireHolder({
			name: sandboxName,
			brandId,
			key: 'turn:refresh',
			kind: 'turn',
			ttlMs: 120_000,
			db
		});
		const { data: after } = await client
			.from('sandbox_holders')
			.select('id,expires_at')
			.eq('sandbox_name', sandboxName)
			.eq('holder_key', 'turn:refresh')
			.single();

		expect(firstId).toBe(secondId);
		expect(after?.id).toBe(firstId);
		expect(new Date(after!.expires_at).getTime()).toBeGreaterThan(new Date(before!.expires_at).getTime());
		const { count } = await client
			.from('sandbox_holders')
			.select('id', { count: 'exact', head: true })
			.eq('sandbox_name', sandboxName);
		expect(count).toBe(1);
	});

	it('keeps two holders independent and stops only after the last release', async () => {
		const firstId = await acquireHolder({ name: sandboxName, brandId, key: 'turn:one', kind: 'turn', ttlMs: 120_000, db });
		const secondId = await acquireHolder({ name: sandboxName, brandId, key: 'turn:two', kind: 'turn', ttlMs: 120_000, db });
		const raw = { stop: async () => { stopCalls += 1; } };

		expect(firstId).not.toBe(secondId);
		await releaseHolder(firstId!, raw, db);
		expect(stopCalls).toBe(0);

		await releaseHolder(secondId!, raw, db);
		expect(stopCalls).toBe(1);
		const { count } = await client
			.from('sandbox_holders')
			.select('id', { count: 'exact', head: true })
			.eq('sandbox_name', sandboxName);
		expect(count).toBe(0);
	});

	it('does not let an expired holder block the last live release', async () => {
		await acquireHolder({ name: sandboxName, brandId, key: 'turn:expired', kind: 'turn', ttlMs: -1, db });
		const liveId = await acquireHolder({ name: sandboxName, brandId, key: 'turn:live', kind: 'turn', ttlMs: 120_000, db });

		await releaseHolder(liveId!, { stop: async () => { stopCalls += 1; } }, db);

		expect(stopCalls).toBe(1);
		const { count } = await client
			.from('sandbox_holders')
			.select('id', { count: 'exact', head: true })
			.eq('sandbox_name', sandboxName);
		expect(count).toBe(1);
	});

	it('swallows acquisition, release and stop errors', async () => {
		const brokenDb = { from: () => { throw new Error('db unavailable'); } } as unknown as LeaseDb;
		expect(await acquireHolder({ name: sandboxName, brandId, key: 'turn:db-error', kind: 'turn', ttlMs: 120_000, db: brokenDb })).toBeNull();
		await expect(releaseHolder('missing', { stop: async () => { stopCalls += 1; } }, brokenDb)).resolves.toBeUndefined();

		const id = await acquireHolder({ name: sandboxName, brandId, key: 'turn:stop-error', kind: 'turn', ttlMs: 120_000, db });
		await expect(releaseHolder(id!, { stop: async () => { throw new Error('stop unavailable'); } }, db)).resolves.toBeUndefined();
		const { count } = await client
			.from('sandbox_holders')
			.select('id', { count: 'exact', head: true })
			.eq('sandbox_name', sandboxName);
		expect(count).toBe(0);
	});
});
