import { describe, expect, it } from 'vitest';
import { decideOnboardingTarget } from './onboarding-target';

const PROPOSED = { proposedId: 'nuovo-id', proposedSlug: 'fornace-brera' };

describe("su quale brand scrive l'onboarding", () => {
	it('molti brand: se ne crea uno, con lo slug proposto', () => {
		const t = decideOnboardingTarget({ soleTenantId: null, ...PROPOSED });
		expect(t).toEqual({ kind: 'create', brandId: 'nuovo-id', slug: 'fornace-brera' });
	});

	it('un tenant solo: si riempie quello che c\'è, non se ne crea un secondo', () => {
		const t = decideOnboardingTarget({ soleTenantId: 'unico', ...PROPOSED });
		expect(t).toEqual({ kind: 'fill', brandId: 'unico' });
	});

	// Lo slug proposto viene dal NOME che l'utente ha appena scritto. Applicarlo al brand esistente
	// gli cambierebbe l'URL sotto i piedi — e con un tenant solo lo slug non distingue niente.
	it('un tenant solo: lo slug proposto viene ignorato, non applicato', () => {
		const t = decideOnboardingTarget({ soleTenantId: 'unico', ...PROPOSED });
		expect('slug' in t).toBe(false);
	});
});
