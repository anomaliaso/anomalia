/** Desktop browser notifications for AI chat completion (tab still open). */

import { enableWebPush, getPushSubscription, supportsWebPush } from '$lib/web-push-client';

const DESKTOP_MQ = '(min-width: 768px)';

export function supportsChatNotifications(): boolean {
	if (typeof window === 'undefined') return false;
	if (!('Notification' in window)) return false;
	return window.matchMedia(DESKTOP_MQ).matches;
}

export function getChatNotificationPermission(): NotificationPermission | 'unsupported' {
	if (!supportsChatNotifications()) return 'unsupported';
	return Notification.permission;
}

/** True when we should pitch enabling notifications (desktop, not yet decided). */
export function shouldShowChatNotifyBanner(): boolean {
	return getChatNotificationPermission() === 'default';
}

/**
 * Opt into chat-ready alerts: requests permission and registers Web Push when available.
 * Falls back to local Notification permission only if Push isn't supported.
 */
export async function requestChatNotificationPermission(): Promise<
	NotificationPermission | 'unsupported'
> {
	if (!supportsChatNotifications()) return 'unsupported';
	if (supportsWebPush()) {
		try {
			return await enableWebPush();
		} catch {
			/* fall through to local permission */
		}
	}
	try {
		return await Notification.requestPermission();
	} catch {
		return Notification.permission;
	}
}

export type ChatReadyNotificationOpts = {
	title: string;
	body: string;
	/** Only notify when the document is in the background (default true). */
	onlyWhenHidden?: boolean;
};

/**
 * Show a local notification that the AI finished.
 * Skips when a Web Push subscription is active (server push handles it, avoids duplicates).
 * No-ops if unsupported, not granted, or (by default) the tab is visible.
 */
export async function notifyChatReady(opts: ChatReadyNotificationOpts): Promise<void> {
	if (!supportsChatNotifications()) return;
	if (Notification.permission !== 'granted') return;
	if (opts.onlyWhenHidden !== false && document.visibilityState === 'visible') return;

	// Prefer server Web Push when subscribed — SW uses skipIfFocused to avoid noise.
	try {
		if (supportsWebPush() && (await getPushSubscription())) return;
	} catch {
		/* use local */
	}

	try {
		const n = new Notification(opts.title, {
			body: opts.body,
			icon: '/icon-192.png',
			tag: 'chat-ai-ready'
		});
		n.onclick = () => {
			window.focus();
			n.close();
		};
	} catch {
		/* some browsers throw if permission flipped mid-flight */
	}
}
