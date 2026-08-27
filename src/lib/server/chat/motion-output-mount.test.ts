import { describe, expect, it, vi } from 'vitest';

/**
 * Il render MP4 montato in chat deve ricevere il tempo rimasto del turno: senza, la guardia
 * `MIN_MP4_RENDER_MS` veniva semplicemente saltata su questa superficie e un lease da 900s si
 * apriva dentro un turno da 300 — pagato per intero, ucciso a metà.
 */

const received: Array<Record<string, unknown>> = [];
vi.mock(import('$lib/server/motion-video/output-tools'), async (importOriginal) => {
	const original = await importOriginal();
	return {
		...original,
		createMotionOutputTools: ((opts: Record<string, unknown>) => {
			received.push(opts);
			return original.createMotionOutputTools(opts as never);
		}) as never
	};
});

describe('createChatTools → createMotionOutputTools', () => {
	// 30s: il test importa TUTTO tools.ts (il grafo intero della chat), che da solo costa ~5s a
	// freddo — il default di 5s falliva o passava per una manciata di ms a seconda della macchina.
	it('inoltra remainingMs del turno al render', { timeout: 30_000 }, async () => {
		const { createChatTools } = await import('./tools');
		const remainingMs = () => 123_456;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		createChatTools({} as any, 'b1', 'Europe/Rome', 'u1', '', 'it', undefined, '', [], [], '', remainingMs);
		expect(received.length).toBe(1);
		expect(received[0].remainingMs).toBe(remainingMs);
	});
});
