import type { HarnessEvent, HarnessSession } from './session';
import type { ToolPipeline } from './pipeline';

/**
 * In-loop session steward. Watches the same transcript the model sees and intervenes when the
 * agent is repeating a failing tool, looping the same call, or skipping brand reads before a
 * paid search. Interventions are model-visible (prepareStep system patch and/or a denied tool
 * result) and logged as `steward` events.
 *
 * This is NOT a second LLM. A critic model on every step would double latency/cost and argue
 * with the main agent. Deterministic notes fire only when there is evidence of a problem.
 *
 * Blocked tools return a structured instruction (`blocked_by: 'steward'`), never `{ error }`.
 * Models treat `error` as an outage and retry the same paid search.
 */

export type StewardNote = {
	level: 'warn' | 'block';
	code: string;
	text: string;
};

export type StewardSnapshot = {
	agent: string;
	tools: string[];
	calls: string[];
	results: Array<{ name: string; failed: boolean; error?: string }>;
	step: number;
};

/** Agents whose job is to ground in Studio before paying for search. */
const GROUNDING_AGENTS = new Set([
	'strategy',
	'week_planner',
	'gtm',
	'produce',
	'ugc_plan',
	'video_review',
	'media_generator'
]);

const BRAND_READS = [
	'read_brand_studio',
	'read_brand_kit',
	'read_strategy',
	'read_strategy_report'
];

const CLOSE_TOOLS = new Set([
	'finish',
	'submit_batch',
	'submit_review',
	'submit_ugc_scripts',
	'approve',
	'request_changes',
	'flag_for_user'
]);

const REPEAT_WARN_AFTER = 3;
const ERROR_BLOCK_AFTER = 2;

export function isPaidSearchTool(name: string): boolean {
	return (
		name === 'search_web' ||
		name === 'search_ad_library' ||
		name === 'research_meta_ads' ||
		name.startsWith('dfs_')
	);
}

export function isCloseTool(name: string): boolean {
	return CLOSE_TOOLS.has(name);
}

export function isStewardDeny(output: unknown): output is {
	blocked_by: 'steward';
	code: string;
	instruction?: string;
} {
	return (
		!!output &&
		typeof output === 'object' &&
		!Array.isArray(output) &&
		(output as { blocked_by?: unknown }).blocked_by === 'steward'
	);
}

export function resultLooksFailed(output: unknown, ok: boolean, error?: string): boolean {
	if (isStewardDeny(output)) {
		// search_before_brand is an instruction, not an outage — do not count it as a tool
		// failure or error_retry will treat "call the brand tool" as "search is broken".
		return output.code === 'error_retry';
	}
	if (!ok || error) return true;
	if (output && typeof output === 'object' && !Array.isArray(output)) {
		const rec = output as Record<string, unknown>;
		if (typeof rec.error === 'string' && rec.error.trim()) return true;
	}
	return false;
}

/** Tool result the model sees when a call is blocked. No `error` key — that reads as an outage. */
export function stewardDenyResult(
	note: StewardNote,
	toolName: string,
	nextTool?: string
): Record<string, unknown> {
	return {
		ok: false,
		ran: false,
		blocked_by: 'steward',
		code: note.code,
		tool: toolName,
		next_tool: nextTool ?? null,
		do_not_retry: true,
		instruction: note.text
	};
}

export function snapshotFromEvents(
	agent: string,
	tools: string[],
	events: HarnessEvent[],
	step: number
): StewardSnapshot {
	const calls: string[] = [];
	const results: StewardSnapshot['results'] = [];
	for (const e of events) {
		if (e.type === 'tool_call') calls.push(e.name);
		if (e.type === 'tool_result') {
			const out =
				e.output && typeof e.output === 'object' && !Array.isArray(e.output)
					? (e.output as { error?: unknown; instruction?: unknown })
					: undefined;
			const errFromOut = typeof out?.error === 'string' ? out.error : undefined;
			const instruction = typeof out?.instruction === 'string' ? out.instruction : undefined;
			results.push({
				name: e.name,
				failed: resultLooksFailed(e.output, e.ok, e.error),
				error: e.error ?? errFromOut ?? instruction
			});
		}
	}
	return { agent, tools, calls, results, step };
}

function availableReads(tools: string[]): string[] {
	const set = new Set(tools);
	return BRAND_READS.filter((n) => set.has(n));
}

function hasPaidSearch(tools: string[]): boolean {
	return tools.some((n) => isPaidSearchTool(n));
}

function hasBrandRead(calls: string[], reads: string[]): boolean {
	const set = new Set(calls);
	return reads.some((n) => set.has(n));
}

function tailSame(calls: string[], n: number): string | null {
	if (calls.length < n) return null;
	const tail = calls.slice(-n);
	return tail.every((c) => c === tail[0]) ? tail[0]! : null;
}

function consecutiveFailures(results: StewardSnapshot['results'], name: string): number {
	let n = 0;
	for (let i = results.length - 1; i >= 0; i--) {
		const r = results[i]!;
		if (r.name !== name) break;
		if (!r.failed) break;
		n += 1;
	}
	return n;
}

export function evaluateSteward(snap: StewardSnapshot): StewardNote[] {
	const notes: StewardNote[] = [];
	const reads = availableReads(snap.tools);
	const grounding = GROUNDING_AGENTS.has(snap.agent);

	if (grounding && reads.length && !hasBrandRead(snap.calls, reads)) {
		const read = reads[0]!;
		if (snap.step >= 2) {
			notes.push({
				level: 'warn',
				code: 'missing_brand',
				text: `You still have not called ${read}. Do not invent brand facts. Call ${read} now (free). Do not retry paid search until ${read} returns.`
			});
		} else if (hasPaidSearch(snap.tools)) {
			notes.push({
				level: 'warn',
				code: 'read_brand_first',
				text: `If you need search_web / search_ad_library / dfs_*, call ${read} first (free). Paid search is blocked until ${read} returns. A blocked search is an instruction, not an outage — do not retry it; call ${read}.`
			});
		}
	}

	const repeated = tailSame(snap.calls, REPEAT_WARN_AFTER);
	if (repeated && !isCloseTool(repeated)) {
		notes.push({
			level: 'warn',
			code: 'repeat_tool',
			text: `You called ${repeated} ${REPEAT_WARN_AFTER} times in a row. Stop calling ${repeated}. Use a different tool or finish.`
		});
	}

	const last = snap.results[snap.results.length - 1];
	if (last?.failed && last.error) {
		const n = consecutiveFailures(snap.results, last.name);
		if (n >= ERROR_BLOCK_AFTER && !isCloseTool(last.name)) {
			notes.push({
				level: 'block',
				code: 'tool_removed',
				text: `${last.name} failed ${n} times in a row (${last.error.slice(0, 120)}) and has been taken off the table: it is not in your tool list this step. Do the work another way, or finish.`
			});
		} else if (n >= 1 && n < ERROR_BLOCK_AFTER) {
			notes.push({
				level: 'warn',
				code: 'tool_error',
				text: `${last.name} returned a real failure (${last.error.slice(0, 160)}). This is not a steward block. Do not retry the same ${last.name} arguments — change the input, pick another tool, or finish.`
			});
		}
	}

	return notes.slice(0, 3);
}

export function stewardWouldBlock(snap: StewardSnapshot, toolName: string): StewardNote | null {
	if (isCloseTool(toolName)) return null;

	const reads = availableReads(snap.tools);
	if (
		GROUNDING_AGENTS.has(snap.agent) &&
		reads.length &&
		isPaidSearchTool(toolName) &&
		!hasBrandRead(snap.calls, reads)
	) {
		const read = reads[0]!;
		return {
			level: 'block',
			code: 'search_before_brand',
			text: `${toolName} DID NOT RUN. The query was not sent. This is not a ${toolName} error, timeout, empty result, or rate limit. Do not call ${toolName} again until ${read} has returned. Required next tool: ${read} (free). After ${read} succeeds, you may call ${toolName}.`
		};
	}

	const fails = consecutiveFailures(snap.results, toolName);
	if (fails >= ERROR_BLOCK_AFTER) {
		const last = [...snap.results].reverse().find((r) => r.name === toolName);
		return {
			level: 'block',
			code: 'error_retry',
			text: `${toolName} already failed ${fails} times for real${last?.error ? ` (${last.error.slice(0, 120)})` : ''}. This is not a transient glitch to retry. Do not call ${toolName} again. Use a different tool or finish.`
		};
	}

	return null;
}

export function formatStewardPatch(notes: StewardNote[]): string {
	if (!notes.length) return '';
	const lines = notes.map((n) => `- ${n.code}: ${n.text}`);
	return `[steward]\nThese are operator instructions, not tool errors or outages. Do not retry a blocked tool; follow next_tool / the required next call.\n${lines.join('\n')}`;
}

export function createSessionSteward(
	session: HarnessSession,
	toolNames: string[]
): {
	evaluate: () => StewardNote[];
	wouldBlock: (toolName: string) => StewardNote | null;
	allowedTools: () => string[] | null;
	pipeline: () => ToolPipeline;
} {
	const tools = [...toolNames];
	const snap = (): StewardSnapshot =>
		snapshotFromEvents(session.meta.agent, tools, session.events, session.stepIndex());

	return {
		evaluate: () => evaluateSteward(snap()),
		wouldBlock: (toolName) => stewardWouldBlock(snap(), toolName),
		allowedTools: () => {
			const s = snap();
			const allowed = tools.filter((name) => !stewardWouldBlock(s, name));
			return allowed.length === tools.length ? null : allowed;
		},
		pipeline: () => ({
			before: [
				({ name }) => {
					const block = stewardWouldBlock(snap(), name);
					if (!block) return;
					session.recordSteward([block]);
					const reads = availableReads(tools);
					return {
						deny: block.code,
						result: stewardDenyResult(
							block,
							name,
							block.code === 'search_before_brand' ? reads[0] : undefined
						)
					};
				}
			]
		})
	};
}

export function mergePipelines(a?: ToolPipeline, b?: ToolPipeline): ToolPipeline | undefined {
	if (!a && !b) return undefined;
	return {
		before: [...(a?.before ?? []), ...(b?.before ?? [])],
		after: [...(a?.after ?? []), ...(b?.after ?? [])]
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Prepared = Record<string, any> | null | undefined;

export function applyStewardPrepareStep(
	session: HarnessSession,
	steward: ReturnType<typeof createSessionSteward>,
	prepared: Prepared,
	origSystem: string
): Prepared {
	const notes = steward.evaluate();
	const patch = formatStewardPatch(notes);
	const allowed = steward.allowedTools();
	const base = prepared && typeof prepared === 'object' ? prepared : {};
	if (!patch && !allowed) return prepared ?? {};
	if (notes.length) session.recordSteward(notes);
	const out: Record<string, unknown> = { ...base };
	if (patch) {
		const systemBase =
			typeof base.system === 'string' && base.system
				? String(base.system)
				: origSystem || session.currentSystem();
		out.system = `${systemBase}\n\n${patch}`;
	}
	if (allowed && out.activeTools == null) out.activeTools = allowed;
	return out;
}
