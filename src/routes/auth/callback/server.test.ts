import { describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';

const exchangeCodeForSession = vi.fn();

vi.mock('$lib/server/access', () => ({ canEnter: vi.fn() }));
vi.mock('$lib/server/feature-flags', () => ({ isPlanGoEnabled: () => true }));
vi.mock('$lib/server/oauth', () => ({ takeOAuthReturn: () => null }));

const { GET } = await import('./+server');

async function redirectFor(code: string) {
  const event = {
    url: new URL(`https://anomalia.so/auth/callback?code=${code}`),
    cookies: {},
    locals: { supabase: { auth: { exchangeCodeForSession } } }
  };

  try {
    await (GET as unknown as (event: unknown) => Promise<never>)(event);
  } catch (error) {
    if (isRedirect(error)) return { status: error.status, location: error.location };
    throw error;
  }

  throw new Error('Expected callback to redirect');
}

describe('OAuth callback', () => {
  it('returns to login with an error when code exchange fails', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: new Error('code expired') });

    await expect(redirectFor('expired')).resolves.toEqual({
      status: 303,
      location: '/login?error=link'
    });
  });
});
