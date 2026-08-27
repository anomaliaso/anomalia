/**
 * I fotogrammi di `motion_stills` / `render_stills` devono finire NELLA CHAT, non solo
 * negli occhi del modello.
 *
 * Il risultato del tool allega i PNG come `image-data` perché il modello li GUARDI. Quella
 * copia non è un artefatto: non ha una riga, non ha un url nostro, e la UI della chat non la
 * disegna. Senza questo passo l'utente vede una chip "motion stills" e zero immagini, mentre
 * l'agente ragiona su fotogrammi che si è tenuto per sé.
 *
 * Si pubblica QUI, dalla stessa chiamata che ha reso i frame — non si chiede al modello di
 * ricordarsi `publish_artifact` o `show_media` dopo. Un artefatto per fotogramma, ancorato al
 * `tool_call_id` della chiamata, così la card compare nel punto giusto del turno.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { publishArtifact, type PublishedArtifact } from '$lib/server/chat/artifacts';

export async function publishMotionStillArtifacts(opts: {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
	threadId?: string | null;
	toolCallId?: string | null;
	title: string;
	frames: Array<{ frame: number; png: Buffer }>;
}): Promise<PublishedArtifact[]> {
	if (!opts.threadId || !opts.userId || !opts.frames.length) return [];
	const title = opts.title.trim() || 'Motion still';
	const out: PublishedArtifact[] = [];
	for (const { frame, png } of opts.frames) {
		if (!png.length) continue;
		const { artifact } = await publishArtifact(opts.supabase, {
			brandId: opts.brandId,
			userId: opts.userId,
			threadId: opts.threadId,
			title: `${title} · frame ${frame}`,
			description: `Frame ${frame} of "${title}"`,
			fileName: `still-f${frame}.png`,
			bytes: png,
			mime: 'image/png',
			toolCallId: opts.toolCallId ?? null,
			createdBy: 'agent',
			source: 'tool'
		});
		if (artifact) out.push(artifact);
	}
	return out;
}
