/**
 * IL LEDGER SU POSTGRES. L'unico punto che scrive `agent_kit_effects`: `intend` prima di eseguire,
 * `resolve` dopo, `reconcileRun` quando un segmento muore. Il resto (decidere congelare) sta in
 * `effects.ts`, la logica pura.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EffectsLedger, ToolEffect } from '@anomalia/agent-kit';

const TABLE = 'agent_kit_effects';

type Row = {
	id: string;
	brand_id: string;
	run_id: string | null;
	tool_name: string;
	idempotency_key: string;
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
		idempotencyKey: r.idempotency_key,
		status: r.status,
		request: r.request,
		result: r.result,
		createdAt: r.created_at,
		updatedAt: r.updated_at
	};
}

/**
 * Chiave deterministica dell'effetto: brand + tool + args canonicalizzati. NON contiene il run_id:
 * l'idempotenza deve riconoscere la stessa intenzione attraverso un resume (che riparte da zero) e
 * un takeover. Due args che coincidono in fondo = stessa intenzione = stesso effetto.
 */
export function effectKey(toolName: string, args: Record<string, unknown>): string {
	const canonical = stableSerialize(args);
	const bytes = new TextEncoder().encode(`${toolName}\n${canonical}`);
	// FNV-1a 64-bit, esadecimale — niente crypto asincrona: il key è un indice, non un segreto.
	let hash = 0x811c9dc5;
	for (const b of bytes) {
		hash ^= b;
		hash = Math.imul(hash, 0x01000193);
	}
	return `${toolName}:${(hash >>> 0).toString(36)}:${canonical.length}`;
}

function stableSerialize(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${stableSerialize((value as Record<string, unknown>)[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

export function createEffectsLedger(db: SupabaseClient): EffectsLedger {
	return {
		async intend(record): Promise<ToolEffect> {
			const { data, error } = await db
				.from(TABLE)
				.insert({
					brand_id: record.brandId,
					run_id: record.runId,
					tool_name: record.toolName,
					idempotency_key: record.key,
					status: 'intended',
					request: record.request
				})
				.select()
				.single();
			if (error) throw new Error(`effects: intend fallito — ${error.message}`);
			return toEffect(data as Row);
		},

		async resolve(id, status, result): Promise<void> {
			const { error } = await db
				.from(TABLE)
				.update({ status, result, updated_at: new Date().toISOString() })
				.eq('id', id);
			if (error) throw new Error(`effects: resolve fallito — ${error.message}`);
		},

		async find(brandId, key): Promise<ToolEffect | null> {
			const { data, error } = await db
				.from(TABLE)
				.select()
				.eq('brand_id', brandId)
				.eq('idempotency_key', key)
				.maybeSingle();
			if (error) throw new Error(`effects: find fallito — ${error.message}`);
			return data ? toEffect(data as Row) : null;
		},

		async reconcileRun(runId): Promise<number> {
			// Solo le righe ancora `intended`: un `completed` è un esito vero, non va toccato.
			const { data, error } = await db
				.from(TABLE)
				.update({ status: 'ambiguous', updated_at: new Date().toISOString() })
				.eq('run_id', runId)
				.eq('status', 'intended')
				.select('id');
			if (error) throw new Error(`effects: reconcile fallito — ${error.message}`);
			return data?.length ?? 0;
		}
	};
}
