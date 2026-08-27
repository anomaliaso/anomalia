/**
 * SU QUALE BRAND SCRIVE L'ONBOARDING.
 *
 * Il wizard fa due cose insieme, e finora erano la stessa: crea il brand e lo RIEMPIE (sito
 * analizzato, persone, concorrenti, strategia, piano, anteprima). Con un tenant solo la prima non
 * ha senso — il brand esiste già, l'ha creato `npm run db:seed` — mentre la seconda serve eccome:
 * una riga appena creata non ha né strategia né piano, e senza il wizard resterebbe vuota.
 *
 * Quindi non si spegne l'onboarding: gli si cambia il bersaglio.
 */
export type OnboardingTarget =
	/** Il brand c'è già: il wizard lo riempie e basta. */
	| { kind: 'fill'; brandId: string }
	/** Nessun brand: se ne crea uno, con uno slug che non collide con gli altri dell'organizzazione. */
	| { kind: 'create'; brandId: string; slug: string };

export function decideOnboardingTarget(input: {
	/** Lo UUID del brand unico, o null quando i brand sono molti. */
	soleTenantId: string | null;
	/** L'id che il wizard userebbe creando (dalla bozza, o generato). */
	proposedId: string;
	/** Lo slug che il wizard userebbe creando. */
	proposedSlug: string;
}): OnboardingTarget {
	if (input.soleTenantId) return { kind: 'fill', brandId: input.soleTenantId };
	return { kind: 'create', brandId: input.proposedId, slug: input.proposedSlug };
}
