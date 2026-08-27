import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPublicVapidKey } from '$lib/server/web-push';

export const GET: RequestHandler = async () => {
	const publicKey = getPublicVapidKey();
	if (!publicKey) return json({ error: 'Web Push not configured' }, { status: 503 });
	return json({ publicKey });
};
