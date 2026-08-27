/**
 * Il draft del composer che sopravvive a un refresh accidentale — sessionStorage, una chiave per
 * composer/thread (`anomalia:chat-draft:<...>`). Un messaggio lungo scritto e mai inviato non
 * deve morire con la tab ricaricata.
 *
 * try/catch perché lo storage può mancare (SSR, privacy mode, quota): un draft perso non deve
 * mai rompere la chat.
 */
export function readChatDraft(key: string): string {
	try {
		return sessionStorage.getItem(key) ?? '';
	} catch {
		return '';
	}
}

/** Testo vuoto = draft consumato (i caller azzerano `value` all'invio): si RIMUOVE la chiave. */
export function writeChatDraft(key: string, value: string): void {
	try {
		if (value) sessionStorage.setItem(key, value);
		else sessionStorage.removeItem(key);
	} catch {
		/* ignore */
	}
}
