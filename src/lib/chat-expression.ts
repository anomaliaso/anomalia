/**
 * LO STICKER DELL'ESPRESSIONE — la parte pura, condivisa fra il tool e la UI.
 *
 * Un adesivo animato dell'avatar che passa dalla faccia neutra a un'espressione e torna, in loop:
 * dà al turno un tono che il testo non porta.
 *
 * File a parte, senza Svelte né server, perché lo leggono in tre: il tool che lo emette, il
 * componente che lo disegna e i test. La normalizzazione in particolare deve essere UNA: se il
 * server accettasse un'espressione che la UI non sa disegnare, il messaggio resterebbe salvato per
 * sempre come una faccia vuota.
 */
import {
	AGENT_AVATAR_FACES,
	BUILTIN_AGENT_AVATARS,
	DEFAULT_AGENT_AVATAR_FACE,
	DEFAULT_CHAT_AGENT_AVATAR,
	type AgentAvatarFace
} from '$lib/agent-avatars';

/**
 * Le espressioni che l'agente può scegliere: tutte tranne quella neutra. `wide` è il riposo, cioè
 * partenza e arrivo dell'animazione — offrirla sarebbe uno sticker che va da sé a sé.
 */
export const CHAT_EXPRESSIONS = AGENT_AVATAR_FACES.filter(
	(f) => f !== DEFAULT_AGENT_AVATAR_FACE
) as readonly AgentAvatarFace[];

/** Come si legge ciascuna, per il modello che deve sceglierla. */
export const CHAT_EXPRESSION_NOTES: Partial<Record<AgentAvatarFace, string>> = {
	dot: 'plain, attentive — listening',
	wink: 'complicity, a small shared joke',
	sleepy: 'tired, or a long job just finished',
	squint: 'doubt, something does not add up',
	curious: 'interested, asking',
	smile: 'quiet satisfaction',
	grin: 'pleased with how it turned out',
	happy: 'genuinely glad',
	laugh: 'amused',
	sad: 'sorry — bad news, or something that failed',
	visor: 'heads-down, working',
	focus: 'concentrating on something hard',
	surprise: 'caught off guard by what was found'
};

export function isChatExpression(v: unknown): v is AgentAvatarFace {
	return typeof v === 'string' && (CHAT_EXPRESSIONS as readonly string[]).includes(v);
}

/** Un'espressione non riconosciuta non diventa mai una faccia vuota: cade su una neutra leggibile. */
export function normalizeChatExpression(v: unknown): AgentAvatarFace {
	return isChatExpression(v) ? v : 'dot';
}

/**
 * IL CICLO DELL'ANIMAZIONE, in millisecondi. Riposo → espressione → riposo, in loop. I tempi non
 * sono simmetrici di proposito: l'espressione resta il doppio del riposo, o il loop legge come un
 * lampeggio. La dissolvenza (~260ms) la fa `AgentAvatar`: qui si dice solo QUANDO cambiare, e le
 * soste sono abbastanza lunghe da contenerla.
 */
export const EXPRESSION_HOLD_MS = 1_600;
export const EXPRESSION_REST_MS = 800;

/** La faccia da mostrare a un dato istante del ciclo. Pura, quindi testabile senza un timer. */
export function faceAtElapsed(expression: AgentAvatarFace, elapsedMs: number): AgentAvatarFace {
	const cycle = EXPRESSION_HOLD_MS + EXPRESSION_REST_MS;
	const at = ((elapsedMs % cycle) + cycle) % cycle;
	return at < EXPRESSION_REST_MS ? DEFAULT_AGENT_AVATAR_FACE : expression;
}

/** Misura dello sticker in chat: grande abbastanza da leggersi come un gesto, non come un'icona. */
export const EXPRESSION_STICKER_SIZE = 56;

export type ChatExpression = {
	expression: AgentAvatarFace;
	/** Il perché, quando l'agente lo dichiara: resta nella traccia, non si disegna. */
	note?: string | null;
	/**
	 * Il colore dell'agente CHE HA FATTO LA FACCIA, scritto dal tool quando parte. Leggendolo dal
	 * composer, cambiare agente nel picker ritingeva uno sticker di tre giorni prima. Assente sugli
	 * sticker vecchi: si disegnano in tinta col tema.
	 */
	color?: string | null;
};

/**
 * Legge lo sticker da ciò che è stato salvato sulla chiamata del tool. Accetta sia l'output vivo
 * sia la riga riletta (che può essere la stringa troncata dal salvataggio). Niente di riconoscibile
 * ⇒ `null`: meglio nessuno sticker che uno sbagliato.
 */
export function readChatExpression(raw: unknown): ChatExpression | null {
	let value = raw;
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== 'object') return null;
	const o = value as Record<string, unknown>;
	if (!isChatExpression(o.expression)) return null;
	const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim() : null;
	const color = typeof o.color === 'string' && o.color.trim() ? o.color.trim().slice(0, 24) : null;
	return { expression: o.expression, note, color };
}

/**
 * Gli sticker di un blocco di chiamate, in ordine. Qui e non dentro una pagina perché lo disegnano
 * in tre superfici, e finché ognuna aveva il suo `filter(...)` copiato a mano la chat a pagina
 * piena non lo aveva affatto.
 */
export function expressionStickers<T extends { toolName: string; toolCallId?: string; output?: unknown }>(
	calls: T[]
): Array<ChatExpression & { key: string }> {
	return calls.flatMap((c, i) => {
		if (c.toolName !== 'set_expression') return [];
		const sticker = readChatExpression(c.output);
		return sticker ? [{ ...sticker, key: c.toolCallId ?? `ex-${i}` }] : [];
	});
}

/**
 * Il colore con cui firmare gli sticker di QUESTO turno, deciso dal server quando il tool parte:
 * il colore di un gesto è di chi l'ha fatto, non della selezione corrente del composer. L'agente
 * custom vince sul built-in, perché è quello che l'utente vede rispondere.
 */
export function agentStickerColor(agentId: string, customColor?: string | null): string {
	return (
		customColor?.trim() ||
		BUILTIN_AGENT_AVATARS[agentId]?.color ||
		DEFAULT_CHAT_AGENT_AVATAR.color
	);
}
