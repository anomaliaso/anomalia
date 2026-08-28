/**
 * LE SKILL DI SCRITTURA CHE IL BRAND CHAT PORTA SEMPRE ADDOSSO, vendorate da upstream e cucite
 * dentro `HarnessAgent` a ogni turno — senza varchi né selezioni: il prodotto è testo, e il testo
 * che sa di chatbot è un difetto di qualità, non un'opzione.
 *
 * I markdown restano file veri (`$lib/agent-docs/skills/**`) diffabili contro upstream e inlineati
 * con `?raw`; il frontmatter passa da `parseSkillFrontmatter`, lo stesso parser del loader del repo.
 */
import HUMANIZER from '$lib/agent-docs/skills/humanizer/SKILL.md?raw';
import STOP_SLOP from '$lib/agent-docs/skills/stop-slop/SKILL.md?raw';
import STOP_SLOP_PHRASES from '$lib/agent-docs/skills/stop-slop/references/phrases.md?raw';
import STOP_SLOP_STRUCTURES from '$lib/agent-docs/skills/stop-slop/references/structures.md?raw';
import STOP_SLOP_EXAMPLES from '$lib/agent-docs/skills/stop-slop/references/examples.md?raw';
import { parseSkillFrontmatter, type HarnessRepoSkill } from './harness-skills';

function toSkill(markdown: string, files?: HarnessRepoSkill['files']): HarnessRepoSkill {
	const { attrs, body } = parseSkillFrontmatter(markdown);
	return {
		name: attrs.name,
		description: attrs.description.replace(/\s+/g, ' ').trim(),
		content: body.trim(),
		...(files && files.length > 0 ? { files } : {})
	};
}

const humanizer = toSkill(HUMANIZER);

const stopSlop = toSkill(STOP_SLOP, [
	{ path: 'references/phrases.md', content: STOP_SLOP_PHRASES.trim() },
	{ path: 'references/structures.md', content: STOP_SLOP_STRUCTURES.trim() },
	{ path: 'references/examples.md', content: STOP_SLOP_EXAMPLES.trim() }
]);

export const brandSkills: HarnessRepoSkill[] = [humanizer, stopSlop];
