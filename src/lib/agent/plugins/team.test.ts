import { describe, expect, it, vi } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import { fakeContext } from '../testkit';

/**
 * La fabbrica dei DM resta REALE (importOriginal) e viene solo CONTATA: il vincolo che il
 * plugin può rompere in silenzio è il tetto per turno, e quel tetto vive nella closure di
 * `createAgentDmTools`. Un wrapper che la richiamasse a ogni execute azzererebbe tetto e
 * dedupe a ogni messaggio — e ogni asserzione sul singolo invio resterebbe verde.
 */
const built = vi.fn();
vi.mock('$lib/agent/tools/agent-dm-tools', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/agent/tools/agent-dm-tools')>();
	return {
		...actual,
		createAgentDmTools: (opts: Parameters<typeof actual.createAgentDmTools>[0]) => {
			built();
			return actual.createAgentDmTools(opts);
		}
	};
});

const { createTeamPlugin } = await import('./team');

function plugin() {
	const kit = createTestSupabase({
		chat_threads: [{ id: 't1', brand_id: 'b1', user_id: 'u1', agent: 'motion', room_agents: null }]
	});
	return createTeamPlugin({
		supabase: kit.client,
		brandId: 'b1',
		userId: 'u1',
		threadId: 't1',
		origin: 'https://x.test',
		locale: 'it'
	});
}

describe('il plugin squadra espone message_agent al kit', () => {
	it('lo schema viene dal tool vero, non riscritto a mano', () => {
		const spec = plugin().tools.find((t) => t.name === 'message_agent');
		expect(spec).toBeDefined();
		const props = (spec!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
		expect(Object.keys(props).sort()).toEqual(['await', 'because_user_asked', 'message', 'to']);
		expect(spec!.description).toContain('ANOTHER agent');
	});

	it('il plugin squadra espone anche open_session_with_user al kit', () => {
		const spec = plugin().tools.find((t) => t.name === 'open_session_with_user');
		expect(spec).toBeDefined();
		const props = (spec!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
		expect(Object.keys(props).sort()).toEqual(['message']);
		expect(spec!.description).toContain('WITH THE USER');
	});

	it('i rifiuti deliberati del DM arrivano intatti al kit', async () => {
		const res = await plugin().execute(
			{ name: 'message_agent', args: { to: 'anomalia', message: 'ciao' } },
			fakeContext()
		);
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.error).toContain('Anomalia does not receive agent messages');
		expect(res.isError).toBe(true);
	});

	it('la fabbrica dei DM gira UNA volta per plugin: tetto e dedupe sopravvivono agli execute', async () => {
		built.mockClear();
		const p = plugin();
		await p.execute({ name: 'message_agent', args: { to: 'anomalia', message: 'a' } }, fakeContext());
		await p.execute({ name: 'message_agent', args: { to: 'anomalia', message: 'b' } }, fakeContext());
		expect(built).toHaveBeenCalledTimes(1);
	});
});
