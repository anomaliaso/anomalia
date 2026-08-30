/**
 * LA LOGICA PURA del gate degli effetti — niente db, niente framework. Decide se un tool con un
 * effetto collaterale va rieseguito o se è già stato (o è stato avviato e lasciato in dubbio) e
 * quindi va congelato. La macchina a stati: `intended -> completed|failed`, con i ripieghi
 * `ambiguous` (il segmento è morto a metà) e `reconciled` (confermato fuori). Il claim atomico per
 * identità vive nel port `EffectsLedger`; questo modulo conserva la logica pura.
 */
import type { EffectStatus, ToolEffect, ToolResult } from '@anomalia/agent-kit';

export const EFFECT_LID_NOTE = 'questo effetto è già stato registrato: non rieseguo per evitare un doppione';

/** Stati a cui l'effetto è già avvenuto (o è avviato ma di esito ignoto): NON vanno rieseguiti. */
const FROZEN_STATUSES: ReadonlySet<EffectStatus> = new Set(['completed', 'ambiguous', 'reconciled']);

/** C'è già un esito non-rieseguibile per questo effetto? */
export function isFrozen(status: EffectStatus): boolean {
	return FROZEN_STATUSES.has(status);
}

/** Decide se un claim già presente può essere ritentato. Solo failed è ritentabile. */
export function decide(effect: ToolEffect | null): { run: boolean; note: string } {
	if (!effect) return { run: true, note: '' };
	if (effect.status === 'failed') return { run: true, note: '' };
	return { run: false, note: EFFECT_LID_NOTE };
}

/** Il result memorizzato per un effetto congelato — da restituire al posto di rieseguire. */
export function frozenResult(effect: ToolEffect): ToolResult | null {
	if (!isFrozen(effect.status)) return null;
	return (effect.result as ToolResult | null) ?? null;
}

export function sameEffectPayload(left: unknown, right: unknown): boolean {
	return stableSerialize(left) === stableSerialize(right);
}

export function legacyEffectKey(toolName: string, args: Record<string, unknown>): string {
	const canonical = stableSerialize(args);
	const bytes = new TextEncoder().encode(`${toolName}\n${canonical}`);
	const FNV_OFFSET = 0x811c9dc5;
	const FNV_PRIME = 0x01000193;
	let hash = FNV_OFFSET;
	for (const b of bytes) {
		hash ^= b;
		hash = Math.imul(hash, FNV_PRIME);
	}
	return `${toolName}:${(hash >>> 0).toString(36)}:${canonical.length}`;
}

export const effectKey = legacyEffectKey;

function stableSerialize(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableSerialize).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}
