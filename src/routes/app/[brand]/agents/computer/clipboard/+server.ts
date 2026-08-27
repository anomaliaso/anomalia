/**
 * GLI APPUNTI, NEI DUE SENSI — fra la VM del brand e il dispositivo di chi guarda.
 *
 * noVNC ha un suo pannello appunti, ma vive in un iframe di un altro dominio (`*.vercel.run`):
 * la nostra pagina non può leggerlo né scriverlo, e mandare l'utente a cercarlo lì dentro vuol
 * dire spiegargli un'interfaccia che non è nostra. Qui il ponte è esplicito: `xclip` sul display
 * che l'utente sta guardando, e dalla parte del browser la clipboard nativa.
 *
 * GET  → cosa c'è negli appunti della VM.
 * POST → mette negli appunti della VM quello che l'utente ha copiato sul suo dispositivo.
 *
 * La VM NON si apre da qui: se dorme, non c'è niente da copiare. Il risveglio è un gesto
 * esplicito («Prendi il controllo»), non l'effetto collaterale di un pulsante appunti.
 */
import { json } from '@sveltejs/kit';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import { readClipboard, writeClipboard } from '$lib/agent/adapters/graphical-bootstrap';
import { createVercelSandboxProvider } from '$lib/agent/bridge/adapters';
import type { AdapterContext } from '$lib/agent/kit/types';
import type { RequestHandler } from './$types';

/** Un appunto non è un trasferimento file: oltre questo, è un altro problema (e un'altra rotta). */
const MAX_CLIPBOARD_CHARS = 100_000;

async function connect(brandId: string, userId: string, agentId?: string, uiLocale?: unknown) {
	const sandbox = createVercelSandboxProvider();
	const ctx: AdapterContext = { brandId, userId, runId: 'computer-clipboard', locale: bilingualNoticeLocale(uiLocale), agentId };
	return { sandbox, ctx, ref: await sandbox.provision({ brandId, agentId }, ctx) };
}

async function brandFor(supabase: App.Locals['supabase'], slug: string) {
	const { data } = await supabase.from('brands').select('id').eq('slug', slug).maybeSingle();
	return data;
}

export const GET: RequestHandler = async ({ params, url, locals: { supabase, safeGetSession, locale: uiLocale } }) => {
	const { user } = await safeGetSession();
	if (!user) return new Response('Unauthorized', { status: 401 });
	const brand = await brandFor(supabase, params.brand);
	if (!brand) return new Response('Not found', { status: 404 });

	const { sandbox, ctx, ref } = await connect(brand.id, user.id, url.searchParams.get('agent') || undefined, uiLocale);
	const res = await readClipboard(sandbox, ref, ctx);
	if (!res.ok) return json({ error: 'clipboard_failed', detail: res.error }, { status: 502 });
	return json({ text: res.text.slice(0, MAX_CLIPBOARD_CHARS) }, { headers: { 'cache-control': 'no-store' } });
};

export const POST: RequestHandler = async ({ params, request, url, locals: { supabase, safeGetSession, locale: uiLocale } }) => {
	const { user } = await safeGetSession();
	if (!user) return new Response('Unauthorized', { status: 401 });
	const brand = await brandFor(supabase, params.brand);
	if (!brand) return new Response('Not found', { status: 404 });

	const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
	const text = typeof body?.text === 'string' ? body.text.slice(0, MAX_CLIPBOARD_CHARS) : '';
	if (!text) return json({ error: 'empty' }, { status: 400 });

	const { sandbox, ctx, ref } = await connect(brand.id, user.id, url.searchParams.get('agent') || undefined, uiLocale);
	const res = await writeClipboard(sandbox, ref, ctx, text);
	if (!res.ok) return json({ error: 'clipboard_failed', detail: res.error }, { status: 502 });
	return json({ ok: true });
};
