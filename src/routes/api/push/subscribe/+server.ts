import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

type SubscribeBody = {
	endpoint?: string;
	keys?: { p256dh?: string; auth?: string };
	userAgent?: string;
};

export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as SubscribeBody;
	const endpoint = body.endpoint?.trim();
	const p256dh = body.keys?.p256dh?.trim();
	const auth = body.keys?.auth?.trim();
	if (!endpoint || !p256dh || !auth) {
		return json({ error: 'Missing endpoint or keys' }, { status: 400 });
	}

	const { error } = await supabase.from('push_subscriptions').upsert(
		{
			user_id: user.id,
			endpoint,
			p256dh,
			auth,
			user_agent: body.userAgent?.slice(0, 500) ?? null,
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'endpoint' }
	);

	if (error) {
		console.error('[push/subscribe]', error.message);
		return json({ error: 'Failed to save subscription' }, { status: 500 });
	}

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as { endpoint?: string };
	const endpoint = body.endpoint?.trim();
	if (!endpoint) return json({ error: 'Missing endpoint' }, { status: 400 });

	await supabase.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint);
	return json({ ok: true });
};
