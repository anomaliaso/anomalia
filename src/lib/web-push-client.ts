/**
 * Client helpers for Web Push subscribe / unsubscribe.
 * Requires PUBLIC_VAPID_KEY and a registered service worker.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64);
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

export function supportsWebPush(): boolean {
	if (typeof window === 'undefined') return false;
	return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
	if (!supportsWebPush()) return null;
	try {
		// SvelteKit emits the SW at /service-worker.js
		await navigator.serviceWorker.register('/service-worker.js');
		return await navigator.serviceWorker.ready;
	} catch (e) {
		console.warn('[web-push] SW register failed', e);
		return null;
	}
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
	const reg = await ensureServiceWorker();
	if (!reg) return null;
	return reg.pushManager.getSubscription();
}

/**
 * Request notification permission, subscribe to push, and persist on the server.
 * Returns the browser permission result, or 'unsupported' if push can't be enabled.
 */
export async function enableWebPush(): Promise<NotificationPermission | 'unsupported'> {
	if (!supportsWebPush()) return 'unsupported';

	const perm =
		Notification.permission === 'granted'
			? 'granted'
			: await Notification.requestPermission();
	if (perm !== 'granted') return perm;

	const keyRes = await fetch('/api/push/vapid-public-key');
	if (!keyRes.ok) return 'unsupported';
	const { publicKey } = (await keyRes.json()) as { publicKey?: string };
	if (!publicKey) return 'unsupported';

	const reg = await ensureServiceWorker();
	if (!reg) return 'unsupported';

	const appKey = urlBase64ToUint8Array(publicKey) as BufferSource;
	let sub = await reg.pushManager.getSubscription();
	// If an old subscription was created with a different VAPID key, replace it.
	if (sub) {
		try {
			const existing = sub.options?.applicationServerKey;
			if (existing) {
				const prev = new Uint8Array(existing);
				const next = new Uint8Array(appKey as ArrayBuffer);
				const same =
					prev.length === next.length && prev.every((b, i) => b === next[i]);
				if (!same) {
					await sub.unsubscribe();
					sub = null;
				}
			}
		} catch {
			/* options may be unavailable — keep existing sub */
		}
	}
	if (!sub) {
		sub = await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: appKey
		});
	}

	const json = sub.toJSON();
	if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
		return 'unsupported';
	}

	const saveRes = await fetch('/api/push/subscribe', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			endpoint: json.endpoint,
			keys: json.keys,
			userAgent: navigator.userAgent
		})
	});
	if (!saveRes.ok) {
		console.warn('[web-push] failed to persist subscription', saveRes.status);
		return 'unsupported';
	}

	return 'granted';
}

export async function disableWebPush(): Promise<void> {
	const sub = await getPushSubscription();
	if (!sub) return;
	const endpoint = sub.endpoint;
	try {
		await sub.unsubscribe();
	} catch {
		/* ignore */
	}
	await fetch('/api/push/subscribe', {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ endpoint })
	}).catch(() => {});
}
