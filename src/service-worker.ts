/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

function toAbsoluteUrl(url: string): string {
	try {
		return new URL(url, sw.location.origin).href;
	} catch {
		return sw.location.origin + '/';
	}
}

sw.addEventListener('push', (event) => {
	event.waitUntil(
		(async () => {
			let data: {
				title?: string;
				body?: string;
				url?: string;
				tag?: string;
				icon?: string;
				skipIfFocused?: boolean;
			} = {};
			try {
				data = event.data?.json() ?? {};
			} catch {
				data = { body: event.data?.text() };
			}

			// Chat-style alerts: don't interrupt if the user is already looking at Anomalia.
			if (data.skipIfFocused) {
				const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
				if (clients.some((c) => (c as WindowClient).focused)) return;
			}

			const title = data.title || 'Anomalia';
			const targetUrl = toAbsoluteUrl(data.url || '/');
			const options: NotificationOptions = {
				body: data.body || '',
				icon: data.icon || '/icon-192.png',
				badge: '/icon-192.png',
				tag: data.tag || 'anomalia',
				data: { url: targetUrl },
				renotify: true
			};

			await sw.registration.showNotification(title, options);
		})()
	);
});

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = toAbsoluteUrl((event.notification.data && event.notification.data.url) || '/');
	event.waitUntil(
		(async () => {
			const all = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of all) {
				const c = client as WindowClient;
				if ('focus' in c) {
					await c.focus();
					if ('navigate' in c) {
						try {
							await c.navigate(url);
						} catch {
							/* older browsers */
						}
					}
					return;
				}
			}
			await sw.clients.openWindow(url);
		})()
	);
});
