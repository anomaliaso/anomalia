import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { brandSkills, brandSkillsForAgent } from '$lib/server/brand-skills';
import { loadMemoryEntries, skillTrigger } from '$lib/server/brand-memory';
import { defaultSkillEntries } from '$lib/server/default-skills';
import type { HarnessRepoSkill } from '$lib/server/harness-skills';

// LE SKILL, SERVITE A UN MODELLO CHE STA FUORI. Fino a qui raggiungevano un modello per due
// strade che muoiono insieme: `skillsForAgent`, il cui unico chiamante vive nel bridge in
// smantellamento, e `read_memory` in `agent/tools/`, che sta nello stesso perimetro. Tolti quelli,
// il testo che impedisce alla copy di suonare da chatbot — e quello che impedisce a un render di
// essere rifiutato — smetteva di arrivare a chiunque. Un agente esterno non ha l'harness: legge.
//
// Tre sorgenti, un elenco solo, due valori di `source`:
//   product → i markdown del mestiere (`agent-docs/skills`) e le skill di default in codice
//             (`DEFAULT_SKILLS`): uguali per ogni brand, si aggiornano col deploy
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

/**
 * Il valore di una skill è markdown la cui prima riga utile è il trigger e il resto sono i passi.
 * Il trigger lo estrae `skillTrigger`, lo stesso che riempie l'indice del prompt interno: due
 * modi di tagliare la stessa riga divergerebbero al primo titolo scritto come `## Use when …`.
 */
function serveSkillEntry(entry: { key: string; value: string }, source: Served['source']): Served {
  const lines = entry.value.split('\n');
  const trigger = lines.findIndex((line) => line.trim());

  return {
    name: entry.key,
    source,
    description: skillTrigger(entry.value),
    body: lines.slice(trigger + 1).join('\n').trim(),
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

  const agent = url.searchParams.get('agent');
  const entries = await loadMemoryEntries(supabase, brand.id, { category: 'skill' });

  return json({
    skills: [
      ...brandSkillsForAgent(agent).map(serveProduct),
      ...defaultSkillEntries(agent).map((entry) => serveSkillEntry(entry, 'product')),
      ...entries.map((entry) => serveSkillEntry(entry, 'brand'))
    ],
    reference: null
  });
};
