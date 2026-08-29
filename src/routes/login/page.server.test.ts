import { describe, expect, it } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { load } from './+page.server';

const ORIGIN = 'https://anomalia.so';
const SIGNED_IN = { session: { access_token: 'jwt' }, user: { id: 'u1' } };

function run(path: string) {
  const url = new URL(`${ORIGIN}${path}`);
  const event = {
    url,
    cookies: {
      get: () => undefined,
      delete: () => undefined
    },
    locals: { safeGetSession: async () => SIGNED_IN }
  };

  return Promise.resolve((load as any)(event)).then(
    () => null,
    (error) => {
      if (isRedirect(error)) return { status: error.status, location: error.location };
      throw error;
    }
  );
}

describe('login page load', () => {
  it('keeps a website URL for an authenticated user', async () => {
    await expect(run('/login?website=acme.example')).resolves.toEqual({
      status: 303,
      location: '/app/onboarding?website=acme.example'
    });
  });
});
