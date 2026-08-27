/**
 * Il conto che `read_posts` restituisce all'agente.
 *
 * Vive fuori da `tools.ts` per una ragione sola: la forma del risultato è ciò che decide se
 * l'agente risponde 20 o 60 a «quante bozze ho», ed è testabile solo se non serve montare
 * ottanta tool e un database per raggiungerla.
 */
export type ReadPostsResult = {
	posts: unknown[];
	/** Quante ne esistono DAVVERO col filtro chiesto. Assente quando il database non l'ha detto. */
	count?: number;
	/** Quante ne stanno in questa pagina. Sempre presente: è ciò che l'agente ha sotto gli occhi. */
	returned: number;
	/** Presente SOLO quando la pagina non è tutto: dice quante mancano e come contarle. */
	truncated?: string;
};

export function readPostsResult(input: {
	posts: unknown[];
	total: number | null;
	limit: number;
}): ReadPostsResult {
	const returned = input.posts.length;
	const { total } = input;

	if (total === null) {
		return {
			posts: input.posts,
			returned,
			truncated: `Ne vedi ${returned}: non so quante ce ne siano in tutto (il conteggio non è arrivato). Per un numero usa \`query\` con un conteggio, non questa lista.`
		};
	}

	if (total <= returned) {
		return { posts: input.posts, count: total, returned };
	}

	return {
		posts: input.posts,
		count: total,
		returned,
		truncated: `Ne esistono ${total}, qui ne vedi ${returned} (tetto ${input.limit}): ${total - returned} non sono in questa lista. Il numero da dire all'utente è ${total}, non ${returned}.`
	};
}
