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

const { handle } = await import('./hooks.server');

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
