/**
 * IL PONTE — content/ugc/web non riscrivono `create_post`, `design_graphic`, `generate_image`,
 * gli articoli, i `dfs_*`: quei tool esistono già come `tool()` dell'AI SDK dentro
 * `createChatTools`/`createDataForSeoTools`, stesso schema Zod, stessa `execute`, STESSI gate
 * (crediti, quota, consenso AI-Act, prepublish, "solo 'approved' pubblica"). Qui si chiama quel
 * tool VERO e si traduce il suo output nel `ToolResult` del kit — stesso pattern di
 * `queryToolAdapter` in `bridge/live.ts`. Un secondo gate scritto qui sarebbe una seconda fonte
 * di verità, esattamente la deriva che `tool-contract.ts` ha già trovato altrove nel repo.
 *
 * `tool()` è un'identità (`@ai-sdk/provider-utils`, `src/types/tool.ts`): `t.inputSchema` è
 * l'oggetto Zod passato tale e quale a `tool({...})`, quindi si traduce in JSON Schema con
 * `z.toJSONSchema` invece di essere ridigitato a mano — la duplicazione schema/description È il
 * difetto che `toolFromContract` esiste per evitare.
 */
import type { Tool, ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import type { ToolResult } from '../kit';

export type ChatToolsRecord = Record<string, Tool<never, unknown>>;

function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** JSON Schema del vero tool di chat, derivato dal suo Zod — mai riscritto a mano. */
export function jsonSchemaOf(t: Tool<never, unknown> | undefined): Record<string, unknown> {
	if (!t?.inputSchema) return { type: 'object', properties: {} };
	try {
		return z.toJSONSchema(t.inputSchema as z.ZodType) as Record<string, unknown>;
	} catch {
		return { type: 'object', properties: {} };
	}
}

/**
 * Un sottoinsieme curato delle proprietà di un tool di chat — per i tool che il plugin espone
 * con un contratto più stretto del reale (es. `ugc_generate_video` forza `content_type`).
 * Le proprietà mantenute vengono prese di peso dallo schema derivato (enum/description inclusi):
 * mai ridigitate, o l'enum del modello video diverge dal vero in silenzio.
 */
export function pickJsonSchema(t: Tool<never, unknown> | undefined, keep: string[], required: string[] = []): Record<string, unknown> {
	const full = jsonSchemaOf(t) as { properties?: Record<string, unknown> };
	const properties: Record<string, unknown> = {};
	for (const k of keep) if (full.properties?.[k]) properties[k] = full.properties[k];
	return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

/** Esegue il tool di chat VERO e propaga il risultato intero — mai riassunto, mai un secondo gate. */
export async function execChatTool(
	t: Tool<never, unknown> | undefined,
	toolName: string,
	args: Record<string, unknown>,
	runId: string,
	signal?: AbortSignal
): Promise<ToolResult> {
	if (!t?.execute) {
		return { content: [{ type: 'text', text: `tool '${toolName}' non è disponibile in questo mestiere` }], isError: true };
	}
	try {
		const out = (await t.execute(args as never, {
			toolCallId: `${toolName}:${runId}`,
			messages: [],
			abortSignal: signal,
			context: {}
		} as ToolExecutionOptions<unknown>)) as Record<string, unknown>;

		// `_images` esce dal JSON e diventa una parte immagine vera. Prima ogni ritorno veniva
		// stringificato in blocco: un PNG allegato da un tool finiva come base64 dentro il testo,
		// illeggibile per il modello e enorme. E' il motivo per cui l'agente non ha mai guardato
		// una grafica appena composta — la vedeva come `source_chars: 4312`.
		const { _images, ...payload } = (out ?? {}) as Record<string, unknown>;
		const images = Array.isArray(_images) ? (_images as Array<{ mimeType?: string; base64?: string }>) : [];
		return {
			content: [
				{ type: 'text', text: JSON.stringify(payload) },
				...images
					.filter((i) => typeof i?.base64 === 'string' && i.base64.length > 0)
					.map((i) => ({ type: 'image' as const, mimeType: i.mimeType ?? 'image/png', base64: i.base64! }))
			],
			isError: !!out && typeof out === 'object' && 'error' in out
		};
	} catch (e) {
		return { content: [{ type: 'text', text: errMsg(e) }], isError: true, effectStatus: 'ambiguous' };
	}
}
