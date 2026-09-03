/**
 * Lavoro che deve AVVENIRE ma non deve far aspettare chi risponde.
 *
 * Il caso che l'ha reso necessario: `sandbox.release()` costa ~8 secondi — `rm -rf` della directory
 * di run e rilascio dell'holder, ciascuno un giro di rete verso la VM — e quando quel tempo scorre
 * il PNG è GIÀ in mano nostra. Aspettarlo prima di rispondere fa pagare all'utente una pulizia che
 * non lo riguarda: su un render da 17.5s totali, otto sono questi.
 *
 * Non basta lasciare la Promise pendente. In una funzione serverless l'istanza si congela appena la
 * risposta parte, e il lavoro non atteso può non finire mai: la directory resterebbe, e l'holder
 * pure — cioè una VM che nessuno spegne. `waitUntil` è il modo di dire alla piattaforma «ho ancora
 * questo da fare»; dove non c'è (server lungo, test), una Promise pendente basta davvero, perché
 * lì il processo non si congela.
 */

/** Non fallisce mai: se il lavoro di fondo esplode, non deve portarsi via la risposta. */
export function runInBackground(work: () => Promise<unknown>, label: string): void {
	const promise = Promise.resolve()
		.then(work)
		.catch((e) => {
			console.error(`[background:${label}]`, e instanceof Error ? e.message : e);
		});

	void (async () => {
		try {
			const { waitUntil } = await import('@vercel/functions');
			waitUntil(promise);
		} catch {
			// Fuori da Vercel la Promise pendente è già la cosa giusta: nessuno congela il processo.
		}
	})();
}
