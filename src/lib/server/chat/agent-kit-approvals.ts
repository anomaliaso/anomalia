import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const SECRET_KEY = /api.?key|authorization|credential|password|secret|token/i;

export type ApprovalDecision = 'approved' | 'denied';

export type AgentKitApproval = {
	id: string;
	brand_id: string;
	thread_id: string;
	run_id: string;
	user_id: string;
	harness_approval_id: string;
	tool_call_id: string;
	tool_name: string;
	tool_input: unknown;
	input_hash: string;
	reason: string | null;
	status: string;
	decision_reason: string | null;
	created_at: string;
	updated_at: string;
};

export function isApprovalDecision(value: unknown): value is ApprovalDecision {
	return value === 'approved' || value === 'denied';
}

export function approvalInputHash(input: unknown): string {
	return createHash('sha256').update(stableSerialize(input)).digest('hex');
}

export function displayApprovalInput(input: unknown): unknown {
	if (Array.isArray(input)) return input.map(displayApprovalInput);
	if (!input || typeof input !== 'object') return input;
	return Object.fromEntries(
		Object.entries(input as Record<string, unknown>).map(([key, value]) => [
			key,
			SECRET_KEY.test(key) ? '[redacted]' : displayApprovalInput(value)
		])
	);
}

export async function waitForApproval(
	db: SupabaseClient,
	input: {
		runId: string;
		harnessApprovalId: string;
		toolCallId: string;
		toolName: string;
		toolInput: unknown;
		reason?: string;
		continueState: unknown;
		message?: {
			content: string;
			reasoning?: string;
			toolCalls?: unknown;
			attachments?: string[];
			speaker?: string;
		};
	}
): Promise<{ closed: boolean; approvalId?: string; harnessApprovalId?: string; messageId?: string }> {
	const { data, error } = await db.rpc('agent_kit_wait_for_approval', {
		p_run_id: input.runId,
		p_harness_approval_id: input.harnessApprovalId,
		p_tool_call_id: input.toolCallId,
		p_tool_name: input.toolName,
		p_tool_input: input.toolInput,
		p_input_hash: approvalInputHash(input.toolInput),
		p_reason: input.reason ?? null,
		p_continue_state: input.continueState,
		p_message: input.message
			? {
					content: input.message.content,
					reasoning: input.message.reasoning ?? null,
					tool_calls: input.message.toolCalls ?? null,
					attachments: input.message.attachments ?? null,
					name: input.message.speaker ?? null
				}
			: null
	});
	if (error) throw new Error(`approval wait failed: ${error.message}`);
	return data as { closed: boolean; approvalId?: string; harnessApprovalId?: string };
}

export async function decideApproval(
	db: SupabaseClient,
	approvalId: string,
	decision: ApprovalDecision,
	reason?: string
): Promise<AgentKitApproval> {
	const { data, error } = await db.rpc('decide_agent_kit_approval', {
		p_approval_id: approvalId,
		p_status: decision,
		p_reason: reason ?? null
	});
	if (error) throw new Error(`approval decision failed: ${error.message}`);
	return data as AgentKitApproval;
}

export async function pendingApproval(
	db: SupabaseClient,
	threadId: string
): Promise<AgentKitApproval | null> {
	const { data } = await db
		.from('agent_kit_approval_requests')
		.select('*')
		.eq('thread_id', threadId)
		.eq('status', 'pending')
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	return (data as AgentKitApproval | null) ?? null;
}

function stableSerialize(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value as Record<string, unknown>)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}
