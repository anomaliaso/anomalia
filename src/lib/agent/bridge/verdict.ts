/**
 * IL GIUDICE DI CHIUSURA — ha davvero fatto, o ha promesso?
 *
 * Il difetto visto dal vivo (23/8, 16:23): l'agente salva il sorgente, scrive «correggo e
 * ricontrollo prima del render» e CHIUDE. Il lavoro promesso non esiste, l'utente deve
 * rispondere «vai» per farlo ripartire. Questo modulo è la contromisura: alla chiusura di un
 * turno kit, un verdetto ECONOMICO decide se la risposta finale corrisponde ai fatti (i tool
 * riusciti) o è una promessa — e nel secondo caso il chiamante fa ripartire l'agente in
 * silenzio (nessun messaggio finto in chat: la stessa regola delle continuazioni del 23/8).
 *
 * Due stadi, per non pagare un modello quando non serve:
 *   1. il FILTRO deterministico: se la risposta non contiene verbi di futuro/intenzione,
 *      niente chiamata — finito. (Un falso negativo qui costa solo un giro di giudice.)
 *   2. il GIUDICE: il modello della compattazione (il più economico in casa), input corto
 *      (richiesta + risposta + nomi dei tool riusciti), output JSON severo.
 *
 * Il tetto: MAX_VERDICT_LAPS giri. Un agente che promette tre volte di fila non è un agente
 * da rilanciare una quarta: si ferma e la sua ultima risposta resta, con la verità in faccia.
 */
import { generateText } from 'ai';
import { compactionModel } from '$lib/server/chat/model';

export const MAX_VERDICT_LAPS = 2;

/**
 * GLI STRUMENTI CHE PRODUCONO. Se una risposta dichiara un artefatto e nessuno di questi ha
 * dato esito buono nel turno, l'artefatto NON esiste: è la fabbricazione vista in produzione
 * il 23/8 («Fatto. Nuovo trailer Apple-style, 502 frame» — zero tool chiamati, video mai
 * renderizzato, ripetuto due volte).
 */
const PRODUCING_TOOLS = [
	'motion_render',
	'motion_write',
	'motion_stills',
	'attach',
	'content_create_post',
	'content_design_graphic',
	'content_generate_image',
	'content_schedule',
	'ugc_generate_video',
	'web_update_article',
	'web_schedule_article',
	// I quattro che MANCAVANO, trovati ricontrollando l'elenco contro il catalogo vero dei tool
	// (builtin + motion/content/ugc/web): scrivono davvero un articolo o ne mintano le immagini.
	// Un articolo consegnato con `web_write_planned_article` non contava come consegna, quindi il
	// guardiano accusava di fabbricazione chi aveva lavorato — e il rilancio ordina di RIFARE
	// (altro modello, altri crediti) un lavoro che esiste già.
	'web_write_planned_article',
	'web_optimize_article',
	'web_generate_article_cover',
	'web_generate_article_images',
	'brand_write'
];

/**
 * Le frasi che DICHIARANO una consegna (passato), non che la promettono. Larghe di proposito:
 * il costo di un falso positivo è un giro di giudice; quello di un falso negativo è un utente
 * che cerca per venti minuti un video che non è mai esistito.
 */
const CLAIM_RE =
	/\b(fatto|ecco (il|la|lo)|pronto|allegat[oa]|renderizzat[oa]|creat[oa]|generat[oa]|pubblicat[oa]|programmat[oa]|here('s| is) (the|your)|done|attached|rendered|created|generated)\b/i;

/** Un artefatto nominato: video, post, immagine, articolo, grafica. */
const ARTIFACT_RE =
	/\b(video|trailer|reel|post|immagine|image|grafica|graphic|carosello|carousel|articolo|article|mp4|clip)\b/i;

/**
 * Negazione a monte del participio ("Nessun post pubblicato al momento", "non ho ancora creato
 * il video", "zero post programmati"): la stessa parola che altrove dichiara una consegna qui
 * dice l'opposto — un participio negato non è un fatto compiuto. Vista in produzione: una
 * risposta onesta ("Nessun post pubblicato al momento") veniva accusata di dichiarare un lavoro
 * consegnato e rilanciata con l'ordine di chiamare ORA gli strumenti che producono davvero —
 * cioè creare contenuto mai richiesto su un brand di produzione.
 */
const NEGATION_RE = /\b(nessun[oa]?|non|zero|niente|nulla)\b/i;
/** Quanti caratteri prima del participio contano come "a monte": una manciata di parole, non l'intera frase. */
const NEGATION_WINDOW = 30;

/**
 * Il controllo DETERMINISTICO che precede il giudice: dichiarazione di consegna + nessuno
 * strumento produttivo riuscito = fabbricazione. Zero chiamate al modello, zero ambiguità.
 */
export function claimsWithoutFacts(replyText: string, succeededTools: string[]): boolean {
	const claim = CLAIM_RE.exec(replyText);
	if (!claim || !ARTIFACT_RE.test(replyText)) return false;
	const before = replyText.slice(Math.max(0, claim.index - NEGATION_WINDOW), claim.index);
	if (NEGATION_RE.test(before)) return false;
	return !succeededTools.some((t) => PRODUCING_TOOLS.includes(t));
}

/**
 * Verbi/forme di intenzione futura, it+en. Volutamente larghi: il filtro decide solo SE chiamare
 * il giudice. Coprono anche il condizionale e il futuro semplice italiani ("farei", "farò",
 * "ti dico [come farei]") — sfuggivano alla versione precedente, che aveva solo presenti
 * indicativi: il turno chiudeva "finito" avendo promesso e non consegnato.
 */
// Confini di parola "manuali" (lookaround su \p{L}), non \b: \b in JS conta solo [A-Za-z0-9_] come
// carattere di parola, quindi dopo una vocale accentata (farò, creerò, manderò…) il confine finale
// non scattava MAI — la versione con \b\b non trovava nessuna di queste forme, silenziosamente.
const PROMISE_RE =
	/(?<![\p{L}\p{N}_])(correggo|sistemo|procedo|provvedo|ricontrollo|rifaccio|riprovo|passo (ora|adesso)|ora (faccio|creo|genero|renderizzo|lancio)|adesso (faccio|creo|genero|renderizzo)|sto per|tra poco|a breve|ti dico|ti dirò|ti far[oò] sapere|ti faccio sapere|ti mando|ti invio|ti manderò|ti invierò|ti aggiorno|far[oò]|creer[oò]|gener[oò]|renderizzer[oò]|corregger[oò]|sister[oò]|ricontroller[oò]|rifar[oò]|riprover[oò]|preparer[oò]|invier[oò]|mander[oò]|farei|creerei|genererei|renderizzerei|correggerei|sistemerei|ricontrollerei|rifarei|riproverei|preparerei|invierei|manderei|direi|next,? I('ll| will)|I('ll| will) (now |then )?(fix|render|create|generate|correct|retry|proceed|tell you|send you|let you know)|let me (now )?(fix|render|create|generate|tell you)|going to (fix|render|create|generate)|I would (fix|render|create|generate))(?![\p{L}\p{N}_])/iu;

export type TurnFacts = {
	/** L'ultima richiesta dell'utente, così com'era. */
	userAsk: string;
	/** La risposta finale mostrata (reply o testo del turno). */
	replyText: string;
	/** I tool chiamati nel turno CON ESITO OK — i fatti. */
	succeededTools: string[];
	/** Giri di giudice già fatti su questa catena. */
	laps: number;
};

export type Verdict =
	| { finished: true }
	| { finished: false; missing: string; continuation: string };

/** Stadio 1: vale la pena chiamare il giudice? */
export function looksLikeAPromise(replyText: string): boolean {
	return PROMISE_RE.test(replyText);
}

/**
 * Il verdetto. Fail-open per costruzione: qualunque errore (modello giù, JSON storto,
 * nessun modello economico configurato) → `finished: true`. Un giudice rotto non deve
 * MAI trasformarsi in un loop di rilanci — meglio una promessa scappata che un turno infinito.
 */
export async function closeTurnVerdict(facts: TurnFacts): Promise<Verdict> {
	if (facts.laps >= MAX_VERDICT_LAPS) return { finished: true };

	// LA FABBRICAZIONE, prima di tutto e senza modello: ha DETTO di aver consegnato e non ha
	// mosso un dito. Non serve un giudice per questo — servono i fatti, che sono zero.
	if (claimsWithoutFacts(facts.replyText, facts.succeededTools)) {
		return {
			finished: false,
			missing: 'la risposta dichiara un artefatto ma nessuno strumento di produzione è andato a buon fine in questo turno',
			continuation:
				"STOP: la tua ultima risposta dichiara un lavoro consegnato, ma in quel turno non hai chiamato NESSUNO strumento che lo produce. Non ripetere quel messaggio e non riusare url o id di lavori precedenti: sarebbe la stessa bugia due volte. Chiama ORA gli strumenti che producono davvero (per un video: scrivi il sorgente e poi renderizzalo), poi rispondi solo con ciò che è stato creato IN QUESTO TURNO. Se un passaggio fallisce, riporta l'errore vero invece di dichiarare un successo."
		};
	}

	if (!looksLikeAPromise(facts.replyText)) return { finished: true };

	const judge = compactionModel();
	if (!judge) return { finished: true };

	try {
		const { text } = await generateText({
			model: judge.model,
			temperature: 0,
			system:
				'You judge whether an AI assistant COMPLETED what the user asked, or ended its turn promising future work it did not do. ' +
				'You receive the user request, the assistant final message, and the list of tools that SUCCEEDED this turn (these are the only facts). ' +
				'A message that announces a next step ("I will now render", "correggo e poi...") without a succeeded tool that performs it is NOT finished. ' +
				'Reply with STRICT JSON only: {"finished": boolean, "missing": "<what was promised but not done, one line>", "continuation": "<imperative instruction to the assistant to do exactly the missing step, in the user\'s language>"}',
			prompt: `USER REQUEST:\n${facts.userAsk.slice(0, 1200)}\n\nASSISTANT FINAL MESSAGE:\n${facts.replyText.slice(0, 1600)}\n\nSUCCEEDED TOOLS THIS TURN: ${facts.succeededTools.join(', ') || '(none)'}`
		});
		const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as {
			finished?: boolean;
			missing?: string;
			continuation?: string;
		};
		if (parsed.finished === false && parsed.continuation) {
			return {
				finished: false,
				missing: String(parsed.missing ?? '').slice(0, 300),
				continuation: String(parsed.continuation).slice(0, 500)
			};
		}
		return { finished: true };
	} catch {
		return { finished: true };
	}
}
