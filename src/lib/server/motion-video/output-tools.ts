/**
 * L'USCITA di un motion video: voce, musica e il file finito.
 *
 * Stanno insieme perché sono la stessa cosa vista da tre lati — ciò che il video DIVENTA, in
 * opposizione al sorgente che lo descrive. E stanno in un file solo perché vanno montati insieme:
 * una superficie che sa scrivere il TSX e non sa renderlo consegna codice, non video, e una che
 * conia la voce e non sa renderla consegna un MP4 muto.
 *
 * Il modulo che genera sta in `gemini-audio.ts`, il taglio in `voiceover-cut.ts`. Qui c'è solo il
 * ponte verso il modello: cosa può chiedere, cosa gli torna indietro, e le due o tre cose che deve
 * sapere per non sprecare la chiamata.
 *
 * La parte che conta è **cosa restituiamo**. Un tool che torna soltanto un url lascia all'agente il
 * problema più difficile — quanto dura questo pezzo, ci sta nel beat? — e la risposta se la
 * inventa. Qui ogni pezzo porta la sua durata reale in secondi E in fotogrammi al fps della
 * composizione, così la scelta diventa aritmetica invece che speranza.
 */
import { swallow } from '$lib/server/swallow';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getMotionVideo, updateMotionPreviewUrl } from '$lib/server/motion-video/persist';
import {
	MotionVoiceGateError,
	isVoiceoverTakeUrl,
	latestVoiceoverTakeUrl
} from '$lib/server/motion-video/voice-gate';
import {
	readSourceMeta,
	renderMotionMp4,
	renderMotionStills,
	type ContentPart
} from '$lib/server/motion-video/render-tools';
import {
	STORYBOARD_MIN_MS,
	createStoryboardGate,
	motionSourceFindings,
	storyboardFrames
} from '$lib/server/motion-video/storyboard';
import { motionBeats } from '$lib/motion-video/beats';
import { isSandboxConfigured } from '$lib/server/sandbox';
import { motionMp4Scale, parseMotionMp4Quality } from '$lib/motion-video/mp4-render';
import { motionAspectFromSize } from '$lib/motion-video/source';
import { errorMessage } from '$lib/server/gemini-audio';
import {
	cutVoiceOver,
	DEFAULT_VOICE,
	MAX_MUSIC_SECONDS,
	MUSIC_CLIP_SECONDS,
	VOICE_OVER_VOICES,
	generateMusicBed,
	generateVoiceOver,
	isVoiceOverVoice,
	type VoiceOverVoice
} from '$lib/server/gemini-audio';

/** Render finiti per turno. Ognuno è una VM accesa e crediti spesi: non è una cosa da riprovare a caso. */
export const MAX_VIDEO_RENDERS_PER_TURN = 2;
/**
 * Render finiti per VIDEO per GIORNO — il tetto vero, contato dal registro e non da una closure.
 *
 * "Per turno" era una bugia strutturale: ogni slice di continuazione azzerava il contatore, quindi
 * una sessione normale rendeva 3+ MP4 dello stesso video. E il tetto non può essere 2/giorno,
 * perché un re-render dopo una patch è normale — si confronta l'anteprima col sorgente. Quattro
 * copre bozza + due giri di correzione + una chiesta dall'utente; oltre, è un loop.
 */
export const MAX_VIDEO_RENDERS_PER_DAY = 4;

/**
 * Quanti MP4 di QUESTO video sono usciti oggi, letti dalle righe di addebito che ogni render
 * scrive comunque (`sandbox.motion_render`, context `sandbox:motion_render:NNs:<videoId>` — vedi
 * sandbox-credits.ts). Nessuna migrazione: il registro esiste già e i fallimenti contano, perché
 * hanno acceso una VM. `null` = registro illeggibile → il chiamante ripiega sul contatore di turno.
 */
export async function motionRendersToday(
	supabase: SupabaseClient,
	brandId: string,
	videoId: string
): Promise<number | null> {
	const dayStart = new Date();
	dayStart.setUTCHours(0, 0, 0, 0);
	const { count, error } = await supabase
		.from('ai_calls')
		.select('id', { count: 'exact', head: true })
		.eq('brand_id', brandId)
		.eq('label', 'sandbox.motion_render')
		.like('context', `%:${videoId}`)
		.gte('created_at', dayStart.toISOString());
	if (error) {
		console.warn('[motion-output] renders-today query failed:', error.message);
		return null;
	}
	return count ?? 0;
}

/**
 * Il budget di render, con il ripiego dichiarato: registro leggibile → tetto giornaliero per
 * video; illeggibile → il vecchio tetto per turno, che almeno dentro UNA slice resta vero.
 */
export function motionRenderBudget(
	usedToday: number | null,
	turnRenders: number
): { blocked: boolean; rendersLeft: number; scope: 'day' | 'turn' } {
	if (usedToday == null) {
		return {
			blocked: turnRenders >= MAX_VIDEO_RENDERS_PER_TURN,
			rendersLeft: Math.max(0, MAX_VIDEO_RENDERS_PER_TURN - turnRenders),
			scope: 'turn'
		};
	}
	return {
		blocked: usedToday >= MAX_VIDEO_RENDERS_PER_DAY,
		rendersLeft: Math.max(0, MAX_VIDEO_RENDERS_PER_DAY - usedToday),
		scope: 'day'
	};
}

/**
 * Classi di fallimento PERMANENTI della musica: modello sbagliato/ritirato, chiave assente,
 * richiesta rifiutata. Riprovare nello stesso turno compra lo stesso errore due volte — il secondo
 * slot di budget andava sprecato così. Classi e marcatori, non stringhe esatte: il backend può
 * essere riscritto (Lyria 3) senza che questo filtro smetta di distinguere un 404 da un 503.
 */
export function permanentMusicFailure(detail: string): boolean {
	return /\b(400|401|403|404|422)\b|NOT_FOUND|INVALID_ARGUMENT|PERMISSION_DENIED|FAILED_PRECONDITION|GEMINI_MUSIC_MODEL|not configured|api key/i.test(
		detail
	);
}

// `latestVoiceoverTakeUrl` e `isVoiceoverTakeUrl` vivono ora in voice-gate.ts (il gate sulla voce
// ne ha bisogno e questo modulo importa già da quel lato). Ri-esportati per i chiamanti esistenti.
export { isVoiceoverTakeUrl, latestVoiceoverTakeUrl };


const VOICE_LINES = Object.entries(VOICE_OVER_VOICES)
	.map(([k, v]) => `${k} = ${v}`)
	.join(' · ');

export function createMotionOutputTools(opts: {
	supabase: SupabaseClient;
	brandId: string;
	userId?: string;
	/** fps della composizione: serve a dare le durate anche in fotogrammi. */
	fps: () => number;
	remainingMs?: () => number;
	abortSignal?: AbortSignal;
	locale?: string;
}) {
	let renders = 0;
	/**
	 * Un modello ritirato o una chiave assente non si riparano riprovando: la musica si spegne per
	 * il resto del turno. È l'UNICO freno rimasto sull'audio — i tentativi non hanno un tetto,
	 * perché provare una voce e un letto è il mestiere, e la spesa la governano i crediti.
	 */
	let musicUnavailable = false;
	/** Lo storyboard di questo turno: chi l'ha già visto, e quante volte si può ancora rimandare. */
	const storyboard = createStoryboardGate();
	/** I PNG dello storyboard, consegnati al modello da `toModelOutput` (vedi render-tools.ts). */
	const pendingStoryboard = new Map<string, ContentPart[]>();
	/** L'ultima registrazione, così `cut_voiceover` non chiede di ripetere l'url. */
	let lastTake: { url: string; lines: string[] } | null = null;

	return {
		render_motion_video: tool({
			description: [
				'Render the FINISHED MP4 of a motion video, server-side, and attach it to the gallery as its preview.',
				'This is what turns a composition into a file someone can actually watch and download. Until this runs, the video exists only as source code.',
				'It is the ONLY way to get audio into the file: the browser-side encoder silently drops remote <Audio>, so a video with a voice-over rendered anywhere else comes out mute.',
				'Costs credits (a real VM, for about a minute per video). Call it when the composition is finished — not to check your work: that is what render_stills is for.',
				'THE FIRST call on a version of the source does NOT render the MP4: it hands you back a STORYBOARD — one frame per scene, rendered from that exact TSX, attached to the result — plus what a still cannot show (linear motion, static tails, missing transition mechanisms), read from your source. Look at every scene, fix the ones that do not convince you with ONE replace_source each, then call this again. That is a fraction of the cost of a render you would have thrown away.'
			].join(' '),
			inputSchema: z.object({
				video_id: z.string().min(6).describe('The motion video to render, from list_motion_videos or create_motion_video.'),
				quality: z
					.enum(['2k', '4k'])
					.optional()
					.describe('Supersampling target. Default 2k — 4k only when the user asked for it.')
			}),
			execute: async (
				input: { video_id: string; quality?: '2k' | '4k' },
				{ toolCallId }: { toolCallId: string }
			) => {
				// Il tetto vive nel registro, non in questa closure: una "turn" qui è una slice, e le
				// slice di continuazione + i turni di patch della QC ne aprono quante ne vogliono.
				const usedToday = await motionRendersToday(opts.supabase, opts.brandId, input.video_id);
				const budget = motionRenderBudget(usedToday, renders);
				if (budget.blocked) {
					return {
						error: 'render_budget_spent',
						renders_today: usedToday,
						hint:
							budget.scope === 'day'
								? `This video has already been rendered ${usedToday} times today (${MAX_VIDEO_RENDERS_PER_DAY}/day is the ceiling, QC re-renders included). Patch what is wrong and render again tomorrow — or tell the user the cap was hit.`
								: `Already rendered ${MAX_VIDEO_RENDERS_PER_TURN} finished videos this turn. Patch what is wrong and render again in another turn.`
					};
				}
				const row = await getMotionVideo(opts.supabase, opts.brandId, input.video_id);
				if (!row) return { error: 'unknown_video', hint: 'Call list_motion_videos for the ids that exist.' };
				const source = String((row as { source?: unknown }).source ?? '');
				if (!source.trim()) return { error: 'empty_source', hint: 'This video has no source yet — write it first.' };

				/**
				 * LO STORYBOARD, PRIMA DELLA VM. Vedi storyboard.ts per il progetto e i numeri:
				 * un fotogramma per scena costa ~30s contro gli ~85s (p50) di un MP4, quindi
				 * guardare prima di spendere è più economico del render che evita. Il freno è in
				 * codice, non nel prompt: una volta per versione del sorgente, al massimo
				 * MAX_STORYBOARD_REFUSALS volte per turno — poi si rende comunque.
				 *
				 * Il tempo residuo NON fa saltare il passo in silenzio: se non c'è, il render va
				 * avanti e il risultato lo dichiara. Un controllo che sparisce senza dirlo è il
				 * difetto che nessuno poteva vedere prima.
				 *
				 * ponytail: lo storyboard gira PRIMA del gate sulla voce (che vive dentro
				 * renderMotionMp4, l'unico posto dove vale per tutti i chiamanti). Una composizione
				 * destinata al rifiuto della voce paga quindi ~30s di macchina per dei fotogrammi
				 * che l'agente riguarderà dopo aver allungato i beat. Si accetta: anticipare il
				 * gate qui significherebbe rifare la stessa lettura dei WAV due volte per ogni
				 * render. Se un giorno quei 30s pesano, il passo è estrarre il gate dal render e
				 * chiamarlo una volta sola, qui.
				 */
				const meta = readSourceMeta(source, {
					fps: Number((row as { fps?: number }).fps) || 30,
					durationInFrames: Number((row as { duration_in_frames?: number }).duration_in_frames) || 180
				});
				const timeLeft = opts.remainingMs?.() ?? Number.MAX_SAFE_INTEGER;
				let storyboardSkipped: string | null = null;
				if (storyboard.shouldStoryboard(source)) {
					if (!isSandboxConfigured()) storyboardSkipped = 'no_vm_on_this_deployment';
					else if (timeLeft < STORYBOARD_MIN_MS) storyboardSkipped = 'not_enough_time_left_in_this_turn';
					else {
						const frames = storyboardFrames(source, meta.durationInFrames);
						try {
							const shot = await renderMotionStills({
								brandId: opts.brandId,
								userId: opts.userId,
								source,
								frames,
								detail: `storyboard:${frames.length}`,
								remainingMs: opts.remainingMs,
								abortSignal: opts.abortSignal
							});
							if (shot.rendered.length) {
								const beats = motionBeats(source, meta.durationInFrames);
								const parts: ContentPart[] = [
									{
										type: 'text',
										text: `STORYBOARD of "${String((row as { title?: string }).title ?? 'this composition')}" — one frame per scene, rendered from the CURRENT source. No MP4 exists yet.`
									}
								];
								for (const { frame, png } of shot.rendered) {
									const beat = beats.find((b) => b.frame === frame);
									parts.push({
										type: 'text',
										text: beat
											? `Scene ${beat.index}/${beats.length} — frame ${frame} (${(frame / meta.fps).toFixed(2)}s, beat runs ${(beat.startFrame / meta.fps).toFixed(2)}s–${((beat.startFrame + beat.durationInFrames) / meta.fps).toFixed(2)}s)`
											: `Frame ${frame} (${(frame / meta.fps).toFixed(2)}s)`
									});
									parts.push({ type: 'image-data', data: png.toString('base64'), mediaType: 'image/png' });
								}
								pendingStoryboard.set(toolCallId, parts);
								const spent = storyboard.record(source);
								const findings = motionSourceFindings(source, meta.fps);
								return {
									// NON `error`. Un rifiuto RIPETIBILE non è un capolinea, e nello stesso
									// campo di `media_not_found` il modello lo classifica come tale: il
									// 22/08 ha letto «storyboard_first», ha smesso di provarci, è passato a
									// update_goal e al turno dopo ha scritto «MP4 render: pronto». Il campo
									// dice la forma della risposta, la prosa non basta.
									// `retry` è letto anche dalle guardie (goal.ts succeededToolNames,
									// chat-parts failedCallCount): non conta come consegna.
									retry: 'storyboard_first',
									call_again: 'render_motion_video',
									scenes: shot.rendered.length,
									...(shot.failures.length ? { failed_frames: shot.failures } : {}),
									...(findings.length ? { source_checks: findings } : {}),
									storyboards_left: spent.left,
									no_credits_wasted: 'The finished MP4 was NOT rendered — only the storyboard frames.',
									hint: [
										'LOOK AT THE FRAMES ABOVE, one scene at a time, before you render anything. This is what the video will look like, and it cost a fraction of the MP4.',
										'For each scene ask what you can only see in a picture: is every word readable against what is behind it, is the mockup cropped past an edge and actually legible, does the hierarchy read in one second, does the palette hold.',
										'A scene that does not convince you is ONE replace_source on that beat — not a rewrite of the composition.',
										shot.failures.length
											? 'A frame that failed to render is a real runtime defect in the TSX: read the error and fix it, it will fail the same way in the MP4.'
											: '',
										findings.length
											? 'The source_checks are what a still CANNOT show you — movement. Fix those too: they are read from your TSX, not guessed.'
											: '',
										spent.left > 0
											? 'Then call render_motion_video again. If the scenes are already right, call it again as-is — you have looked, that is what this step was for.'
											: 'This was the last storyboard of this turn: the next render_motion_video produces the MP4 whatever the frames look like.'
									]
										.filter(Boolean)
										.join(' ')
								};
							}
							storyboardSkipped = 'no_frame_rendered';
						} catch (e) {
							// La VM che esplode non è un verdetto sulla composizione, e non deve
							// mangiarsi il render: si dichiara e si va avanti.
							storyboardSkipped = `storyboard_render_failed: ${errorMessage(e)}`;
						}
					}
				}

				renders += 1;
				try {
					const width = Number((row as { width?: number }).width) || 1080;
					const height = Number((row as { height?: number }).height) || 1080;
					const quality = parseMotionMp4Quality(input.quality);
					const out = await renderMotionMp4({
						supabase: opts.supabase,
						brandId: opts.brandId,
						userId: opts.userId,
						videoId: input.video_id,
						source,
						scale: motionMp4Scale(width, height, quality),
						remainingMs: opts.remainingMs,
						abortSignal: opts.abortSignal
					});
					// L'anteprima sulla riga è ciò che rende il render VISIBILE: senza, il file esiste
					// nello storage e la galleria continua a mostrare la tessera vuota.
					const saved = await updateMotionPreviewUrl(opts.supabase, opts.brandId, input.video_id, out.url);
					return {
						video_id: input.video_id,
						url: out.url,
						attached_to_gallery: saved.ok,
						aspect: motionAspectFromSize(width, height),
						quality,
						render_seconds: Math.round(out.seconds),
						mb: Number((out.bytes / 1_000_000).toFixed(1)),
						// Onesto ATTRAVERSO le slice: dal registro quando leggibile (il render appena
						// fatto è già in `budget.rendersLeft - 1`), dal turno solo come ripiego.
						renders_left: Math.max(0, budget.rendersLeft - 1),
						// Se lo storyboard non è stato fatto, si DICE. Un controllo che sparisce in
						// silenzio è come non averlo.
						...(storyboardSkipped ? { storyboard_skipped: storyboardSkipped } : {}),
						hint: saved.ok
							? 'The video is out and visible in the gallery. Tell the user it is ready, and SHOW it (in chat: show_media with this url) — a produced clip is handed over as media, not as a link.'
							: 'The file rendered but could not be attached to the gallery row — say so, and hand the clip over as media (in chat: show_media with this url), never as an address pasted into the text.'
					};
				} catch (e) {
					if (e instanceof MotionVoiceGateError) {
						// Rifiutato PRIMA di aprire la VM (vedi renderMotionMp4): nessun credito speso,
						// quindi il tentativo non conta nel budget del turno né nel registro giornaliero.
						renders = Math.max(0, renders - 1);
						return {
							error: 'voice_gate_failed',
							must_fix: true,
							violations: e.violations,
							fix_brief: e.remedy,
							hint: 'The render was REFUSED before opening the VM: the voice does not fit this composition (see violations). Apply the fix_brief with the source tools — lengthen the video, never cut the voice — then render again. It cost nothing.'
						};
					}
					return {
						error: 'render_failed',
						detail: errorMessage(e),
						hint: 'A render that fails is usually a runtime defect in the TSX, not a tool problem — the same one the browser would hit. Read the error, patch with the source tools, and try once more.'
					};
				}
			},
			// Come in render-tools.ts: DEVE essere idempotente, l'SDK chiama toModelOutput più volte
			// per lo stesso toolCallId. Senza i PNG qui, lo storyboard sarebbe una VM pagata e un
			// modello che giudica alla cieca.
			toModelOutput: ({ toolCallId, output }: { toolCallId: string; output: unknown }) => {
				const parts = pendingStoryboard.get(toolCallId);
				if (!parts) return { type: 'json' as const, value: output as never };
				return { type: 'content' as const, value: parts };
			}
		}),

		generate_voiceover: tool({
			description: [
				'Record the spoken voice-over for this video: ONE take of the whole script, then cut into one clip per line.',
				'It is a single recording on purpose — generating a clip per beat would give you a slightly different voice in every beat, which is the defect nobody can name but everybody hears.',
				'You get back one https URL per line WITH ITS REAL DURATION, in seconds and in frames at this composition’s fps. Put each clip inside the <Sequence> of the beat that speaks that line.',
				'Bills AI credits. Does NOT change the TSX.'
			].join(' '),
			inputSchema: z.object({
				lines: z
					.array(z.string().min(2).max(400))
					.min(1)
					.max(12)
					.describe(
						'One line per beat that speaks, in order, exactly as it should be read. Write them as someone talks — not as on-screen copy: the words on screen and the words in the ear are not the same text.'
					),
				voice: z
					.string()
					.optional()
					.describe(`Register, not a name. ${VOICE_LINES}. Default ${DEFAULT_VOICE}.`),
				style: z
					.string()
					.max(200)
					.optional()
					.describe('How it should be delivered, one line. Empty = calm and matter-of-fact, never announcer.'),
				language_code: z
					.string()
					.max(10)
					.optional()
					.describe('BCP-47 of the spoken language, e.g. "it-IT". Match the brand’s language.')
			}),
			execute: async (input: {
				lines: string[];
				voice?: string;
				style?: string;
				language_code?: string;
			}) => {
				try {
					const res = await generateVoiceOver({
						supabase: opts.supabase,
						brandId: opts.brandId,
						userId: opts.userId,
						lines: input.lines,
						voice: isVoiceOverVoice(input.voice) ? (input.voice as VoiceOverVoice) : DEFAULT_VOICE,
						style: input.style ?? null,
						languageCode: input.language_code ?? null,
						abortSignal: opts.abortSignal
					});
					lastTake = { url: res.fullUrl, lines: input.lines };
					const fps = Math.max(1, opts.fps());
					return {
						voice: res.voice,
						url: res.fullUrl,
						duration_seconds: Number(res.fullDurationSeconds.toFixed(2)),
						duration_frames: Math.ceil(res.fullDurationSeconds * fps),
						lines: input.lines,
						pauses: res.gaps.map((g) => ({
							at_seconds: Number(g.atSeconds.toFixed(2)),
							length_seconds: Number(g.durationSeconds.toFixed(2))
						})),
						did_not_change_source: true,
						hint: `One take, one voice — that is why it is not recorded line by line. Now YOU choose the cuts: you wrote the ${input.lines.length} lines, so you know how long each should be. Read the pauses above, pick the ${Math.max(0, input.lines.length - 1)} that separate your lines (the long ones between sentences, not the short ones inside them), and call cut_voiceover with those timestamps. If one take reads as a single line, use it whole.`
					};
				} catch (e) {
					return {
						error: 'voiceover_failed',
						detail: errorMessage(e),
						hint: 'Carry on without the voice-over and say so — do not invent an audio URL.'
					};
				}
			}
		}),

		cut_voiceover: tool({
			description: [
				'Cut the voice-over take you just recorded into one clip per line, at the timestamps YOU choose.',
				'You get one clip per VALID cut plus one, each with its real duration in seconds and frames — put each inside the <Sequence> of the beat that speaks it.',
				'A cut outside the take, or two cuts that round to the same instant, are dropped and listed back to you in `dropped_cuts`: when that happens you get fewer clips than lines, and the clips come back unlabelled rather than labelled wrong.',
				'Free: it slices a file that already exists, no model call. The clips are the same recording, so the voice does not change between them.'
			].join(' '),
			inputSchema: z.object({
				at_seconds: z
					.array(z.number().min(0).max(600))
					.min(1)
					.max(20)
					.describe(
						'Where to cut, in seconds, in order. Pick them from the `pauses` list of generate_voiceover: the middle of a real pause between two lines. N cuts give N+1 clips.'
					),
				url: z
					.string()
					.optional()
					.describe('The take to cut. Omit to use the one you just recorded.'),
				labels: z
					.array(z.string().max(400))
					.max(12)
					.optional()
					.describe(
						'The script lines, in order, when cutting a take by url: N cuts + these N+1 labels give clips labelled with your text instead of "piece N". Omit when cutting the take you just recorded — its lines are remembered.'
					)
			}),
			execute: async (input: { at_seconds: number[]; url?: string; labels?: string[] }) => {
				// (a) Validazione di FORMA prima del fetch; (c) se l'url è inventato ma un take vero
				// esiste, si taglia quello — dichiarandolo — invece di fallire e lasciare il modello
				// a ricostruire url a memoria un'altra volta.
				let inputUrl = input.url;
				let urlWarning: string | undefined;
				if (inputUrl && !isVoiceoverTakeUrl(inputUrl)) {
					const real = await latestVoiceoverTakeUrl(opts.supabase, opts.brandId).catch((error) => { swallow('latest voiceover take url', error); return null; });
					if (!real) {
						return {
							error: 'invalid_take_url',
							hint: `"${inputUrl}" is not a voiceover take of this brand (takes live in this project's storage under /voiceover/), and no recorded take exists. Record one with generate_voiceover, then pass EXACTLY the url it returns — never rebuild urls from memory.`
						};
					}
					urlWarning = `The url you passed ("${inputUrl}") is not a valid voiceover take — it was ignored and the latest real take was cut instead: ${real}. Always pass exactly the url a tool returned.`;
					inputUrl = real;
				}
				const take = inputUrl
					? { url: inputUrl, lines: input.labels ?? [] }
					: lastTake
						? { url: lastTake.url, lines: input.labels ?? lastTake.lines }
						: null;
				if (!take) {
					// `lastTake` è stato di closure: in una slice di continuazione non c'è PIÙ, ma il
					// take sì — sta nello storage. Il vecchio hint ("Record one first") istruiva a
					// riregistrare, ed era l'origine dei take doppi. Se un take esiste, si indica.
					const previous = await latestVoiceoverTakeUrl(opts.supabase, opts.brandId).catch((error) => { swallow('latest voiceover take url', error); return null; });
					if (previous) {
						return {
							error: 'no_take_in_this_slice',
							take_url: previous,
							hint: `The take from an earlier step exists at ${previous} — call cut_voiceover again passing it as url (add labels with your script lines to keep the clips labelled). Do NOT record a new take: a second recording is a second voice.`
						};
					}
					return {
						error: 'no_take',
						hint: 'Record one first with generate_voiceover, then cut it.'
					};
				}
				try {
					const fps = Math.max(1, opts.fps());
					const cut = await cutVoiceOver({
						supabase: opts.supabase,
						brandId: opts.brandId,
						userId: opts.userId,
						url: take.url,
						atSeconds: input.at_seconds,
						labels: take.lines
					});
					// I tagli caduti e il disallineamento righe/pezzi si RIFERISCONO. Prima non si
					// diceva niente e le etichette si attaccavano per posizione: un taglio scartato
					// spostava ogni riga sul beat successivo, e l'ultimo beat restava muto senza che
					// niente nel risultato lo lasciasse sospettare.
					return {
						pieces: cut.pieces.map((p, i) => ({
							index: i,
							line: p.line,
							url: p.url,
							duration_seconds: Number(p.durationSeconds.toFixed(2)),
							duration_frames: Math.ceil(p.durationSeconds * fps)
						})),
						...(cut.dropped.length
							? {
									dropped_cuts: cut.dropped.map((d) => ({
										at_seconds: d.atSeconds,
										reason: d.reason
									}))
								}
							: {}),
						...(cut.lineCount && !cut.matched
							? {
									warning: `${cut.pieces.length} clips for ${cut.lineCount} lines — the clips are NOT one per line, so they come back as "piece N" instead of your text. Do not assume piece N is line N: listen to the durations, then cut again with ${cut.lineCount - 1} timestamps that all fall inside the take.`
								}
							: {}),
						...(urlWarning ? { url_warning: urlWarning } : {}),
						did_not_change_source: true,
						hint: 'A beat must be at least as long as its clip — lengthen the beat rather than letting the line get cut off mid-word. If a clip does not match its line, cut again with different timestamps: it costs nothing.'
					};
				} catch (e) {
					const detail = errorMessage(e);
					// (b) 400/404 in lettura = l'url non esiste davvero. Mai rispondere col solo
					// errore: si allega il take VERO, così il prossimo tentativo non deve indovinare.
					if (/\b(400|404)\b/.test(detail)) {
						const real = await latestVoiceoverTakeUrl(opts.supabase, opts.brandId).catch((error) => { swallow('latest voiceover take url', error); return null; });
						if (real) {
							return {
								error: 'cut_failed',
								detail,
								take_url: real,
								hint: `That url could not be read back. The latest real take is ${real} — call cut_voiceover again passing EXACTLY this url (add labels with your script lines). Never rebuild urls from memory.`
							};
						}
					}
					return { error: 'cut_failed', detail };
				}
			}
		}),

		generate_music: tool({
			description: [
				'Generate an instrumental music bed for this video and get back an https URL.',
				'Describe the music, not the video: tempo, instruments, mood, energy. It is a bed — it sits under the voice, it does not compete with it.',
				`The bed always comes back as a ~${MUSIC_CLIP_SECONDS}s clip, whatever you ask for: a longer composition repeats it with \`loop\` on the <Audio>.`,
				'Bills AI credits. Does NOT change the TSX.'
			].join(' '),
			inputSchema: z.object({
				prompt: z
					.string()
					.min(5)
					.max(300)
					.describe(
						'The music itself: e.g. "sparse minimal electronic, warm analog pads, slow pulse at 90bpm, no drums until halfway, no vocals".'
					),
				seconds: z
					.number()
					.min(2)
					.max(MAX_MUSIC_SECONDS)
					.describe(
						`The composition’s length, so the response can tell you whether to loop. Clip beds are always ~${MUSIC_CLIP_SECONDS}s; Pro uses the duration you asked for.`
					),
				tier: z
					.enum(['clip', 'pro'])
					.optional()
					.describe('clip (default, ~30s, loop if longer) or pro (real duration, higher cost).')
			}),
			execute: async (input: { prompt: string; seconds: number; tier?: 'clip' | 'pro' }) => {
				if (musicUnavailable) {
					return {
						error: 'music_unavailable',
						hint: 'Music generation is down for this turn (a configuration failure, not a bad prompt). Build the video without a bed and say so.'
					};
				}
				try {
					const res = await generateMusicBed({
						supabase: opts.supabase,
						brandId: opts.brandId,
						userId: opts.userId,
						prompt: input.prompt,
						seconds: input.seconds,
						tier: input.tier ?? 'clip',
						abortSignal: opts.abortSignal
					});
					return {
						url: res.url,
						duration_seconds: Number(res.durationSeconds.toFixed(2)),
						did_not_change_source: true,
						hint: [
							'One <Audio> at the top of the composition, with a low volume so the voice stays in front — around 0.15–0.25 under a voice-over, up to 0.5 with no voice.',
							(input.tier ?? 'clip') === 'clip' && input.seconds > MUSIC_CLIP_SECONDS
								? `The bed is ~${MUSIC_CLIP_SECONDS}s and your composition is longer: add loop on that <Audio> so it repeats to the end.`
								: ''
						]
							.filter(Boolean)
							.join(' ')
					};
				} catch (e) {
					const detail = errorMessage(e);
					// Permanente vs passeggero, detto nel risultato: sul permanente la musica si SPEGNE
					// per il turno — nessun prompt diverso ripara un modello ritirato. Sul passeggero
					// si riprova quante volte serve.
					const permanent = permanentMusicFailure(detail);
					if (permanent) musicUnavailable = true;
					return {
						error: 'music_failed',
						retryable: !permanent,
						detail,
						hint: permanent
							? 'This failure is an environment/configuration problem (wrong or retired model id, missing key) — retrying cannot fix it. Carry on without music, say so, and do not invent an audio URL.'
							: 'Transient failure — try again if the bed matters; otherwise carry on without music and say so. Do not invent an audio URL.'
					};
				}
			}
		})
	};
}
