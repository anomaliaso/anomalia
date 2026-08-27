import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.fn(async () => {});
const sendPushToUser = vi.fn(async () => ({ sent: 1, pruned: 0 }));

vi.mock('./email', () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));
vi.mock('./web-push', () => ({
	sendPushToUser: (...args: unknown[]) => sendPushToUser(...args)
}));
vi.mock('./email-i18n', () => ({
	emailLocale: (v: string | null | undefined) => (v?.startsWith('it') ? 'it' : 'en')
}));

describe('brand-notify', () => {
	beforeEach(() => {
		vi.resetModules();
		sendEmail.mockClear();
		sendPushToUser.mockClear();
		sendEmail.mockResolvedValue(undefined);
		sendPushToUser.mockResolvedValue({ sent: 1, pruned: 0 });
	});

	it('sends email then push; push failure does not throw or reduce emailed count', async () => {
		sendPushToUser.mockRejectedValueOnce(new Error('push down'));
		const { notifyBrandContacts } = await import('./brand-notify');
		const contacts = [
			{ userId: 'u1', email: 'a@x.com', locale: 'it' },
			{ userId: 'u2', email: 'b@x.com', locale: 'en' }
		];
		const emailed = await notifyBrandContacts({} as never, contacts, {
			buildEmail: (locale, to) => ({
				to,
				subject: `Subj ${locale}`,
				html: '<p>x</p>',
				text: 'x'
			}),
			push: { url: 'https://anomalia.so/app/x', tag: 'test' }
		});
		expect(emailed).toBe(2);
		expect(sendEmail).toHaveBeenCalledTimes(2);
		expect(sendPushToUser).toHaveBeenCalled();
	});

	it('still returns emailed count when push helper throws entirely', async () => {
		sendPushToUser.mockImplementation(() => {
			throw new Error('boom');
		});
		const { notifyBrandContacts } = await import('./brand-notify');
		const emailed = await notifyBrandContacts(
			{} as never,
			[{ userId: 'u1', email: 'a@x.com', locale: 'en' }],
			{
				buildEmail: (_l, to) => ({ to, subject: 'Hello', html: 'h', text: 't' }),
				push: { url: 'https://anomalia.so/', tag: 't' }
			}
		);
		expect(emailed).toBe(1);
	});

	it('pushToBrandContacts never throws, and reports zero when every send fails', async () => {
		sendPushToUser.mockRejectedValue(new Error('nope'));
		const { pushToBrandContacts } = await import('./brand-notify');
		await expect(
			pushToBrandContacts({} as never, [{ userId: 'u1', email: 'a@x.com', locale: 'en' }], {
				body: 'hi',
				url: 'https://anomalia.so/',
				tag: 't'
			})
		).resolves.toEqual({ sent: 0, reached: 0 });
	});

	it('pushToBrandContacts counts devices and contacts actually reached', async () => {
		sendPushToUser.mockResolvedValueOnce({ sent: 2, pruned: 0 });
		sendPushToUser.mockResolvedValueOnce({ sent: 0, pruned: 0 });
		const { pushToBrandContacts } = await import('./brand-notify');
		const res = await pushToBrandContacts(
			{} as never,
			[
				{ userId: 'u1', email: 'a@x.com', locale: 'en' },
				{ userId: 'u2', email: 'b@x.com', locale: 'it' }
			],
			{ body: 'hi', url: 'https://anomalia.so/', tag: 't' }
		);
		expect(res).toEqual({ sent: 2, reached: 1 });
	});
});
