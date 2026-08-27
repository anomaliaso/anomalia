import { describe, expect, it } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';

const { kitPluginsFor } = await import('./registry');
const { SPECIALISTS } = await import('../specs');

/**
 * RAGGIUNGERE L'UTENTE FUORI DALLA CHAT non e` un mestiere.
 *
 * `notify_user` (email a chi e` invitato + push) sta nell'elenco comune del motore CLASSICO, con
 * scritto accanto il perche`: «chiunque stia parlando con l'utente deve poterglielo consegnare».
 * Sul kit — il motore che gira davvero — non lo montava nessuno. Un render motion che dura dieci
 * minuti finiva senza che l'utente, che nel frattempo era andato via, lo sapesse mai.
 */
describe('notify_user e` di tutti gli specialisti, non di uno', () => {
	const deps = (supabase: ReturnType<typeof createTestSupabase>['client']) => ({
		supabase,
		brandId: 'b1',
		userId: 'u1',
		threadId: 't1',
		locale: 'it' as const
	});

	for (const spec of SPECIALISTS) {
		it(`${spec.id} puo` + ` avvisare l’utente fuori dalla chat`, () => {
			const kit = createTestSupabase();
			const names = kitPluginsFor(spec.id, deps(kit.client)).flatMap((p) => p.tools.map((t) => t.name));
			expect(names).toContain('notify_user');
		});
	}
});
