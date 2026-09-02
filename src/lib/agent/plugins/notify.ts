import type { AdapterContext, ToolCall, ToolPlugin, ToolResult, ToolSpec } from '../kit';
import { createChatTools } from '$lib/agent/tools/index';
import { execChatTool, jsonSchemaOf, type ChatToolsRecord } from './chat-bridge';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface NotifyPluginDeps {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
	threadId?: string | null;
	locale?: 'en' | 'it';
}

const SOURCE = 'notify_user';

/**
 * RAGGIUNGERE L'UTENTE FUORI DALLA CHAT non e` un mestiere, ed e` per questo che sta qui e non
 * dentro motion o content.
 *
 * Il motore classico lo aveva gia` nell'elenco comune, con la ragione scritta accanto: «chiunque
 * stia parlando con l'utente deve poterglielo consegnare». Sul kit non lo montava nessuno — e il
 * kit e` il motore che gira. Cosi` un render che dura dieci minuti finiva mentre l'utente era
 * altrove, e l'unico posto dove esisteva era una chat che nessuno stava guardando.
 *
 * I limiti (per turno, per ora, duplicati) vivono nel tool vero e si ereditano: qui non si
 * ricostruisce nessun cancello.
 */
export function createNotifyPlugin(deps: NotifyPluginDeps): ToolPlugin {
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
			requiresMode: 'agent',
			effectful: true,
			consequential: true,
			description: String(chatTools[SOURCE]?.description ?? SOURCE),
			inputSchema: jsonSchemaOf(chatTools[SOURCE])
		}
	];

	return {
		name: 'notify',
		tools,
		async execute(call: ToolCall, ctx: AdapterContext): Promise<ToolResult> {
			if (call.name !== SOURCE) {
				return { content: [{ type: 'text', text: `notify plugin: unknown tool '${call.name}'` }], isError: true };
			}
			return execChatTool(chatTools[SOURCE], SOURCE, call.args, ctx.runId, ctx.signal);
		}
	};
}
