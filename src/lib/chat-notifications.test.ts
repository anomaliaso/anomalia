import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function installGlobals(opts: {
	desktop?: boolean;
	permission?: NotificationPermission;
	visibility?: DocumentVisibilityState;
	NotificationCtor?: ReturnType<typeof vi.fn>;
}) {
	const desktop = opts.desktop ?? true;
	const permission = opts.permission ?? 'default';
	const visibility = opts.visibility ?? 'hidden';
	const NotificationCtor =
		opts.NotificationCtor ??
		vi.fn(function NotificationMock(this: { onclick: null }) {
			this.onclick = null;
		});

	const matchMedia = vi.fn().mockReturnValue({ matches: desktop });
	const Notification = Object.assign(NotificationCtor, { permission });

	vi.stubGlobal('window', {
		matchMedia,
		Notification,
	});
	vi.stubGlobal('document', {
		visibilityState: visibility,
	});
	vi.stubGlobal('Notification', Notification);

	return { NotificationCtor, matchMedia };
}

describe('chat-notifications', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('supports notifications on desktop when Notification exists', async () => {
		installGlobals({ desktop: true, permission: 'default' });
		const mod = await import('./chat-notifications');
		expect(mod.supportsChatNotifications()).toBe(true);
		expect(mod.shouldShowChatNotifyBanner()).toBe(true);
	});

	it('hides banner once permission is granted', async () => {
		installGlobals({ permission: 'granted' });
		const mod = await import('./chat-notifications');
		expect(mod.getChatNotificationPermission()).toBe('granted');
		expect(mod.shouldShowChatNotifyBanner()).toBe(false);
	});

	it('does not support notifications on mobile viewport', async () => {
		installGlobals({ desktop: false, permission: 'default' });
		const mod = await import('./chat-notifications');
		expect(mod.supportsChatNotifications()).toBe(false);
		expect(mod.shouldShowChatNotifyBanner()).toBe(false);
	});

	it('shows a notification when permission granted and tab hidden', async () => {
		const { NotificationCtor } = installGlobals({ permission: 'granted', visibility: 'hidden' });
		const mod = await import('./chat-notifications');
		await mod.notifyChatReady({ title: 'Anomalia', body: 'Ready' });
		expect(NotificationCtor).toHaveBeenCalledWith(
			'Anomalia',
			expect.objectContaining({ body: 'Ready', tag: 'chat-ai-ready' })
		);
	});

	it('skips notification when tab is visible', async () => {
		const { NotificationCtor } = installGlobals({ permission: 'granted', visibility: 'visible' });
		const mod = await import('./chat-notifications');
		await mod.notifyChatReady({ title: 'Anomalia', body: 'Ready' });
		expect(NotificationCtor).not.toHaveBeenCalled();
	});
});
