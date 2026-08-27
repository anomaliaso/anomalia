/**
 * ATTACH VERO — dal filesystem della VM (o dalla galleria) alla bolla in chat.
 *
 * La storia che l'ha reso necessario (23/8): motion_render produce un MP4 pubblico, l'hint
 * dice «consegnalo come media», l'agente lo SCARICA nella VM e chiama attach — che era uno
 * stub e rispondeva «allegato: /tmp/...» senza fare niente. Il video esisteva, pubblico,
 * a un passo dalla chat, e l'utente non vedeva nulla.
 *
 * Tre strade, tutte con l'url come risultato E l'aggancio alla riga salvata (collect):
 *  - `media_id`  → la riga di brand_media, con l'url che ha (pubblico o path da firmare);
 *  - `path` http(s) → è GIÀ un url: nessun giro per la VM, si allega quello;
 *  - `path` nella VM → lettura dal sandbox (tetto dichiarato), upload sul bucket pubblico
 *    `media`, riga in brand_media (source 'agent': entra in galleria e in artifacts/).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterContext, ToolResult } from '../kit/types';
import type { SandboxProvider } from '../kit/interfaces';
import { ensureComputer } from '@anomalia/agent-core/computer';
import { createCheckpointStorage } from '@anomalia/agent-adapters/checkpoint-storage';

const MAX_ATTACH_BYTES = 64 * 1024 * 1024; // 64MB: sopra, si consegna il link e lo si dice.

const MIME: Record<string, string> = {
	mp4: 'video/mp4',
	webm: 'video/webm',
	mov: 'video/quicktime',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	pdf: 'application/pdf'
};

function ok(text: string): ToolResult {
	return { content: [{ type: 'text', text }] };
}
function err(text: string): ToolResult {
	return { content: [{ type: 'text', text }], isError: true };
}

export async function attachForChat(
	args: { path?: string; media_id?: string },
	ctx: AdapterContext,
	deps: {
		supabase: SupabaseClient;
		admin: SupabaseClient;
		sandbox: SandboxProvider;
		brandId: string;
		userId: string;
		collect: string[];
	}
): Promise<ToolResult> {
	try {
		// ── galleria ──
		if (args.media_id) {
			const { data: row } = await deps.supabase
				.from('brand_media')
				.select('id, url, storage_path, mime')
				.eq('id', args.media_id)
				.eq('brand_id', deps.brandId)
				.maybeSingle();
			if (!row) return err(`attach: nessun media '${args.media_id}' in questo brand`);
			let url = String(row.url ?? '');
			if (!/^https?:\/\//.test(url)) {
				const { data: signed } = await deps.supabase.storage
					.from('brand-knowledge')
					.createSignedUrl(String(row.storage_path), 60 * 60 * 24);
				if (!signed?.signedUrl) return err('attach: firma dell\'url fallita');
				url = signed.signedUrl;
			}
			deps.collect.push(url);
			return ok(`allegato in chat (visibile nella tua bolla): ${url}`);
		}

		const path = String(args.path ?? '');

		// ── è già un url ──
		if (/^https?:\/\//.test(path)) {
			deps.collect.push(path);
			// Se quell'url è un motion NOSTRO, dillo: l'id è la strada per rieditarlo (il
			// sorgente sta in artifacts/motion/<id>.md). Senza, un allegato è un vicolo cieco.
			const { data: mv } = await deps.supabase
				.from('motion_videos')
				.select('id')
				.eq('brand_id', deps.brandId)
				.eq('preview_url', path)
				.maybeSingle();
			return ok(
				mv
					? `allegato in chat (visibile nella tua bolla): ${path} — è il motion ${mv.id}: per modificarlo apri artifacts/motion/${mv.id}.md, che porta il sorgente.`
					: `allegato in chat (visibile nella tua bolla): ${path}`
			);
		}

		// ── file nella VM ──
		const ext = path.split('.').pop()?.toLowerCase() ?? '';
		const mime = MIME[ext];
		if (!mime) return err(`attach: estensione '.${ext}' non supportata (${Object.keys(MIME).join(', ')})`);

		// `ctx.agentId`: il file sta sulla macchina dell'agente che l'ha scritto, non su una del
		// brand — dal 26/8 ogni agente ha la sua.
		const ref = await ensureComputer(
			{ db: deps.admin, sandbox: deps.sandbox, home: createCheckpointStorage(deps.sandbox, deps.admin) },
			deps.brandId,
			ctx,
			ctx.agentId
		);
		const bytes = await deps.sandbox.readFile(ref, path, ctx);
		if (bytes.byteLength > MAX_ATTACH_BYTES) {
			return err(`attach: ${Math.round(bytes.byteLength / 1e6)}MB supera il tetto di 64MB — se il file ha già un url pubblico, allega quello`);
		}

		const name = path.split('/').pop() ?? 'file';
		const storagePath = `${deps.brandId}/agent/${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
		const { error: upErr } = await deps.supabase.storage
			.from('media')
			.upload(storagePath, bytes, { contentType: mime, upsert: false });
		if (upErr) return err(`attach: upload fallito — ${upErr.message}`);
		const url = deps.supabase.storage.from('media').getPublicUrl(storagePath).data.publicUrl;

		// In galleria (e quindi in artifacts/): un allegato dell'agente è un asset del brand.
		await deps.supabase
			.from('brand_media')
			.insert({
				brand_id: deps.brandId,
				user_id: deps.userId,
				kind: mime.startsWith('video') ? 'video' : mime.startsWith('image') ? 'image' : 'file',
				storage_path: storagePath,
				url,
				source: 'agent',
				mime,
				bytes: bytes.byteLength
			})
			.then(() => {}, () => {}); // la galleria è un di-più: se la insert fallisce, l'allegato resta valido

		deps.collect.push(url);
		return ok(`allegato in chat (visibile nella tua bolla): ${url}`);
	} catch (e) {
		return err(`attach fallito: ${e instanceof Error ? e.message : String(e)}`);
	}
}
