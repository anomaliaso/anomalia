import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:8000',
	PUBLIC_SUPABASE_ANON_KEY: 'anon-key'
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

vi.mock('@sentry/sveltekit', () => ({
	sentryHandle: () => ({ event, resolve }: { event: unknown; resolve: (event: unknown) => unknown }) =>
		resolve(event),
	handleErrorWithSentry: () => () => undefined
}));

vi.mock('@sveltejs/kit/hooks', () => ({
	sequence: (...handlers: Array<(input: { event: any; resolve: any }) => any>) =>
		({ event, resolve }: { event: any; resolve: any }) => {
			const run = (index: number, nextEvent: any): any => {
				if (index === handlers.length) return resolve(nextEvent);
				return handlers[index]({
					event: nextEvent,
					resolve: (resolvedEvent: any) => run(index + 1, resolvedEvent)
				});
			};

			return run(0, event);
		}
}));

const aiCalls: Record<string, unknown>[] = [];

vi.mock('$lib/server/supabase-admin', () => ({
	createAdminClient: () => ({
		from: () => ({
			insert: async (row: Record<string, unknown>) => {
				aiCalls.push(row);
				return { error: null };
			}
		})
	})
}));

const { handle } = await import('./hooks.server');
const { logAiCall } = await import('$lib/server/ai-log');

describe('server session recovery', () => {
	it('serves the request when the session cookie is invalid Base64-URL', async () => {
		const response = await handle({
			event: {
				request: new Request('http://localhost/status'),
				url: new URL('http://localhost/status'),
				route: { id: '/status' },
				params: {},
				cookies: {
					getAll: () => [{ name: 'sb-localhost-auth-token', value: 'base64-*' }],
					get: () => undefined,
					set: vi.fn()
				},
				locals: {}
			},
			resolve: async (event: any) => {
				expect(await event.locals.safeGetSession()).toEqual({ session: null, user: null });
				return new Response('ok');
			}
		} as any);

		expect(response.status).toBe(200);
	});
});

/**
 * Lo stesso posto in cui si stabilisce a quale brand addebitare la spesa stabilisce anche chi
 * l'ha causata: una rotta non può dimenticarsene. Il nome arriva dalla rete, quindi si convalida
 * qui — chiunque può spedire quell'intestazione, e una riga di `ai_calls` attribuita a un tool
 * inventato è peggio di una riga senza nessun tool.
 */
describe('il tool che ha chiesto il lavoro', () => {
	const spendUnder = async (headers: Record<string, string>) => {
		aiCalls.length = 0;
		await handle({
			event: {
				request: new Request('http://localhost/api/v1/brands/demo/weekly-plan/plan', { headers }),
				url: new URL('http://localhost/api/v1/brands/demo/weekly-plan/plan'),
				route: { id: '/api/v1/brands/[slug]/weekly-plan/plan' },
				params: {},
				cookies: { getAll: () => [], get: () => undefined, set: vi.fn() },
				locals: {}
			},
			resolve: async () => {
				logAiCall({ label: 'planStrategy', provider: 'internal', ms: 1, ok: true });
				return new Response('ok');
			}
		} as any);

		await vi.waitFor(() => expect(aiCalls).toHaveLength(1));
		return aiCalls[0];
	};

	it('finisce sulla riga della spesa che ha causato', async () => {
		expect((await spendUnder({ 'x-anomalia-tool': 'plan_week' })).context).toBe('tool:plan_week');
	});

	it('non scrive quello che un nome di tool non è', async () => {
		expect((await spendUnder({ 'x-anomalia-tool': 'DROP TABLE ai_calls' })).context).toBeNull();
	});

	it('senza intestazione la riga resta com’era', async () => {
		expect((await spendUnder({})).context).toBeNull();
	});
});
