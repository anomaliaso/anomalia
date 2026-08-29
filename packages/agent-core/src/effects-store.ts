import type { SupabaseClient } from '@supabase/supabase-js';
import type { EffectClaim, EffectsLedger, ToolEffect } from '@anomalia/agent-kit';
import { legacyEffectKey, sameEffectPayload } from './effects';

const TABLE = 'agent_kit_effects';
const UNIQUE_VIOLATION = '23505';
const INTENDED_STATUS: ToolEffect['status'] = 'intended';
const FAILED_STATUS: ToolEffect['status'] = 'failed';

type Row = {
	id: string;
	brand_id: string;
	run_id: string | null;
	tool_name: string;
	invocation_id: string | null;
	idempotency_key: string | null;
	status: ToolEffect['status'];
	request?: unknown;
	result?: unknown;
	created_at: string;
	updated_at: string;
};

function toEffect(r: Row): ToolEffect {
	return {
		id: r.id,
		brandId: r.brand_id,
		runId: r.run_id ?? null,
		toolName: r.tool_name,
		invocationId: r.invocation_id ?? null,
		status: r.status,
		request: r.request,
		result: r.result,
		createdAt: r.created_at,
		updatedAt: r.updated_at
	};
}

function uniqueViolation(error: { code?: string; message?: string }): boolean {
	return error.code === UNIQUE_VIOLATION || /duplicate key|unique constraint/i.test(error.message ?? '');
}

function samePayload(effect: ToolEffect, record: { toolName: string; request: unknown }): boolean {
	return effect.toolName === record.toolName && sameEffectPayload(effect.request, record.request);
}

async function findInvocation(
	db: SupabaseClient,
	brandId: string,
	invocationId: string
): Promise<ToolEffect | null> {
	const { data, error } = await db
		.from(TABLE)
		.select()
		.eq('brand_id', brandId)
		.eq('invocation_id', invocationId)
		.maybeSingle();
	if (error) {
		throw new Error(`effects: lettura claim fallita — ${error.message}`);
	}
	return data ? toEffect(data as Row) : null;
}

export function createEffectsLedger(db: SupabaseClient): EffectsLedger {
	return {
		async claim(record): Promise<EffectClaim> {
			if (record.legacyKey) {
				const { data, error } = await db
					.from(TABLE)
					.select()
					.eq('brand_id', record.brandId)
					.eq('idempotency_key', record.legacyKey)
					.is('invocation_id', null)
					.maybeSingle();
				if (error) {
					throw new Error(`effects: lettura legacy fallita — ${error.message}`);
				}
				if (data) {
					const effect = toEffect(data as Row);
					if (effect.runId === record.runId) {
						if (!samePayload(effect, record)) {
							return { kind: 'mismatch', effect };
						}
						if (effect.status !== FAILED_STATUS) {
							return { kind: 'existing', effect };
						}
					}
				}
			}

			const { data, error } = await db
				.from(TABLE)
				.insert({
					brand_id: record.brandId,
					run_id: record.runId,
					tool_name: record.toolName,
					invocation_id: record.invocationId,
					idempotency_key: null,
					status: INTENDED_STATUS,
					request: record.request
				})
				.select()
				.maybeSingle();
			if (!error && data) {
				return { kind: 'claimed', effect: toEffect(data as Row) };
		}
		if (error && !uniqueViolation(error)) {
			throw new Error(`effects: claim fallito — ${error.message}`);
		}

			const existing = await findInvocation(db, record.brandId, record.invocationId);
			if (!existing) {
				throw new Error('effects: claim concorrente senza riga proprietaria');
			}
			if (!samePayload(existing, record)) {
				return { kind: 'mismatch', effect: existing };
			}
			if (existing.status !== FAILED_STATUS) {
				return { kind: 'existing', effect: existing };
			}

			const retried = await db
				.from(TABLE)
				.update({
					run_id: record.runId,
					status: INTENDED_STATUS,
					result: null,
					updated_at: new Date().toISOString()
				})
				.eq('id', existing.id)
				.eq('status', 'failed')
				.select()
				.maybeSingle();
			if (retried.error) {
				throw new Error(`effects: retry fallito — ${retried.error.message}`);
			}
			if (retried.data) {
				return { kind: 'claimed', effect: toEffect(retried.data as Row) };
			}

			const current = await findInvocation(db, record.brandId, record.invocationId);
			if (!current) {
				throw new Error('effects: retry concorrente senza riga proprietaria');
			}
			return samePayload(current, record)
				? { kind: 'existing', effect: current }
				: { kind: 'mismatch', effect: current };
		},

		async resolve(id, status, result): Promise<boolean> {
			const { data, error } = await db
				.from(TABLE)
				.update({ status, result, updated_at: new Date().toISOString() })
				.eq('id', id)
				.eq('status', 'intended')
				.select('id')
				.maybeSingle();
			if (error) {
				throw new Error(`effects: resolve fallito — ${error.message}`);
			}
			return !!data;
		},

		async reconcileRun(runId): Promise<number> {
			const { data, error } = await db
				.from(TABLE)
				.update({ status: 'ambiguous', updated_at: new Date().toISOString() })
				.eq('run_id', runId)
				.eq('status', 'intended')
				.select('id');
			if (error) {
				throw new Error(`effects: reconcile fallito — ${error.message}`);
			}
			return data?.length ?? 0;
		}
	};
}

export const effectKey = legacyEffectKey;
