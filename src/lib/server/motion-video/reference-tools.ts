/**
 * The reference wall, as two tools on the Motion Video agent.
 *
 * `MOTION_CRAFT_SPECS` is the floor: a fixed opinion about transitions, easing and UI mockups that
 * every clip gets whether or not anyone looks at anything. These tools are the ceiling — they let
 * the agent go and see how the brief's own genre is actually being made right now, on posts.design,
 * and build from a structure it chose rather than from a constant.
 *
 * The loop is search → watch → build, and it is deliberately two calls rather than one: searching
 * is free and returns cards, watching costs a vision call and returns a breakdown. An agent that
 * had to watch everything to find out what it was looking at would spend the whole turn on it, so
 * the cards carry enough (brand, category, style tags, the post's own words, does it move) to
 * choose from, and only the two or three that could fit ever get watched.
 *
 * THE AGENT SEES THE REFERENCE ITSELF, not only a description of it. `study_motion_reference`
 * returns the stills — and on request the clip — as media parts inside the tool result, which the
 * Google provider turns into real `inlineData` on the function response. So the model that writes
 * the TSX is the model that looked at the thing. The vision sub-call is still there and still
 * writes the spec, because it is the part that gets CACHED: a text breakdown is 2KB and free
 * forever after, while pixels have to be re-sent on every step of the turn that follows. One reads
 * with a rubric and persists; the other is the agent's own eyes. They are not redundant.
 *
 * WHAT RIDES ALONG, AND WHAT THAT COSTS. Stills are the default: four of them, a couple of hundred
 * KB, bounded. The full clip is opt-in and capped at one per turn, because a tool result is part of
 * the conversation from then on — it goes up with every one of the (up to 64) steps that follow.
 * That is the real budget here, not the vision call.
 *
 * Watches are capped per turn. Cache hits do not count against the budget.
 *
 * DIAGNOSI 2026-08-21 — "gli still sono allegati" era FALSO in produzione. Una sonda live su
 * `gemini-3.7-flash` ha mostrato che con `streamText` (l'entrypoint reale, via harness) il modello
 * rispondeva NOIMAGE e il prompt restava a ~256 token, mentre con `generateText` la stessa
 * identica configurazione ingeriva l'immagine (~1200 token) e la descriveva. Causa: `ai` 6.x
 * chiama `toModelOutput` PIÙ VOLTE per lo stesso tool call in streamText — una volta al
 * `finish-step` per costruire gli step/callback (che nessuno spedisce al modello) e una volta per
 * costruire i messaggi della richiesta successiva. Il vecchio `pending.delete(toolCallId)` dava i
 * pixel alla copia sbagliata e il fallback JSON a quella sul filo. Da qui le due difese:
 * `toModelOutput` idempotente (i pixel restano in `pending` per tutta la turn) e i frame ribaditi
 * a livello di MESSAGGIO via `buildReferenceStepPatch`, che non dipende da come il provider
 * serializza i tool result.
 */
import { tool, type ModelMessage, type ToolSet } from 'ai';
import { z } from 'zod';
import {
	MAX_SEARCH_RESULTS,
	MAX_STUDIES_PER_TURN,
	buildabilityOf,
	formatMotionReferenceSpec,
	searchMotionReferences,
	studyMotionReference,
	type MotionReferenceCard,
	type MotionReferenceSpec,
	type ReferenceMedia
} from '$lib/server/motion-references';
import { isPostsDesignEnabled } from '$lib/server/posts-design';
import { can, route } from '$lib/server/model-routing';
import { cookbookNameForMechanism } from '$lib/motion-video/transitions-cookbook';

/** Stills attached per watch. Four is what the craft judge uses to read a scene sequence. */
const MAX_FRAMES_ATTACHED = 4;
/** Full clips per turn. One. See the header: a clip re-uploads on every following step. */
const MAX_CLIPS_PER_TURN = 1;

export const MOTION_WATCH_MODES = ['frames', 'clip', 'spec_only'] as const;
export type MotionWatchMode = (typeof MOTION_WATCH_MODES)[number];

/**
 * Video inside a tool result only reaches Gemini 3 — e solo passando da Google.
 *
 * The provider sends tool-result media as `functionResponse.parts`, which it enables only for
 * `gemini-3*`; on anything older the same part is stringified into JSON text — the model would be
 * told, in prose, that there was a video. Silent degradation is worse than no feature, so the clip
 * is refused explicitly and the caller is told why.
 *
 * Il trasporto conta quanto il modello, ed è il motivo per cui questo controllo non può restare
 * una regex sull'id: kie.ai SCARTA i media dentro `functionResponse.parts` senza dare nessun
 * errore — un'immagine 256×256 dentro un risultato di tool è tornata `NOIMAGE` con un prompt da 90
 * token. L'agente scriverebbe la composizione partendo dalla DESCRIZIONE di un riferimento che non
 * ha mai visto, e il risultato sembrerebbe soltanto un lavoro venuto male. Peggio ancora, l'id che
 * kie vuole (`gemini-3-7-flash`) passa questa regex: senza il controllo sul trasporto, accendere
 * GEMINI_TRANSPORT=kie renderebbe la degradazione invisibile due volte.
 */
export function supportsClipInToolResult(modelId: string | null | undefined): boolean {
	// La domanda e` una capacita` dell'endpoint, e la risposta vive nel registro: chiederla a
	// `geminiTransport()` era la stessa regola scritta in un secondo posto, e le due sarebbero
	// divergute al primo endpoint nuovo. `graphic-review.ts` la chiedeva gia` cosi`.
	if (!can(route('text').endpoint, 'media-in-tool-result')) return false;
	return /^gemini-3[.-]/.test((modelId ?? '').trim());
}

/** Prompt block describing the wall. Empty when the feature is off, so the agent never offers it. */
export const MOTION_REFERENCE_PROMPT = `REFERENCE WALL (posts.design — curated launch/announcement posts from the accounts that set the bar):
- search_motion_references with the brief in your own words returns candidate posts (brand, category, style tags, what the post said, whether it moves). Free, no clip downloaded.
- study_motion_reference watches ONE of them and hands you BOTH its stills (you look at it yourself) and its structure: beats with timings, the transition mechanism between them, easing, type density, palette roles, what the logo does, which UI is programmatic. Up to ${MAX_STUDIES_PER_TURN} watches per turn; watch="clip" attaches the whole video instead of stills, once per turn, for when the motion is the point.
- Worth doing on a CREATE brief before you write the composition, and whenever the user asks for a look you cannot picture ("like a Linear launch post", "an announcement card", "a product screenshot push").
- Every beat is labelled [code], [code + 1 still] or [OUT OF REACH]. Build the reachable ones. An OUT OF REACH beat (3D render, filmed footage, a camera moving through a real scene) is not a target: replace it with a code-built equivalent or drop it. Attempting one produces a broken imitation — worse than what you would have written with no reference at all.
- You take the STRUCTURE: beat count, pacing, transition kind, how much type is on screen. You never take the artwork — the reference's colours, layout, wordmark and copy stay theirs, and its media is not available to you. Build every beat in this brand's palette, type and logo.
- The wall is a corpus, not an authority: many of these posts run 20–30s and cut hard between scenes. Compress the beat shape to YOUR target length, and where a reference breaks DEFAULT CRAFT (hard cut, freeze-then-cut, linear easing), keep DEFAULT CRAFT.
- Never put a posts.design URL in the TSX. There is no image there for you to use; the source tools will reject it.`;

type ContentPart =
	| { type: 'text'; text: string }
	| { type: 'image-data'; data: string; mediaType: string }
	| { type: 'file-data'; data: string; mediaType: string };

/**
 * Cosa uno studio riuscito consegna al loop dell'agente, oltre al tool result.
 *
 * Esiste perché il tool result si è già dimostrato una casa fragile per i pixel (vedi header,
 * 2026-08-21): il contratto e i frame vengono ribaditi dal loop a livello di sistema e di
 * messaggio, due canali che nessuna serializzazione provider-specifica può degradare in silenzio.
 */
export type ReferenceStudy = {
	referenceId: string;
	/** Compact, binding-for-structure summary — goes on the system side of every later step. */
	contract: string;
	/** Message-level stills, as data URLs. At most {@link MESSAGE_FRAMES_ATTACHED}. */
	frames: string[];
};

/**
 * Still ribaditi a livello di messaggio: 2, non i 4 del tool result. Viaggiano su ogni step
 * successivo come qualunque messaggio, quindi raddoppiare qui raddoppia il costo per step — due
 * frame bastano ad ancorare l'estetica quando il tool result c'è già, e a salvarla quando non c'è.
 */
export const MESSAGE_FRAMES_ATTACHED = 2;

/** The label the injected frames ride under. Structure is the guide; the artwork stays theirs. */
export const REFERENCE_FRAMES_MESSAGE =
	'La reference studiata — la sua STRUTTURA è la guida; i suoi colori e il suo wordmark NO. Build every beat in THIS brand’s palette, type and logo.';

/**
 * The REFERENCE CONTRACT: the studied spec, compressed to what must survive until `write_source`.
 *
 * The full spec lives in a tool result that ages out of attention (and, until 2026-08-21, never
 * even reached the model on the stream path). This is the part that BINDS — beat skeleton,
 * transition mechanism, type density, palette ROLES — phrased so structure is the reference's and
 * pixels stay the brand's. It augments MOTION_CRAFT_SPECS; it never replaces it.
 */
export function formatReferenceContract(
	ref: Pick<MotionReferenceCard, 'brand' | 'category'>,
	spec: MotionReferenceSpec
): string {
	const reach = buildabilityOf(spec);
	const beat = spec.beats
		.map((b) => {
			const label = b.on_screen.length > 60 ? `${b.on_screen.slice(0, 57)}…` : b.on_screen;
			return `${b.at_s}s ${b.buildable === 'out_of_reach' ? '[REPLACE] ' : ''}${label}`;
		})
		.join(' → ');
	const lines = [
		`REFERENCE CONTRACT — ${ref.brand ?? 'reference'}${ref.category ? ` (${ref.category})` : ''}, ${spec.format || 'studied structure'}, ${spec.duration_s}s. BINDING for structure, compressed to YOUR target length:`,
		beat ? `- Beat skeleton (${reach.reachable}/${reach.total} reachable): ${beat}` : '',
		spec.transitions.length
			? `- Transition mechanism: ${spec.transitions
					.map((t) => {
						// La descrizione libera dello studio agganciata alla voce del ricettario più
						// vicina: "collapses into the logo" da sola resta prosa, [cookbook: MATCH_CUT_DOT]
						// è codice che l'agente ha già nel prompt e può copiare.
						const name = cookbookNameForMechanism(t);
						return name ? `${t} [cookbook: ${name}]` : t;
					})
					.join('; ')}`
			: '',
		spec.type_density ? `- Type density: ${spec.type_density}` : '',
		spec.palette ? `- Palette ROLES (roles only — hexes, type and wordmark stay THIS brand's): ${spec.palette}` : '',
		'- This contract binds beats, pacing, transitions and type density. It never overrides DEFAULT CRAFT and never imports the reference’s artwork, layout or copy.'
	];
	return lines.filter(Boolean).join('\n');
}

/**
 * The per-step patch that keeps a studied reference in front of the model until the TSX is
 * written: contracts appended to the system prompt, frames appended as ONE user message per
 * studied reference. A `messages` override carries forward to later steps (ai@7), so any frames
 * message already in the step input is stripped before re-appending — once per reference either way.
 */
export function buildReferenceStepPatch(
	studies: readonly ReferenceStudy[],
	baseSystem: string,
	stepMessages: readonly ModelMessage[]
): { system?: string; messages?: ModelMessage[] } {
	if (!studies.length) return {};
	const contracts = studies.map((s) => s.contract).filter(Boolean);
	const injected: ModelMessage[] = studies
		.filter((s) => s.frames.length)
		.map((s) => ({
			role: 'user',
			content: [
				{ type: 'text', text: REFERENCE_FRAMES_MESSAGE },
				...s.frames.slice(0, MESSAGE_FRAMES_ATTACHED).map((image) => ({
					type: 'image' as const,
					image
				}))
			]
		}));
	const withoutInjected = stepMessages.filter((m) => !isInjectedFramesMessage(m));
	return {
		...(contracts.length ? { system: `${baseSystem}\n\n${contracts.join('\n\n')}` } : {}),
		...(injected.length ? { messages: [...withoutInjected, ...injected] } : {})
	};
}

function isInjectedFramesMessage(m: ModelMessage): boolean {
	return (
		m.role === 'user' &&
		Array.isArray(m.content) &&
		m.content[0]?.type === 'text' &&
		m.content[0].text === REFERENCE_FRAMES_MESSAGE
	);
}

function mediaParts(media: ReferenceMedia | null, attachClip: boolean): ContentPart[] {
	if (!media) return [];
	const parts: ContentPart[] = [];
	for (const f of media.frames.slice(0, MAX_FRAMES_ATTACHED)) {
		if (f.label) parts.push({ type: 'text', text: f.label });
		parts.push({ type: 'image-data', data: f.data, mediaType: f.mimeType });
	}
	if (attachClip && media.clipMp4) {
		parts.push({ type: 'text', text: 'The reference clip itself — watch the scene changes in order:' });
		parts.push({ type: 'file-data', data: media.clipMp4, mediaType: 'video/mp4' });
	}
	return parts;
}

export function createMotionReferenceTools(opts: {
	brandName?: string | null;
	language?: string | null;
	/** Model serving this turn — decides whether a clip can ride in a tool result. */
	modelId?: string | null;
	/**
	 * Attach the reference's pixels to the tool result (default true).
	 *
	 * The brand chat can be served by DeepSeek as easily as by Gemini, and a provider that does not
	 * take media in a function response stringifies the part into prose — the model would be TOLD
	 * there was an image. Callers that cannot promise a vision provider pass false and get the spec
	 * text, which every model can read. Silent degradation is the one outcome not on offer.
	 */
	attachMedia?: boolean;
	/**
	 * Called with each reference actually studied, so the turn can record what it looked at — and,
	 * when the study carried media, re-anchor it at message/system level via
	 * `buildReferenceStepPatch`. The second argument is optional so callers that only track ids
	 * (brand chat) keep working unchanged.
	 */
	onReferenceStudied?: (referenceId: string, study?: ReferenceStudy) => void;
}): ToolSet {
	if (!isPostsDesignEnabled()) return {};
	const attachMedia = opts.attachMedia !== false;
	let studies = 0;
	let clips = 0;
	/** Failed watches are refunded, so this is what stops a bad id from being retried forever. */
	let attempts = 0;
	/**
	 * Media waiting to be attached to a tool result, keyed by tool call.
	 *
	 * It does not travel in the tool OUTPUT because that output is also streamed to the browser and
	 * kept in the chat history — megabytes of base64 the UI has no use for. `toModelOutput` runs
	 * once per tool call, on the server, and is the only place the pixels are needed.
	 */
	const pending = new Map<string, ContentPart[]>();

	return {
		search_motion_references: tool({
			description: [
				'Search the posts.design reference wall — curated launch, announcement and product-update posts from brands that publish strong motion.',
				'Free: no clip is downloaded and no credits are billed. Returns candidates to choose from.',
				'Call this on a CREATE brief before writing the composition, or whenever the user names a look you cannot picture.',
				'Then study_motion_reference on the one or two that fit.'
			].join(' '),
			inputSchema: z.object({
				query: z
					.string()
					.max(300)
					.describe('The brief in your own words — product, genre, feel (e.g. "AI infra launch, announcement card, one number")'),
				only_video: z
					.boolean()
					.optional()
					.describe('Keep only posts that actually move (default false — a strong still is still a layout reference)'),
				limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional()
			}),
			execute: async ({ query, only_video, limit }) => {
				const found = await searchMotionReferences({ query, onlyVideo: only_video, limit });
				if (found.error && !found.references.length) return { error: found.error, references: [] };
				return {
					references: found.references.map((r) => ({
						reference_id: r.id,
						title: r.title,
						brand: r.brand,
						handle: r.handle,
						category: r.category,
						style_tags: r.style_tags,
						post_said: r.post_text?.slice(0, 200) ?? null,
						moves: r.is_video,
						captured_at: r.captured_at,
						credit: r.reference_url
					})),
					watches_left: Math.max(0, MAX_STUDIES_PER_TURN - studies),
					hint: 'Pick the closest structural match and call study_motion_reference with its reference_id. Prefer moves=true when building motion.'
				};
			}
		}),

		study_motion_reference: tool({
			description: [
				'Watch ONE reference from the wall. You get its stills attached to this result — look at them yourself — plus its structure: beats with timings, transition mechanism, easing, type density, palette roles, logo treatment, programmatic UI, and per-beat whether it is buildable in TSX.',
				`watch="clip" attaches the whole video instead of stills (max ${MAX_CLIPS_PER_TURN} per turn, heavier: it rides along on every later step). There is no text-only study on a vision session: you always get the stills — you are expected to LOOK at them.`,
				'Costs a vision call (cached references are free). No image or clip URL is returned and none is available to embed.',
				'Use the structure to build this brand’s own piece. Never reproduce the reference’s artwork, layout, colours or copy.'
			].join(' '),
			inputSchema: z.object({
				reference_id: z.string().min(3).max(200).describe('reference_id from search_motion_references'),
				watch: z
					.enum(MOTION_WATCH_MODES)
					.optional()
					.describe('frames (default) = 4 stills attached · clip = the whole video (spec_only is honored only on sessions that cannot receive media)')
			}),
			execute: async ({ reference_id, watch }, { toolCallId }) => {
				if (studies >= MAX_STUDIES_PER_TURN || attempts >= MAX_STUDIES_PER_TURN * 2) {
					return {
						error: 'watch_budget_spent',
						hint: `Already watched ${MAX_STUDIES_PER_TURN} references this turn. Build from what you have.`
					};
				}
				// DAI DATI (agent_sessions, 2026-08-21): 4 studi su 7 in produzione erano
				// watch="spec_only" SCELTO DAL MODELLO — il compositore non vedeva mai un pixel
				// della reference, ne leggeva il riassunto e basta. spec_only resta per i caller
				// senza vision (attachMedia=false); su una sessione con vision viene alzato a
				// frames: guardare la reference non è un'opzione di risparmio.
				const mode: MotionWatchMode = attachMedia
					? watch === 'spec_only'
						? 'frames'
						: (watch ?? 'frames')
					: 'spec_only';
				const clipRefused =
					!attachMedia && watch && watch !== 'spec_only'
						? 'this session cannot receive media in a tool result — the written spec is all of it'
						: mode === 'clip' && !supportsClipInToolResult(opts.modelId)
						? 'this model cannot receive video in a tool result — stills attached instead'
						: mode === 'clip' && clips >= MAX_CLIPS_PER_TURN
							? `only ${MAX_CLIPS_PER_TURN} full clip per turn — stills attached instead`
							: null;
				const attachClip = mode === 'clip' && !clipRefused;

				attempts += 1;
				studies += 1;
				let res: Awaited<ReturnType<typeof studyMotionReference>>;
				try {
					res = await studyMotionReference({
						idOrSlug: reference_id,
						brandName: opts.brandName,
						language: opts.language,
						withMedia: mode !== 'spec_only'
					});
				} catch (e) {
					// Un LANCIO (rete, storage) deve rimborsare come un `!res.ok`: prima solo il
					// fallimento dichiarato restituiva lo studio, e un'eccezione bruciava il budget
					// senza che il modello avesse visto niente. `attempts` resta consumato: è lui che
					// ferma i retry infiniti.
					studies = Math.max(0, studies - 1);
					return { error: e instanceof Error ? e.message : String(e) };
				}
				if (!res.ok) {
					// A failed watch should not burn the budget — the model gets to try another card.
					studies = Math.max(0, studies - 1);
					return { error: res.error };
				}
				const { reference, media } = res;
				if (reference.cached) studies = Math.max(0, studies - 1);
				opts.onReferenceStudied?.(reference.id, {
					referenceId: reference.id,
					contract: formatReferenceContract(reference, reference.spec),
					frames: (media?.frames ?? [])
						.slice(0, MESSAGE_FRAMES_ATTACHED)
						.map((f) => `data:${f.mimeType};base64,${f.data}`)
				});

				const spec = formatMotionReferenceSpec(reference, reference.spec);
				const parts = mediaParts(media, attachClip);
				if (attachClip && parts.some((p) => p.type === 'file-data')) clips += 1;
				if (parts.length) {
					pending.set(toolCallId, [{ type: 'text', text: spec }, ...parts]);
				}

				return {
					reference_id: reference.id,
					watched: reference.watched,
					credit: reference.reference_url,
					original_post: reference.source_url,
					spec,
					attached: parts.some((p) => p.type === 'file-data')
						? 'clip'
						: parts.length
							? 'frames'
							: 'nothing',
					...(clipRefused ? { clip_refused: clipRefused } : {}),
					...(attachMedia && watch === 'spec_only'
						? { watch_upgraded: 'spec_only is not available on a vision session — stills attached: look at them' }
						: {}),
					...(mode !== 'spec_only' && !parts.length ? { media_unavailable: true } : {}),
					watches_left: Math.max(0, MAX_STUDIES_PER_TURN - studies),
					did_not_change_source: true,
					hint: 'Now write the TSX: same beat shape and pacing, this brand’s palette, type and logo. Skip the [OUT OF REACH] beats. Do not copy the reference’s layout or copy.'
				};
			},
			// Server-side: swaps the small JSON the UI sees for the spec plus the actual pixels, so
			// the model that writes the TSX is the model that looked at it.
			//
			// DEVE essere idempotente (sonda del 2026-08-21, vedi header): streamText chiama
			// toModelOutput più volte per lo stesso toolCallId — una copia va negli step/callback,
			// una sul filo. Un `pending.delete` qui consegnava i pixel alla prima e il fallback
			// JSON alla seconda: il modello scriveva la composizione senza aver mai visto un frame.
			// La mappa vive nella closure della turn e muore con lei — nessuna perdita di memoria.
			toModelOutput: ({ toolCallId, output }) => {
				const parts = pending.get(toolCallId);
				if (!parts) return { type: 'json' as const, value: output as never };
				return { type: 'content' as const, value: parts };
			}
		})
	};
}
