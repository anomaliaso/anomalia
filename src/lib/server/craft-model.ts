/**
 * IL MODELLO DELLE RESE, in un punto solo — la fabbrica condivisa.
 *
 * `motion-video/model.ts` l'ha fissata per il motion: il tier di questo mestiere è il PRO del
 * provider attivo (il fast ha già dimostrato di non saperlo fare — 23 minuti, zero output),
 * con la scappatoia esplicita in env e il fallback dichiarato sul centralino. Le rese dei video
 * generativi/UGC sono lo stesso mestiere: stessa fabbrica, stesso ragionamento, zero copie.
 */
import { env } from '$env/dynamic/private';
import type { LanguageModel } from 'ai';
import { harnessSdkModel } from '$lib/agent/bridge/adapters';
import { llmDefaultModel, llmLanguageModel } from '$lib/server/llm';

export type CraftAgentModel = {
	model: LanguageModel;
	modelId: string;
	provider: 'gemini' | 'kie' | 'openrouter' | 'opencode' | 'llm';
};

export function craftAgentModel(opts: {
	/** La scappatoia esplicita del mestiere (es. MOTION_VIDEO_MODEL / UGC_VIDEO_MODEL). */
	envModel: string | undefined;
}): CraftAgentModel {
	const forced = opts.envModel?.trim();
	if (forced) return { model: llmLanguageModel(forced), modelId: forced, provider: 'llm' };

	const routed = harnessSdkModel();
	if (routed) return routed;

	const id = llmDefaultModel();
	return { model: llmLanguageModel(id), modelId: id, provider: 'llm' };
}
