import { swallow } from '$lib/server/swallow';
import webpush from 'web-push';
import { env } from '$env/dynamic/private';
import { env as pub } from '$env/dynamic/public';
import { supportEmail } from '$lib/server/support-config';
import type { SupabaseClient } from '@supabase/supabase-js';

export type PushPayload = {
	title: string;
	body: string;
	url?: string;
	tag?: string;
	/** When true, the service worker skips showing if an Anomalia tab is focused. */
	skipIfFocused?: boolean;
};

function vapidConfigured(): boolean {
	return !!(pub.PUBLIC_VAPID_KEY && env.VAPID_PRIVATE_KEY);
}

function ensureVapid(): boolean {
	if (!vapidConfigured()) return false;
	webpush.setVapidDetails(
		env.VAPID_SUBJECT || `mailto:${supportEmail()}`,
		pub.PUBLIC_VAPID_KEY!,
		env.VAPID_PRIVATE_KEY!
	);
	return true;
}

export function getPublicVapidKey(): string | null {
	return pub.PUBLIC_VAPID_KEY || null;
}

/** Prefer absolute URLs — ServiceWorkerClients.openWindow requires them. */
export function absolutePushUrl(url?: string): string {
	const raw = (url || '/').trim() || '/';
	if (/^https?:\/\//i.test(raw)) return raw;
	const base = (pub.PUBLIC_APP_URL || '').replace(/\/$/, '');
	if (!base) return raw.startsWith('/') ? raw : `/${raw}`;
	return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

/**
 * Send a Web Push to every stored subscription for a user.
 * Gone/expired endpoints are deleted. Soft-noops if VAPID is not configured.
 */
export async function sendPushToUser(
	supabase: SupabaseClient,
	userId: string,
	payload: PushPayload
): Promise<{ sent: number; pruned: number }> {
	if (!ensureVapid()) return { sent: 0, pruned: 0 };

	const { data: rows } = await supabase
		.from('push_subscriptions')
		.select('id, endpoint, p256dh, auth')
		.eq('user_id', userId);

	if (!rows?.length) return { sent: 0, pruned: 0 };

	const body = JSON.stringify({
		title: payload.title,
		body: payload.body,
		url: absolutePushUrl(payload.url),
		tag: payload.tag || 'anomalia',
		icon: '/icon-192.png',
		skipIfFocused: !!payload.skipIfFocused
	});

	let sent = 0;
	let pruned = 0;

	await Promise.all(
		rows.map(async (row) => {
			try {
				await webpush.sendNotification(
					{
						endpoint: row.endpoint,
						keys: { p256dh: row.p256dh, auth: row.auth }
					},
					body,
					{ TTL: 60 * 60 }
				);
				sent += 1;
			} catch (e: unknown) {
				const status = (e as { statusCode?: number })?.statusCode;
				// 404/410 = subscription gone
				if (status === 404 || status === 410) {
					await supabase.from('push_subscriptions').delete().eq('id', row.id);
					pruned += 1;
				} else {
					console.warn('[web-push] send failed', status ?? e);
				}
			}
		})
	);

	return { sent, pruned };
}

