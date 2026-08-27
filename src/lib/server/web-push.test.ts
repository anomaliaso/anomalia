import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' }
}));

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_VAPID_KEY: '', PUBLIC_APP_URL: 'https://anomalia.so' }
}));

describe('web-push server', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('getPublicVapidKey returns null when unset', async () => {
		const { getPublicVapidKey } = await import('./web-push');
		expect(getPublicVapidKey()).toBeNull();
	});

	it('sendPushToUser soft-noops without VAPID', async () => {
		const { sendPushToUser } = await import('./web-push');
		const supabase = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(async () => ({ data: [{ id: '1', endpoint: 'x', p256dh: 'a', auth: 'b' }] }))
				}))
			}))
		};
		const result = await sendPushToUser(supabase as never, 'user-1', {
			title: 'Anomalia',
			body: 'hi'
		});
		expect(result).toEqual({ sent: 0, pruned: 0 });
		expect(supabase.from).not.toHaveBeenCalled();
	});

	it('absolutePushUrl prefixes PUBLIC_APP_URL when relative', async () => {
		const { absolutePushUrl } = await import('./web-push');
		expect(absolutePushUrl('/app/x/chat/y')).toBe('https://anomalia.so/app/x/chat/y');
		expect(absolutePushUrl('https://anomalia.so/approve/t')).toBe('https://anomalia.so/approve/t');
	});
});
