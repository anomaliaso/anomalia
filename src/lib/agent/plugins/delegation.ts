/**
 * IL PLUGIN DELEGA — `delegate_task` / `run_task_pipeline` / `run_parallel_tasks` nel kit.
 *
 * Il tool non si riscrive: è quello vero di `chat/subagents.ts` (budget per turno, ruoli con
 * scope di sola lettura, tracce, log dei crediti), avvolto come fanno content/ugc/web/team.
 * I vincoli restano dove sono stati decisi — in particolare NIENTE RICORSIONE: un sotto-agente
 * non riceve mai i tool di delega (`NEVER_FOR_SUBAGENTS` li filtra dal suo set), quindi la
 * delega ha profondità uno e chi parla con l'utente resta l'orchestratore.
 *
 * Qui non c'è nessuna seconda fonte di verità: solo il ponte ToolSpec → tool AI SDK, come
 * `team.ts` fa per `message_agent`.
 */
import type { AdapterContext, ToolCall, ToolPlugin, ToolResult, ToolSpec } from '../kit';
import type { ChatToolsRecord } from './chat-bridge';
import { execChatTool, jsonSchemaOf } from './chat-bridge';
import { SUBAGENT_TOOL_KEYS } from '$lib/server/chat/subagents';

export interface DelegationPluginDeps {
	/** Il record restituito da `createSubagentTools` — gli stessi oggetti che usa il motore classico. */
	tools: Record<string, unknown>;
}

export function createDelegationPlugin(deps: DelegationPluginDeps): ToolPlugin {
	const delegation = deps.tools as ChatToolsRecord;

	const tools: ToolSpec[] = SUBAGENT_TOOL_KEYS.map((name) => ({
		name,
		description: String(delegation[name]?.description ?? ''),
		requiresMode: 'agent',
		inputSchema: jsonSchemaOf(delegation[name])
	}));

	return {
		name: 'delegation',
		tools,
		async execute(call: ToolCall, ctx: AdapterContext): Promise<ToolResult> {
			if (!(SUBAGENT_TOOL_KEYS as readonly string[]).includes(call.name)) {
				return { content: [{ type: 'text', text: `delegation plugin: unknown tool '${call.name}'` }], isError: true };
			}
			return execChatTool(delegation[call.name], call.name, call.args, ctx.runId, ctx.signal);
		}
	};
}
