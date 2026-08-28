/**
 * IL SECONDO AGENTE DELLA RESA UGC — il brief che il generatore esegue non lo scrive il modello
 * veloce.
 *
 * Come per il motion (`motion_write` accoda, e la resa gira su un agente con tier pro), la
 * sequenza di un video UGC ha due momenti che chiedono modelli diversi: il PIANO (hook, battute,
 * setting — va bene il flash) e la RESA (lo shot brief Seedance: composizione, movimenti,
 * continuità — il mestiere difficile). Qui c'è il secondo: un agente sul tier pro che prende il
 * brief deterministico di `ugc.ts` (la rete di sicurezza, con tutte le RULE) e lo riscrive con
 * vera direzione fotografica.
 *
 * IL DETERMINISTICO È LA RETE: un errore del modello, un output vuoto o senza le RULE tornano al
 * brief di template. Mai un render senza brief.
 */
import { generateText } from 'ai';
import { env } from '$env/dynamic/private';
import { craftAgentModel } from '$lib/server/craft-model';

export type UgcCraftModel = ReturnType<typeof ugcAgentModel>;

export function ugcAgentModel() {
	return craftAgentModel({ envModel: env.UGC_VIDEO_MODEL });
}

export type UgcCraftInput = {
	/** Il brief deterministico di `formatUgcShotBrief`: la base da superare, con le RULE. */
	baseBrief: string;
	script?: string;
	product?: string;
	references?: string[];
	platform?: string;
	seconds?: number;
	hook?: string;
	hookVisual?: string;
	setting?: string;
	person?: string;
	format?: string | null;
};

/** Il runner del modello, iniettabile per i test: default è `generateText` sul tier pro. */
export type CraftRunner = (opts: { system: string; prompt: string }) => Promise<string>;

const generateCraft: CraftRunner = async ({ system, prompt }) => {
	const m = ugcAgentModel();
	const { text } = await generateText({ model: m.model, system, prompt, temperature: 0.6 });
	return text ?? '';
};

export function buildCraftPrompt(input: UgcCraftInput): string {
	const refs = input.references?.length
		? `REFERENCES (already attached to the render — mention them with their tags, never invent new ones):\n${input.references.join('\n')}`
		: '';
	return `You are the CRAFT agent for a UGC video render. A planner already decided the beats; the block below is the mechanical shot brief built from them. Your job is the RESA: rewrite it as a real director would — camera moves, framing, timing per beat, what the person does with hands and eyes — so the video generator has something worth executing.

STRICT RULES:
- Keep every RULE line of the brief VERBATIM, in place. They are generator guardrails (hands, on-screen text, speech completeness): you may not reword, reorder or drop one.
- Same duration (${input.seconds ?? 15}s), same platform (${input.platform ?? 'organic'}), same spoken line if present.
- Output ONLY the rewritten brief. No preamble, no explanations, no markdown fences.

CONTEXT: platform ${input.platform ?? 'organic'} · ${input.seconds ?? 15}s${input.hook ? ` · hook: ${input.hook}` : ''}${input.hookVisual ? ` · hook visual: ${input.hookVisual}` : ''}${input.setting ? ` · setting: ${input.setting}` : ''}${input.person ? ` · person: ${input.person}` : ''}${input.product ? ` · product: ${input.product}` : ''}${input.script ? `\nSPOKEN LINE: ${input.script}` : ''}

${refs}

SHOT BRIEF TO REWRITE:
${input.baseBrief}`;
}

export async function craftUgcShotBrief(
	input: UgcCraftInput,
	run: CraftRunner = generateCraft
): Promise<string> {
	try {
		const out = (
			await run({
				system:
					'You are a senior UGC video director writing shot briefs for an AI video generator. You rewrite mechanical briefs into precise, filmable direction. You never drop the RULE lines.',
				prompt: buildCraftPrompt(input)
			})
		).trim();
		// Un output senza le RULE non è una resa migliore: è un render senza guardrail.
		if (!out || !/RULE/i.test(out)) return input.baseBrief;
		return out;
	} catch {
		return input.baseBrief;
	}
}
