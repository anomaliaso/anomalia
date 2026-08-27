import { beforeEach, describe, expect, it } from 'vitest';
import { createTeamActivityTools } from './team-activity-tools';

/**
 * GLI OCCHI DELLA SQUADRA. Un agente che non sa cosa hanno fatto i colleghi duplica il lavoro o
 * passa sopra di esso; un DM senza risposta è una palla in corteo che nessuno guarda. Il tool
 * restituisce le due cose in una sola chiamata: l'ultimo report di ogni collega e i DM dove la
 * palla sta a chi.
 */

type Row = Record<string, unknown>;
let threads: Row[] = [];
let messages: Row[] = [];
let customs: Row[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeClient(): any {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const from = (_table: string) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const self: any = {
			select: () => self,
			eq: () => self,
			in: () => self,
			not: () => self,
			or: () => self,
			order: () => self,
			limit: () => self,
			async then(resolve: (v: unknown) => unknown) {
				if (_table === 'chat_threads') return resolve({ data: threads, error: null });
				if (_table === 'chat_messages') return resolve({ data: messages, error: null });
				return resolve({ data: customs, error: null });
			},
			async maybeSingle() {
				return { data: null, error: null };
			}
		};
		return self;
	};
	return { from };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (meKey: string | null): Promise<any> => {
	const tools = createTeamActivityTools({
		supabase: fakeClient(),
		brandId: 'b1',
		userId: 'u1',
		locale: 'en',
		memoryAgent: meKey
	});
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return tools.team_activity.execute({}, { toolCallId: 't', messages: [] } as any);
};

beforeEach(() => {
	threads = [];
	messages = [];
	customs = [];
});

describe('team_activity', () => {
	it('elenca la squadra con l\u2019ultimo report di ogni collega', async () => {
		threads = [
			{ id: 'j-content', surface: 'team', surface_key: 'content', updated_at: '2026-08-26T08:00:00Z' },
			{ id: 'j-ugc', surface: 'team', surface_key: 'ugc', updated_at: '2026-08-20T08:00:00Z' }
		];
		messages = [
			{ thread_id: 'j-content', role: 'assistant', content: 'Weekly batch produced: 5 posts.', created_at: '2026-08-26T08:00:00Z' },
			{ thread_id: 'j-content', role: 'assistant', content: 'older entry', created_at: '2026-08-19T08:00:00Z' }
		];
		const out = await run('motion');
		expect(out.me).toBe('motion');
		const content = out.teammates.find((m: Row) => m.key === 'content');
		expect(content.name).toBe('Content Creator');
		expect(content.latest_report).toContain('Weekly batch produced');
		const ugc = out.teammates.find((m: Row) => m.key === 'ugc');
		expect(ugc.latest_report).toBeNull();
	});

	it('un DM dove ha scritto per ultimo il collega aspetta ME', async () => {
		threads = [
			{
				id: 'dm1',
				surface: null,
				room_agents: { dm: ['analyst', 'motion'], names: { analyst: 'Analyst', motion: 'Motion Specialist' } },
				updated_at: '2026-08-26T09:00:00Z'
			}
		];
		messages = [
			{ thread_id: 'dm1', role: 'assistant', speaker: 'analyst', content: 'Numbers look off — check before publishing.', created_at: '2026-08-26T09:00:00Z' }
		];
		const out = await run('motion');
		expect(out.waiting_on_me).toHaveLength(1);
		expect(out.waiting_on_me[0].key).toBe('analyst');
		expect(out.waiting_on_me[0].excerpt).toContain('Numbers look off');
		expect(out.waiting_on_them).toHaveLength(0);
	});

	it('un DM dove ho parlato io per ultimo aspetta IL COLLEGA', async () => {
		threads = [
			{
				id: 'dm2',
				room_agents: { dm: ['analyst', 'motion'], names: {} },
				updated_at: '2026-08-26T09:00:00Z'
			}
		];
		messages = [
			{ thread_id: 'dm2', role: 'user', speaker: 'motion', content: 'Sending you the draft brief.', created_at: '2026-08-26T09:00:00Z' }
		];
		const out = await run('motion');
		expect(out.waiting_on_me).toHaveLength(0);
		expect(out.waiting_on_them[0].key).toBe('analyst');
	});

	it('i custom agent attivi entrano nella squadra col loro nome', async () => {
		customs = [{ id: 'c9', name: 'Newsletter Editor', enabled: true }];
		const out = await run('content');
		const custom = out.teammates.find((m: Row) => m.key === 'custom:c9');
		expect(custom?.name).toBe('Newsletter Editor');
	});

	it('senza niente torna vuoto e onesto, mai inventato', async () => {
		const out = await run(null);
		expect(out.teammates.length).toBeGreaterThan(0);
		expect(out.teammates.every((m: Row) => m.latest_report === null)).toBe(true);
		expect(out.waiting_on_me).toEqual([]);
		expect(out.waiting_on_them).toEqual([]);
	});
});
