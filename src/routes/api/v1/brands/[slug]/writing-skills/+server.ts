import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { brandSkills, brandSkillsForAgent } from '$lib/server/brand-skills';
import { loadMemoryEntries } from '$lib/server/brand-memory';
import type { HarnessRepoSkill } from '$lib/server/harness-skills';

// LE SKILL DI SCRITTURA, SERVITE A UN MODELLO CHE STA FUORI. Fino a qui raggiungevano un modello
// solo attraverso `skillsForAgent`, il cui unico chiamante vive nel bridge in smantellamento:
// tolto quello, il testo che impedisce alla copy di suonare da chatbot smetteva di arrivare a
// chiunque, senza che niente fallisse. Un agente esterno non ha l'harness — ha da leggere.
//
// Due sorgenti, un elenco solo, distinte da `source`:
//   product → i markdown del prodotto, uguali per ogni brand
//   brand   → le procedure di QUESTO brand (`brand_memory`, categoria `skill`)

type Served = {
  name: string;
  source: 'product' | 'brand';
  description: string;
  body: string;
  references: string[];
};

const REFERENCE_SEPARATOR = '/';

function serveProduct(skill: HarnessRepoSkill): Served {
  return {
    name: skill.name,
    source: 'product',
    description: skill.description,
    body: skill.content,
    references: (skill.files ?? []).map((file) => file.path)
  };
}

/** Il valore di una skill del brand è markdown la cui PRIMA RIGA è il trigger; il resto sono i passi. */
function serveBrand(entry: { key: string; value: string }): Served {
  const [trigger, ...rest] = entry.value.split('\n');
  return {
    name: entry.key,
    source: 'brand',
    description: trigger.trim(),
    body: rest.join('\n').trim(),
    references: []
  };
}

/**
 * Il riferimento si risolve confrontando con i file che la skill dichiara, mai costruendo un
 * percorso: una traversata non ha niente da attraversare se nessuno apre un file per nome.
 */
function findReference(path: string): { path: string; content: string } | null {
  const cut = path.indexOf(REFERENCE_SEPARATOR);
  if (cut < 1) return null;

  const skill = brandSkills.find((candidate) => candidate.name === path.slice(0, cut));
  const wanted = path.slice(cut + 1);
  const file = skill?.files?.find((candidate) => candidate.path === wanted);

  return file ? { path, content: file.content } : null;
}

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const asked = url.searchParams.get('reference');
  if (asked) {
    const reference = findReference(asked);
    if (!reference) return json({ error: 'reference_not_found' }, { status: 404 });
    return json({ skills: [], reference });
  }

  const entries = await loadMemoryEntries(supabase, brand.id, { category: 'skill' });

  return json({
    skills: [
      ...brandSkillsForAgent(url.searchParams.get('agent')).map(serveProduct),
      ...entries.map(serveBrand)
    ],
    reference: null
  });
};
