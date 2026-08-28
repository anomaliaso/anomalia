/**
 * IL PLUGIN SQUADRA — `message_agent` nel kit, cioè un agente che passa il lavoro a un collega.
 *
 * Il tool non si riscrive: è quello vero di `chat/agent-dm-tools.ts`, avvolto da `chat-bridge.ts`
 * come fanno content/ugc/web. Tutti i vincoli deliberati del DM restano dove sono stati decisi —
 * asincrono (torna subito, mai un ciclo d'attesa), tetto di `DM_SENDS_PER_TURN` invii, dedupe sul
 * messaggio identico, rifiuto dentro un thread DM, Anomalia non è un destinatario — e questo
 * modulo non ne riscrive nemmeno uno: un secondo gate qui sarebbe una seconda fonte di verità.
 *
 * DUE FATTI TENGONO IL TETTO IN PIEDI, e sono entrambi qui:
 *  - `createAgentDmTools` gira UNA volta per plugin: tetto e dedupe vivono nella sua closure, e
 *    un plugin vive quanto il turno. Costruirlo dentro `execute` li azzererebbe a ogni invio.
 *  - Il perimetro «mai ai sotto-agenti» è già rispettato dalla forma del kit: i plugin li monta
 *    solo `runKitTurn` (l'orchestratore), e `run_subagent` nel kit è dichiarato ma non eseguito.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterContext, ToolCall, ToolPlugin, ToolResult, ToolSpec } from '../kit';
import { createAgentDmTools } from '$lib/server/chat/agent-dm-tools';
import { createAgentSessionTools } from '$lib/server/chat/agent-session-tools';
import { execChatTool, jsonSchemaOf, type ChatToolsRecord } from './chat-bridge';

export interface TeamPluginDeps {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
	threadId?: string | null;
	/** L'origin per svegliare il drain: assente, il turno del destinatario parte al prossimo giro. */
	origin?: string | null;
	locale?: 'en' | 'it';
}

export function createTeamPlugin(deps: TeamPluginDeps): ToolPlugin {
	const dm = createAgentDmTools({
		supabase: deps.supabase,
		brandId: deps.brandId,
		userId: deps.userId,
		threadId: deps.threadId ?? undefined,
		origin: deps.origin ?? '',
		locale: deps.locale ?? 'en'
	}) as unknown as ChatToolsRecord;

	const session = createAgentSessionTools({
		supabase: deps.supabase,
		brandId: deps.brandId,
		userId: deps.userId,
		threadId: deps.threadId ?? undefined,
		origin: deps.origin ?? '',
		locale: deps.locale ?? 'en'
	}) as unknown as ChatToolsRecord;

	const tools: ToolSpec[] = [
		{
			name: 'message_agent',
			description: String(dm.message_agent?.description ?? ''),
			inputSchema: jsonSchemaOf(dm.message_agent)
		},
		{
			name: 'open_session_with_user',
			description: String(session.open_session_with_user?.description ?? ''),
			inputSchema: jsonSchemaOf(session.open_session_with_user)
		}
	];

	return {
		name: 'team',
		tools,
		async execute(call: ToolCall, ctx: AdapterContext): Promise<ToolResult> {
			if (call.name === 'open_session_with_user') {
				return execChatTool(session.open_session_with_user, call.name, call.args, ctx.runId, ctx.signal);
			}
			if (call.name !== 'message_agent') {
				return { content: [{ type: 'text', text: `team plugin: unknown tool '${call.name}'` }], isError: true };
			}
			return execChatTool(dm.message_agent, call.name, call.args, ctx.runId, ctx.signal);
		}
	};
}
