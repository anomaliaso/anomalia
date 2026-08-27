import { describe, expect, it } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import { SPECIALISTS } from '../../../../packages/agent-contracts/src/specs';
import { createFileTools } from './agent-files';

const BRAND_ID = 'b1';
const stub = { toolCallId: 't', messages: [] } as never;

function brandWithEverything() {
	return createTestSupabase({
		brands: [{ id: BRAND_ID, name: 'Fornace Brera', website: 'https://fornacebrera.example', content_prefs: {}, target_platforms: ['instagram'] }],
		brand_kit: [{ brand_id: BRAND_ID, category: 'Ceramica', about: 'Bottega' }],
		brand_strategy: [{ brand_id: BRAND_ID, positioning: 'La bottega che mostra gli scarti', report: {} }],
		editorial_plans: [
			{ brand_id: BRAND_ID, status: 'active', strategy: 'Far vedere il lavoro', voice: {}, cadence: '3/week', platform_mix: {}, weeks: [] }
		],
		gtm_plans: [],
		products: [],
		people: [],
		brand_documents: [],
		competitors: []
	});
}

/**
 * Ogni percorso che una spec nomina fra apici: `work/weeks/`, `brand/strategy.md`, `web/audit.md`.
 * L'ellissi di `how/motion/library/…` e' un rimando alla cartella, non a un file.
 */
function pathsNamedBy(instructions: string): string[] {
	const quoted = [...instructions.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());
	const paths = quoted
		.map((t) => t.replace(/[…]+$/, ''))
		.filter((t) => t.includes('/') && !t.includes(' ') && !t.startsWith('http'));
	return [...new Set(paths)];
}

describe('le spec dei cinque non mandano a percorsi che l’albero non conosce (B4)', () => {
	it('ogni spec nomina almeno un percorso: il test non passa per mancanza di materia', () => {
		for (const spec of SPECIALISTS) {
			expect(pathsNamedBy(spec.instructions).length, spec.id).toBeGreaterThan(0);
		}
	});

	for (const spec of SPECIALISTS) {
		it(`${spec.id}: ogni percorso promesso si apre davvero`, async () => {
			const kit = brandWithEverything();
			const { read_file, ls } = createFileTools(spec.id, 'thread-1', { supabase: kit.client, brandId: BRAND_ID });

			for (const path of pathsNamedBy(spec.instructions)) {
				if (path.endsWith('/')) {
					const listed = (await ls.execute({ path }, stub)) as { files?: string[]; folders?: string[] };
					expect(
						(listed.files?.length ?? 0) + (listed.folders?.length ?? 0),
						`${spec.id} → ls("${path}") è vuoto: la spec manda in una cartella che non esiste`
					).toBeGreaterThan(0);
					continue;
				}
				const out = (await read_file.execute({ path }, stub)) as { error?: string };
				expect(out.error, `${spec.id} → read_file("${path}")`).toBeUndefined();
			}
		});
	}
});
