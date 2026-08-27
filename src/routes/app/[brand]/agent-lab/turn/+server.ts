import { dev } from '$app/environment';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolExecutionOptions } from 'ai';
import type { AdapterContext, RunEvent, SandboxProvider, ToolResult } from '$lib/agent/kit';
import { specById } from '$lib/agent/specs';
import { runTurn } from '$lib/agent/turn';
import { resume } from '$lib/agent/run-store';
import { createApplyTool } from '$lib/agent/executor';
import { BUILTIN_TOOLS } from '$lib/agent/tools/builtin';
import { createServerBrandFs, createPostgresMemoryStore, createHarnessRuntime, resolveHarnessModelRef } from '$lib/agent/bridge/adapters';
import { createAdminClient } from '$lib/server/supabase-admin';
import { createQueryTool } from '$lib/server/chat/query-tool';
import { logAiCall } from '$lib/server/ai-log';

// Banco di prova del nuovo sistema agenti — SOLO dev, mai in produzione.
// run-store scrive `agent_kit_runs` con la service role (RLS dà solo select), quindi il client
// ADMIN gira il turno; `locals.supabase` (anon+JWT) resta per auth e per `query` (RLS vera).

/** Un `SandboxProvider` che non gira mai: sandboxRef è sempre null nel lab, `shell` si ferma
 * prima di chiamarlo (executor.ts). Se qualcosa lo invocasse comunque, l'errore lo dice. */
const noSandbox: SandboxProvider = {
	describe: () => ({ id: 'agent-lab:none', adapterVersion: '0', capabilities: { graphical: false, persistent: false } }),
	provision: async () => {
		throw new Error('agent-lab: nessuna sandbox montata');
	},
	// eslint-disable-next-line require-yield
	execute: async function* () {
		throw new Error('agent-lab: nessuna sandbox montata');
	},
	listFiles: async () => {
		throw new Error('agent-lab: nessuna sandbox montata');
	},
	readFile: async () => {
		throw new Error('agent-lab: nessuna sandbox montata');
	},
	writeFile: async () => {
		throw new Error('agent-lab: nessuna sandbox montata');
	},
	stop: async () => {
		throw new Error('agent-lab: nessuna sandbox montata');
	}
};

/** `createQueryTool` (chat/query-tool.ts) è già un `tool()` dell'AI SDK con Zod + execute: il
 * risultato è un oggetto piano (righe o `{error,fix}`), non un `ToolResult` del kit — la sola
 * traduzione che serve è impacchettarlo in `content` e leggere `error` per `isError`. */
function buildQueryTool(supabase: SupabaseClient, brandId: string, userId: string, threadId: string) {
	const { query } = createQueryTool({ supabase, brandId, userId, threadId });
	return async (args: Record<string, unknown>, ctx: AdapterContext): Promise<ToolResult> => {
		const opts: ToolExecutionOptions = { toolCallId: `query:${ctx.runId}`, messages: [], abortSignal: ctx.signal };
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const out = await query.execute!(args as any, opts);
		return { content: [{ type: 'text', text: JSON.stringify(out) }], isError: Boolean(out && 'error' in (out as object)) };
	};
}

function truncate(s: string, n: number): string {
	return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Evento runtime → la riga NDJSON che il client mostra subito. */
function toLine(e: RunEvent): Record<string, unknown> | null {
	if (e.type === 'text') return { type: 'text', text: e.text };
	if (e.type === 'reasoning') return { type: 'reasoning', text: e.text };
	if (e.type === 'error') return { type: 'error', message: e.message };
	if (e.type === 'tool_call') {
		return { type: 'tool', name: e.call.name, args: truncate(JSON.stringify(e.call.args), 400) };
	}
	if (e.type === 'tool_result') {
		const preview = e.result.content.map((c) => (c.type === 'text' ? c.text : `[image ${c.mimeType}]`)).join(' ');
		return { type: 'result', preview: truncate(preview, 400), isError: Boolean(e.result.isError) };
	}
	return null;
}

export const POST: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
	if (!dev) throw error(404, 'Not found');

	try {
		const { user } = await safeGetSession();
		if (!user) return json({ error: 'unauthorized' }, { status: 401 });

		const { data: brand } = await supabase
			.from('brands')
			.select('id, slug, name')
			.eq('slug', params.brand)
			.maybeSingle();
		if (!brand) return json({ error: 'brand_not_found' }, { status: 404 });

		const body = await request.json();
		const agentId = String(body.agentId ?? '');
		const spec = specById(agentId);
		if (!spec) return json({ error: `agente sconosciuto: '${agentId}'` }, { status: 400 });

		let messages: Array<{ role: 'user' | 'assistant'; content: string }> = Array.isArray(body.messages)
			? body.messages.filter((m: unknown) => m && typeof m === 'object')
			: [];

		const harnessModelRef = resolveHarnessModelRef({ family: spec.model?.family });
		if (!harnessModelRef) return json({ error: 'model_not_configured' }, { status: 400 });

		const admin = createAdminClient();

		// Riprendere un run in waiting_input: la transizione a `running` è dichiarata qui, ma
		// `runTurn` sotto crea comunque un run NUOVO — turn.ts non ha una "continueRun". Il vecchio
		// run resta `running` senza chiudersi: gap noto del v1 del lab, non di run-store.
		if (body.resumeRunId && body.answer) {
			await resume(admin, String(body.resumeRunId));
			messages = [...messages, { role: 'user', content: String(body.answer) }];
		}

		const brandFs = createServerBrandFs(supabase, agentId);
		const memory = createPostgresMemoryStore(supabase);
		const queryTool = buildQueryTool(supabase, brand.id, user.id, `agent-lab:${agentId}`);

		const applyTool = createApplyTool({
			brandFs,
			sandbox: noSandbox,
			sandboxRef: null,
			memory,
			queryTool,
			plugins: []
		});
		const runtime = createHarnessRuntime(applyTool);

		const memoryEntries = await memory.read(brand.id, agentId, {
			brandId: brand.id,
			userId: user.id,
			runId: 'preload',
			locale: 'it'
		});
		const memoryMd = memoryEntries.map((e) => `### ${e.path}\n${e.content}`).join('\n\n');

		const outcome = await runTurn(admin, runtime, applyTool, {
			spec,
			brandId: brand.id,
			threadId: null,
			userId: user.id,
			locale: 'it',
			messages,
			tools: BUILTIN_TOOLS,
			// ponytail: fileIndex vuoto — costruirlo richiede un altro giro su agent-files.ts che il
			// lab non ha ancora; l'agente vede comunque l'albero via brand_ls/brand_read/brand_grep. Aggiungere quando
			// il lab deve mostrare "cosa l'agente sa" senza che lo chieda lui.
			extras: { memoryMd, fileIndex: '' },
			limits: { maxSteps: 20, tokenBudget: 500_000, deadlineMs: 240_000 },
			sessionKey: `agent-lab:${agentId}`,
			model: harnessModelRef
		});

		const encoder = new TextEncoder();
		const startedAt = Date.now();
		const stream = new ReadableStream({
			async start(controller) {
				try {
					const outcome = await runTurn(
						admin,
						runtime,
						applyTool,
						{
							spec,
							brandId: brand.id,
							threadId: null,
							userId: user.id,
							locale: 'it',
							messages,
							tools: BUILTIN_TOOLS,
							extras: { memoryMd, fileIndex: '' },
							limits: { maxSteps: 20, tokenBudget: 500_000, deadlineMs: 240_000 },
							sessionKey: `agent-lab:${agentId}`,
							model: harnessModelRef
						},
						(e) => {
							const line = toLine(e);
							if (line) controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'));
						}
					);
					if (outcome.usage) {
						logAiCall({
							label: 'agent-lab',
							provider: harnessModelRef.provider as 'kie',
							model: harnessModelRef.label,
							ms: Date.now() - startedAt,
							ok: true,
							inputTokens: outcome.usage.inputTokens,
							outputTokens: outcome.usage.outputTokens,
							brandId: brand.id
						});
					}
					controller.enqueue(
						encoder.encode(
							JSON.stringify({
								runId: outcome.run.id,
								state: outcome.run.state,
								reason: outcome.reason,
								reply: outcome.reply,
								question: outcome.question
							}) + '\n'
						)
					);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message }) + '\n'));
				} finally {
					controller.close();
				}
			}
		});
		return new Response(stream, {
			headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' }
		});
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
	}
};
