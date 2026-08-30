import type { AdapterContext, ToolCall, ToolPlugin, ToolResult, ToolSpec } from '../kit';
import { createChatTools } from '$lib/server/chat/tools';
import { execChatTool, jsonSchemaOf, type ChatToolsRecord } from './chat-bridge';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface GroundingPluginDeps {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
	threadId?: string | null;
	locale?: 'en' | 'it';
}

const SOURCE = 'search_knowledge';

/**
 * `query` legge righe, non significati: non fa vettori, e sui documenti caricati la domanda
 * dell'utente non e' quasi mai la parola scritta nel documento. La ricerca ibrida
 * (keyword + semantica sui chunk) e' l'unica via al corpus, e non appartiene a un mestiere:
 * fondare quello che si dice e' di tutti e cinque.
 */
export function createGroundingPlugin(deps: GroundingPluginDeps): ToolPlugin {
	const { supabase, brandId, userId, threadId, locale } = deps;
	const chatTools = createChatTools(
		supabase,
		brandId,
		'Europe/Rome',
		userId,
		'',
		locale ?? 'en',
		threadId ?? undefined
	) as ChatToolsRecord;

	const tools: ToolSpec[] = [
		{
			name: SOURCE,
			effectful: false,
			consequential: false,
			description: String(chatTools[SOURCE]?.description ?? SOURCE),
			inputSchema: jsonSchemaOf(chatTools[SOURCE])
		}
	];

	return {
		name: 'grounding',
		tools,
		async execute(call: ToolCall, ctx: AdapterContext): Promise<ToolResult> {
			if (call.name !== SOURCE) {
				return { content: [{ type: 'text', text: `grounding plugin: unknown tool '${call.name}'` }], isError: true };
			}
			return execChatTool(chatTools[SOURCE], SOURCE, call.args, ctx.runId, ctx.signal);
		}
	};
}
