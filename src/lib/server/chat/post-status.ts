/**
 * Come si chiamano gli stati di un post, in un punto solo.
 *
 * `query` conta le righe che gli si chiedono, e le conta bene: il 25/8 ha risposto 63 a «quante
 * bozze ho» su un brand con 60 bozze e 3 post pubblicati. Non un errore di conteggio — nessuno
 * gli aveva mai detto che «bozza» in questo prodotto è `status = 'pending_user'`. Un numero
 * sbagliato e sicuro di sé è peggio di un tool che fallisce: nessun guardiano lo smaschera.
 */
export const POST_STATUS = {
	pending_user: 'bozza / in attesa di approvazione — è ciò che l\'utente chiama «bozza»',
	approved: 'approvato dall\'utente, non ancora programmato',
	scheduled: 'programmato, non ancora uscito',
	published: 'pubblicato',
	failed: 'la pubblicazione è fallita'
} as const;

export type PostStatus = keyof typeof POST_STATUS;

/** Da mettere nella descrizione dei tool che filtrano o contano i post. */
export const POST_STATUS_VOCABULARY = `posts.status: ${Object.entries(POST_STATUS)
	.map(([k, v]) => `'${k}' = ${v}`)
	.join('; ')}. Quando l'utente dice «bozze» intende SOLO 'pending_user': contare senza quel filtro somma anche i pubblicati e dà un numero più grande del vero.`;
