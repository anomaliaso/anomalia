/**
 * IL RECEPIT DI LETTURA: niente scrittura senza una lettura fresca.
 *
 * Un agente che patcha un sorgente (motion, grafica) o un testo senza rileggerlo prima sovrascrive
 * in silenzio il lavoro di chi nel frattempo ha cambiato la riga — la persona sul browser, un altro
 * agente, l'autopilot. Il gate qui è a due serrature:
 *
 *  1. CHI NON HA LETTO NON SCRIVE — `requireFreshRead` rifiuta se nessuna lettura di quella
 *     risorsa è arrivata prima in questo processo;
 *  2. QUELLO CHE È CAMBIATO SI RILEGGE — se il token della risorsa (updated_at, version) non è
 *     più quello visto alla lettura, la scrittura è rifiutata con l'ordine di rileggere e rifare
 *     la modifica sul contenuto attuale.
 *
 * Il receipt vive in memoria di processo: entro un turno (una richiesta HTTP che esegue tutto il
 * ciclo read→write) è sempre coerente; tra turni su un'istanza diversa costa al massimo una
 * ri-lettura, mai una sovrascrittura. Le scritture che riesono chiamano `noteRead` col token
 * nuovo, così una catena di patch dello stesso agente non si blocca da sola.
 */

type GuardKind = 'motion' | 'graphic' | 'post' | 'document';

const MAX_RECEIPTS = 2000;

const receipts = new Map<string, string>();

const key = (kind: GuardKind, id: string) => `${kind}:${id}`;

/** La lettura è andata a buon fine e ha visto QUESTO stato: annotato. Un token assente non conta. */
export function noteRead(kind: GuardKind, id: string, token: unknown): void {
	if (token == null) return;
	if (!receipts.has(key(kind, id)) && receipts.size >= MAX_RECEIPTS) {
		const oldest = receipts.keys().next().value;
		if (oldest !== undefined) receipts.delete(oldest);
	}
	receipts.set(key(kind, id), String(token));
}

/**
 * Null = la via è libera. Null anche quando la risorsa stessa non ha un token: un guard che
 * mattona ogni scrittura per una riga senza `updated_at` è peggio del difetto che previene.
 */
export function requireFreshRead(
	kind: GuardKind,
	id: string,
	currentToken: unknown,
	what: string,
	readHow: string
): { error: string } | null {
	if (currentToken == null) return null;

	const seen = receipts.get(key(kind, id));
	if (!seen) {
		return {
			error: `Read before writing: call ${readHow} first, then retry. Without a fresh read the write is refused — you could be overwriting an edit you have not seen.`
		};
	}
	if (seen !== String(currentToken)) {
		return {
			error: `${what} changed since your last read, so nothing was written. Call ${readHow} again, rebuild your change on the current content, and retry.`
		};
	}
	return null;
}

/** Solo per i test: i receipt sono memoria di processo, i test li azzerano fra un caso e l'altro. */
export function resetReadReceipts(): void {
	receipts.clear();
}
