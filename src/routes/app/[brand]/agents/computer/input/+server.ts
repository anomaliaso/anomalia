/**
 * LA TASTIERA DEL TELEFONO — testo e tasti dell'utente dentro la VM.
 *
 * Su desktop la tastiera passa da noVNC e questa rotta non serve. Su mobile no: la tastiera di
 * sistema si apre solo se un campo della NOSTRA pagina prende il fuoco, e quel campo non può
 * spedire eventi dentro un iframe di un altro dominio. Quindi il testo digitato arriva qui e lo
 * batte `xdotool` sul display, con le stesse azioni che l'agente usa per `act`.
 *
 * Non è un canale generico di comandi: passano `type` e `key`, niente altro.
 */
import { json } from '@sveltejs/kit';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import { runActions } from '$lib/agent/adapters/graphical-bootstrap';
import { createVercelSandboxProvider } from '$lib/agent/bridge/adapters';
import type { AdapterContext } from '$lib/agent/kit/types';
import type { RequestHandler } from './$types';

/** Una battuta di tastiera, non un incolla di documento: per quello ci sono gli appunti. */
const MAX_TYPE_CHARS = 2_000;
/** I tasti che una barra di controllo deve poter mandare. Niente scorciatoie di sistema. */
const ALLOWED_KEYS = new Set([
	'Return', 'Tab', 'Escape', 'BackSpace', 'Delete',
	'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'Page_Up', 'Page_Down',
	'ctrl+c', 'ctrl+v', 'ctrl+a', 'ctrl+x', 'ctrl+z'
]);

export const POST: RequestHandler = async ({ params, request, url, locals: { supabase, safeGetSession, locale: uiLocale } }) => {
	const { user } = await safeGetSession();
	if (!user) return new Response('Unauthorized', { status: 401 });

	const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
	if (!brand) return new Response('Not found', { status: 404 });

	const body = (await request.json().catch(() => null)) as { text?: unknown; key?: unknown } | null;
	const text = typeof body?.text === 'string' ? body.text.slice(0, MAX_TYPE_CHARS) : '';
	const key = typeof body?.key === 'string' ? body.key : '';
	if (key && !ALLOWED_KEYS.has(key)) return json({ error: 'key_not_allowed' }, { status: 400 });
	if (!text && !key) return json({ error: 'empty' }, { status: 400 });

	const sandbox = createVercelSandboxProvider();
	const ctx: AdapterContext = { brandId: brand.id, userId: user.id, runId: 'computer-input', locale: bilingualNoticeLocale(uiLocale), agentId: url.searchParams.get('agent') || undefined };
	const ref = await sandbox.provision({ brandId: brand.id, agentId: url.searchParams.get('agent') || undefined }, ctx);
	const res = await runActions(sandbox, ref, ctx, key ? [{ kind: 'key', key }] : [{ kind: 'type', text }]);
	if (!res.ok) return json({ error: 'input_failed', detail: res.error }, { status: 502 });
	return json({ ok: true });
};
