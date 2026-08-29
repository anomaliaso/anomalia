import { describe, expect, it } from 'vitest';
import { decide, frozenResult, isFrozen, EFFECT_LID_NOTE } from './effects';
import { effectKey } from './effects-store';
import type { ToolEffect } from '@anomalia/agent-kit';

function effect(status: ToolEffect['status'], result?: unknown, over: Partial<ToolEffect> = {}): ToolEffect {
	return {
		id: 'e1',
		brandId: 'b1',
		runId: 'r1',
		toolName: 'content_schedule',
		idempotencyKey: 'k',
		status,
		result,
		createdAt: '2026-08-29T00:00:00.000Z',
		updatedAt: '2026-08-29T00:00:00.000Z',
		...over
	};
}

const RESULT = { content: [{ type: 'text' as const, text: 'post creato' }] };

describe('decide — la macchina a stati del gate', () => {
	it('null e failed lasciano RIESEGUIRE (non c\'è ancora un esito), gli altri congelano', () => {
		expect(decide(null).run).toBe(true);
		expect(decide(effect('failed')).run).toBe(true);
		expect(decide(effect('intended')).run).toBe(false);
		expect(decide(effect('completed')).run).toBe(false);
		expect(decide(effect('ambiguous')).run).toBe(false);
		expect(decide(effect('reconciled')).run).toBe(false);
	});

	it('il congelamento dichiara la ragione, il rieseguire no', () => {
		const d = decide(effect('completed'));
		expect(d.run).toBe(false);
		expect(d.note).toBe(EFFECT_LID_NOTE);
		expect(decide(effect('failed')).note).toBe('');
	});
});

describe('isFrozen / frozenResult', () => {
	it('completed, ambiguous e reconciled sono congelati; intended e failed no', () => {
		expect(isFrozen('completed')).toBe(true);
		expect(isFrozen('ambiguous')).toBe(true);
		expect(isFrozen('reconciled')).toBe(true);
		expect(isFrozen('intended')).toBe(false);
		expect(isFrozen('failed')).toBe(false);
	});

	it('frozenResult restituisce il result solo per i congelati', () => {
		expect(frozenResult(effect('completed', RESULT))).toEqual(RESULT);
		expect(frozenResult(effect('ambiguous', RESULT))).toEqual(RESULT);
		expect(frozenResult(effect('reconciled', RESULT))).toEqual(RESULT);
		expect(frozenResult(effect('intended', RESULT))).toBeNull();
		expect(frozenResult(effect('failed', RESULT))).toBeNull();
	});

	it('un effetto congelato senza result (segue un esito igienico) non inventa un risposta', () => {
		expect(frozenResult(effect('ambiguous', null))).toBeNull();
	});
});

describe('effectKey — deterministica e stabile', () => {
	it('stessa intenzione = stessa chiave, a prescindere dall\'ordine delle chiavi e dal run', () => {
		const a = effectKey('content_schedule', { post_id: 'p1', scheduled_for: '2026-09-01T10:00' });
		const b = effectKey('content_schedule', { scheduled_for: '2026-09-01T10:00', post_id: 'p1' });
		expect(a).toBe(b);
		expect(a).toContain('content_schedule');
	});

	it('argomenti diversi = chiavi diverse (lo stesso tool su due post non collidono)', () => {
		const a = effectKey('content_schedule', { post_id: 'p1' });
		const b = effectKey('content_schedule', { post_id: 'p2' });
		expect(a).not.toBe(b);
	});

	it('tool diversi sugli stessi argomenti non collidono', () => {
		expect(effectKey('content_create_post', { caption: 'x' })).not.toBe(effectKey('content_schedule', { caption: 'x' }));
	});

	it('la lunghezza è codificata nella chiave, così due intenzioni non collidono per troncamento', () => {
		expect(effectKey('a', {})).toContain(`:${'{}'.length}`);
	});
});
