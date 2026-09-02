/**
 * L'OBIETTIVO DEL THREAD sul motore kit — gli STESSI `set_goal` / `update_goal` / `close_goal` del
 * motore classico (`chat/goal-tools.ts`), non una seconda copia: stesso schema Zod, stessa
 * `execute`, stessa riga in `chat_goals`, stesso rifiuto quando una spunta non ha lavoro dietro.
 *
 * Vive qui e non in `packages/` perché la macchina degli obiettivi sta in `$lib`, e un pacchetto
 * non importa l'app (`packages/no-app-imports.test.ts`). Stessa forma dei plugin content/ugc/web.
 *
 * `succeededThisTurn`: `update_goal` decide il rifiuto guardando cosa è già andato a buon fine nel
 * turno. Sul classico lo legge da `opts.messages`, che il ciclo dell'AI SDK gli mette in mano; qui
 * il ponte esegue il tool fuori da quel ciclo (`execChatTool` passa `messages: []`), quindi i nomi
 * arrivano dal contatore del bridge — che è la stessa lista, letta dal posto giusto.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterContext, ToolCall, ToolPlugin, ToolSpec } from '../kit';
import { createGoalTools, GOAL_TOOL_KEYS } from '$lib/agent/tools/goal-tools';
import { execChatTool, jsonSchemaOf, type ChatToolsRecord } from './chat-bridge';

/**
 * Le regole dell'obiettivo nominano la domanda bloccante del motore classico. Sul kit quella cosa
 * esiste e si chiama `ask_user`: senza questa traduzione il prompt ordinerebbe di chiamare uno
 * strumento che non c'è, che è il difetto già pagato coi percorsi promessi e inesistenti.
 */
export function withKitToolNames(text: string): string {
	return text.replaceAll('ask_user_questions', 'ask_user');
}

export interface GoalPluginDeps {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
	threadId: string;
	succeededThisTurn: () => string[];
}

export function createGoalPlugin(deps: GoalPluginDeps): ToolPlugin {
	const goalTools = createGoalTools({
		supabase: deps.supabase,
		brandId: deps.brandId,
		userId: deps.userId,
		threadId: deps.threadId,
		succeededThisTurn: deps.succeededThisTurn
	}) as unknown as ChatToolsRecord;

	const tools: ToolSpec[] = GOAL_TOOL_KEYS.map((name) => ({
		name,
		description: withKitToolNames(String(goalTools[name]?.description ?? name)),
		requiresMode: 'plan',
		effectful: true,
		consequential: true,
		inputSchema: jsonSchemaOf(goalTools[name])
	}));

	return {
		name: 'goal',
		tools,
		execute: (call: ToolCall, ctx: AdapterContext) =>
			execChatTool(goalTools[call.name], call.name, call.args, ctx.runId, ctx.signal)
	};
}
