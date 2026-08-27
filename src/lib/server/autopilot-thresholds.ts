/**
 * Le soglie del freno di stazionamento dell'autopilot, in un posto solo.
 *
 * Stavano dentro `scheduler.ts` come costanti private, ed erano giuste lì finché nessun altro
 * doveva conoscerle. Ora il `doctor` (brand-doctor.ts) deve dire all'utente *perché* la produzione
 * è ferma e a che numero riparte: una soglia raccontata in due posti diventa due soglie diverse al
 * primo aggiustamento, e il messaggio all'utente smette di corrispondere al comportamento del
 * codice — che è il modo più veloce per rendere una diagnosi peggiore di nessuna diagnosi.
 *
 * Importarle da `scheduler.ts` avrebbe trascinato mezza applicazione dentro una route diagnostica;
 * un modulo di due costanti costa meno di quel bundle e meno del drift.
 */

/**
 * Oltre questi post in `pending_user` *e più vecchi di una settimana*, il collo di bottiglia è
 * l'approvazione, non il generatore: produrne altri approfondirebbe solo la pila.
 */
export const PENDING_BACKLOG_CAP = 15;

/**
 * Solo l'arretrato STANTIO conta. Chi ha appena ricevuto la settimana e la approverà domani non è
 * un brand fermo: contare anche i pending freschi bloccherebbe proprio i brand che funzionano.
 */
export const PENDING_BACKLOG_AGE_MS = 7 * 24 * 60 * 60 * 1000;
