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
import SOCIAL from '$lib/agent-docs/skills/social/SKILL.md?raw';
import SOCIAL_CAROUSELS from '$lib/agent-docs/skills/social/references/carousel-frameworks.md?raw';
import SOCIAL_LISTENING from '$lib/agent-docs/skills/social/references/listening.md?raw';
import SOCIAL_LISTENING_SOURCES from '$lib/agent-docs/skills/social/references/listening-sources-template.md?raw';
import SOCIAL_PLATFORM_LIMITS from '$lib/agent-docs/skills/social/references/platform-limits.md?raw';
import SOCIAL_PLATFORMS from '$lib/agent-docs/skills/social/references/platforms.md?raw';
import SOCIAL_POST_TEMPLATES from '$lib/agent-docs/skills/social/references/post-templates.md?raw';
import SOCIAL_REVERSE from '$lib/agent-docs/skills/social/references/reverse-engineering.md?raw';
import SOCIAL_SHORT_FORM from '$lib/agent-docs/skills/social/references/short-form-video.md?raw';
import { loadHarnessSkills, parseSkillFrontmatter, type HarnessRepoSkill } from './harness-skills';
import type { TeamAgentId } from '$lib/agent-owners';

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

const social = toSkill(SOCIAL, [
	{ path: 'references/carousel-frameworks.md', content: SOCIAL_CAROUSELS.trim() },
	{ path: 'references/listening.md', content: SOCIAL_LISTENING.trim() },
	{ path: 'references/listening-sources-template.md', content: SOCIAL_LISTENING_SOURCES.trim() },
	{ path: 'references/platform-limits.md', content: SOCIAL_PLATFORM_LIMITS.trim() },
	{ path: 'references/platforms.md', content: SOCIAL_PLATFORMS.trim() },
	{ path: 'references/post-templates.md', content: SOCIAL_POST_TEMPLATES.trim() },
	{ path: 'references/reverse-engineering.md', content: SOCIAL_REVERSE.trim() },
	{ path: 'references/short-form-video.md', content: SOCIAL_SHORT_FORM.trim() }
]);

export const brandSkills: HarnessRepoSkill[] = [humanizer, stopSlop, social];

const WRITING_SKILLS = ['humanizer', 'stop-slop'];

/**
 * IL MAZZO DI SKILL DI OGNI AGENTE DEL TEAM — il posto dove "motion sa Remotion, gli altri no"
 * diventa una riga. I nomi valgono per entrambe le sorgenti: le skill di brand (sopra) o quelle
 * del repo (`.agents/skills`); un nome che non esiste da nessuna parte non dà errore, cade.
 * Agenti sconosciuti (il default è il caso normale finché il chiamante non porta l'identità)
 * ricevono le skill di scrittura: ogni agente del team scrive, e nessuno deve suonare un bot.
 */
const SKILLS_BY_AGENT: Record<TeamAgentId, string[]> = {
	content: [...WRITING_SKILLS, 'social'],
	ugc: [...WRITING_SKILLS, 'social'],
	web: WRITING_SKILLS,
	analyst: WRITING_SKILLS,
	auto: WRITING_SKILLS,
	motion: [...WRITING_SKILLS, 'social', 'remotion-best-practices']
};

export async function skillsForAgent(agentId?: string | null): Promise<HarnessRepoSkill[]> {
	const names = SKILLS_BY_AGENT[agentId as TeamAgentId] ?? WRITING_SKILLS;
	const brand = brandSkills.filter((skill) => names.includes(skill.name));
	const repo = await loadHarnessSkills(names.filter((name) => !brandSkills.some((skill) => skill.name === name)));
	return [...brand, ...repo];
}
