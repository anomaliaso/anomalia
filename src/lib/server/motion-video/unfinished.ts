/**
 * QUANDO UN VIDEO NON È FINITO, E LA CHAT NON AVEVA MODO DI SAPERLO.
 *
 * La pagina `/motion-video` ha un tool `finish`: l'agente deve DICHIARARE di aver finito, e se
 * smette senza dichiararlo `shouldContinueDesignerSlice` accoda un altro job — fino a 24 volte.
 * È così che quel percorso lavorava mezz'ora su un video.
 *
 * La chat non ha `finish`. La sua unica leva di ripresa è `deadline.expired`, cioè aver bruciato
 * tutti i 1735 secondi del budget. Numeri veri (ai_calls, 4 giorni): la mediana di un turno di
 * chat è **26 secondi**. Quella leva non si arma mai. Quindi l'agente si ferma quando il modello
 * smette di parlare, e **nessuno controlla se il lavoro è davvero finito** — che è esattamente
 * come esce un trailer da 3,5 con dentro due secondi di nero.
 *
 * Qui c'è la definizione di "finito" che mancava, e sta in codice perché nel prompt sarebbe
 * un'opinione: **esiste un MP4 di questo video con verdetto `ship`**. Niente altro conta —
 * non che l'agente lo dica, non che il sorgente compili, non che il turno sia andato liscio.
 *
 * ## I due freni, che non sono facoltativi
 *
 * Un ciclo che riprende da solo è un ciclo che può girare a vuoto a spese di qualcun altro, e i
 * crediti li paga l'utente senza vederlo. Quindi due porte, entrambe in codice:
 *
 *  1. **Il voto deve salire.** Due giri consecutivi in cui il giudizio non migliora sono
 *     lucidatura a vuoto: si chiude, si consegna quello che c'è e lo si DICE. È la stessa lezione
 *     dell'obiettivo che riprovava senza spuntare niente.
 *  2. **Un tetto di spesa per video**, letto dal registro e non dalla buona volontà. Se il giro è
 *     costato più di quanto un video vale, si ferma e lo dice. L'ancora è la nascita del video:
 *     "quanto ha speso questo thread da quando questo video esiste" è una domanda con una
 *     risposta sola, e una query.
 *
 * Il tetto sulle riprese resta il terzo freno, ed è il più stupido dei tre — che è il motivo per
 * cui c'è.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Riprese per un video non finito. Ventiquattro come `DESIGNER_MAX_CONTINUATIONS`: è lo stesso
 * lavoro, e sulla pagina quel numero è stato tarato su video veri. I 9 della chat sono il tetto
 * di una conversazione, non di una produzione.
 */
export const MOTION_MAX_CONTINUATIONS = 24;

/**
 * Tetto di spesa per video, in dollari. Tre: un video pubblicabile a quel prezzo è un affare
 * rispetto a un video da 3,5 che non si può usare, che è sprecato al cento per cento. Sopra,
 * quasi certamente non è rifinitura — è un ciclo.
 */
export const MOTION_CHAIN_USD_CAP = 3;

/** I tool che dicono "questo turno stava facendo un motion video", su entrambe le nomenclature. */
const MOTION_WRITE_TOOLS = new Set([
	'create_motion_video',
	'replace_motion_source',
	'write_motion_source',
	'replace_source',
	'write_source',
	'render_motion_video'
]);

type Step = { toolCalls?: Array<{ toolName?: string; input?: unknown; args?: unknown }> };

/**
 * Gli id dei motion video che questo turno ha toccato, nell'ordine in cui li ha toccati.
 *
 * `create_motion_video` non riceve un id — lo restituisce — quindi un turno che crea e non rende
 * lascia qui una lista vuota pur avendo lavorato: è il caso che `touchedMotion` copre a parte.
 */
export function motionVideoIdsTouched(steps: Step[] | undefined): string[] {
	const out: string[] = [];
	for (const st of steps ?? []) {
		for (const tc of st.toolCalls ?? []) {
			if (!tc.toolName || !MOTION_WRITE_TOOLS.has(tc.toolName)) continue;
			const raw = (tc.input ?? tc.args) as { video_id?: unknown } | undefined;
			const id = typeof raw?.video_id === 'string' ? raw.video_id : null;
			if (id && !out.includes(id)) out.push(id);
		}
	}
	return out;
}

/** Il turno ha lavorato su un motion video, con o senza un id leggibile. */
export function touchedMotion(steps: Step[] | undefined): boolean {
	return (steps ?? []).some((st) =>
		(st.toolCalls ?? []).some((tc) => tc.toolName && MOTION_WRITE_TOOLS.has(tc.toolName))
	);
}

export type MotionContinuationReason =
	| 'shipped'
	| 'no_video_id'
	| 'laps_spent'
	| 'budget_spent'
	| 'not_improving'
	| 'never_rendered'
	| 'verdict_open';

export type MotionContinuation = {
	continue: boolean;
	reason: MotionContinuationReason;
	videoId: string | null;
	title: string | null;
	/** Con cosa riparte il turno. Presente solo quando `continue`. */
	prompt?: string;
	/** Speso su questo thread da quando il video esiste, in USD. */
	spentUsd?: number | null;
	/** I voti di craft, dal primo all'ultimo. */
	scores?: number[];
};

/**
 * Il turno ha lasciato un motion video a metà?
 *
 * `null` = questo turno non stava facendo un motion video, quindi la decisione non è di questa
 * funzione e chi chiama tiene la regola che aveva. Tutto il resto è una decisione motivata, e il
 * motivo serve tanto per riprendere quanto per fermarsi: un ciclo che si chiude in silenzio è
 * indistinguibile da un lavoro finito.
 */
export async function decideMotionContinuation(
	supabase: SupabaseClient,
	opts: { brandId: string; threadId: string; depth: number; steps: Step[] | undefined; locale?: string }
): Promise<MotionContinuation | null> {
	if (!touchedMotion(opts.steps)) return null;

	const ids = motionVideoIdsTouched(opts.steps);
	const videoId = ids[ids.length - 1] ?? null;
	// Ha lavorato su un motion video ma nessun tool portava un id: quasi sempre è un
	// `create_motion_video` e basta — cioè un sorgente scritto e mai reso. Si riprende, perché è
	// esattamente il caso «mezzo lavoro consegnato come finito».
	if (!videoId) {
		if (opts.depth >= MOTION_MAX_CONTINUATIONS)
			return { continue: false, reason: 'laps_spent', videoId: null, title: null };
		return {
			continue: true,
			reason: 'never_rendered',
			videoId: null,
			title: null,
			prompt: continuationPrompt(null, null, opts.locale)
		};
	}

	if (opts.depth >= MOTION_MAX_CONTINUATIONS)
		return { continue: false, reason: 'laps_spent', videoId, title: null };

	const { data: video } = await supabase
		.from('motion_videos')
		.select('id, title, preview_url, created_at')
		.eq('id', videoId)
		.eq('brand_id', opts.brandId)
		.maybeSingle();
	if (!video) return null;
	const title = (video as { title?: string }).title ?? null;

	const { data: scoreRows } = await supabase
		.from('motion_craft_scores')
		.select('overall, verdict, created_at')
		.eq('video_id', videoId)
		.order('created_at', { ascending: true });
	const rows = (scoreRows ?? []) as Array<{ overall: number | string; verdict: string }>;
	const scores = rows.map((r) => Number(r.overall)).filter((n) => Number.isFinite(n));
	const latest = rows[rows.length - 1];

	// FINITO significa questo, e solo questo.
	if (latest?.verdict === 'ship') {
		return { continue: false, reason: 'shipped', videoId, title, scores };
	}

	// Il tetto di spesa, DOPO "finito": un video consegnato non deve mai uscire con un messaggio
	// che parla di budget.
	const spentUsd = await threadSpendSince(
		supabase,
		opts.threadId,
		String((video as { created_at?: string }).created_at ?? '')
	);
	if (spentUsd != null && spentUsd >= MOTION_CHAIN_USD_CAP) {
		return { continue: false, reason: 'budget_spent', videoId, title, spentUsd, scores };
	}

	// Il voto non sale: si smette di lucidare. Serve un confronto vero — due giudizi — quindi al
	// primo verdetto negativo si riprende comunque, ed è giusto: è la prima correzione.
	if (scores.length >= 2 && scores[scores.length - 1] <= scores[scores.length - 2]) {
		return { continue: false, reason: 'not_improving', videoId, title, spentUsd, scores };
	}

	const previewUrl = (video as { preview_url?: string | null }).preview_url;
	return {
		continue: true,
		reason: !previewUrl || !latest ? 'never_rendered' : 'verdict_open',
		videoId,
		title,
		spentUsd,
		scores,
		prompt: continuationPrompt(title, latest ? Number(latest.overall) : null, opts.locale)
	};
}

/**
 * Quanto ha speso questo thread da quando il video esiste. `null` = registro illeggibile, e in
 * quel caso il tetto non blocca: un freno che non sa contare non deve fermare il lavoro (restano
 * gli altri due).
 */
async function threadSpendSince(
	supabase: SupabaseClient,
	threadId: string,
	sinceIso: string
): Promise<number | null> {
	if (!threadId || !sinceIso) return null;
	const { data, error } = await supabase
		.from('ai_calls')
		.select('cost_usd')
		.eq('thread_id', threadId)
		.gte('created_at', sinceIso)
		.limit(2000);
	if (error) {
		console.warn('[motion-unfinished] spend query failed:', error.message);
		return null;
	}
	return (data ?? []).reduce((sum, r) => sum + (Number((r as { cost_usd?: unknown }).cost_usd) || 0), 0);
}

function continuationPrompt(title: string | null, score: number | null, locale?: string): string {
	const name = title ? `"${title}"` : locale === 'en' ? 'the motion video' : 'il motion video';
	if (locale === 'en') {
		return [
			`${name} is NOT delivered: ${score == null ? 'no reviewed MP4 exists yet' : `the craft verdict is ${score}/10, not shippable`}.`,
			'Pick it back up where you left it. Call render_motion_video: the first call on this version hands you the storyboard — one frame per scene — plus the source checks a still cannot show.',
			'Look at every scene, fix the ones that do not convince you with ONE replace_motion_source each, then render.',
			'Do not start over, do not create a second video, and do not answer the user as if this were finished.'
		].join(' ');
	}
	return [
		`${name} NON è consegnato: ${score == null ? 'non esiste ancora un MP4 rivisto' : `il verdetto di craft è ${score}/10, non consegnabile`}.`,
		'Riprendi da dove eri. Chiama render_motion_video: la prima chiamata su questa versione ti dà lo storyboard — un fotogramma per scena — più i controlli sul sorgente che un fermo immagine non può mostrare.',
		'Guarda ogni scena, correggi quelle che non ti convincono con UNA replace_motion_source ciascuna, poi rendi.',
		'Non ricominciare da capo, non creare un secondo video, e non rispondere all’utente come se fosse finito.'
	].join(' ');
}

/**
 * La riga che chiude il giro quando si ferma senza aver consegnato.
 *
 * `null` quando non c'è niente da dichiarare — il video è uscito, oppure il giro continua e la
 * ripresa parlerà da sé. Un avviso su un lavoro riuscito è rumore; il silenzio su un lavoro
 * fermato è una bugia.
 */
export function motionUnfinishedNotice(d: MotionContinuation | null, locale: string): string | null {
	if (!d || d.continue || d.reason === 'shipped' || d.reason === 'no_video_id') return null;
	const en = locale === 'en';
	const best = d.scores?.length ? Math.max(...d.scores) : null;
	const grade = best == null ? '' : en ? ` The best it reached is ${best}/10.` : ` Il voto più alto raggiunto è ${best}/10.`;
	if (d.reason === 'not_improving') {
		return en
			? `\n\n_I stopped reworking this video: two rounds in a row without the score going up is polishing that leads nowhere.${grade} It is saved as it is — tell me what bothers you about it and I will go at that instead._`
			: `\n\n_Ho smesso di rilavorare questo video: due giri di fila senza che il voto salga sono lucidatura che non porta da nessuna parte.${grade} È salvato com'è — dimmi tu cosa non ti torna e vado su quello._`;
	}
	if (d.reason === 'budget_spent') {
		const spent = d.spentUsd != null ? d.spentUsd.toFixed(2) : '?';
		return en
			? `\n\n_I stopped here: this video has already used about $${spent} of work, which is the ceiling I keep for one video.${grade} It is saved as it is — say the word and I will carry on._`
			: `\n\n_Mi fermo qui: su questo video è già andato circa $${spent} di lavoro, che è il tetto che tengo per un video solo.${grade} È salvato com'è — dimmi tu se vado avanti._`;
	}
	// laps_spent
	return en
		? `\n\n_I stopped after ${MOTION_MAX_CONTINUATIONS} passes on this video.${grade} It is saved as it is — a video that needs more than that needs a different brief, not another pass._`
		: `\n\n_Mi fermo dopo ${MOTION_MAX_CONTINUATIONS} passaggi su questo video.${grade} È salvato com'è — un video che ne chiede di più ha bisogno di un brief diverso, non di un altro giro._`;
}
