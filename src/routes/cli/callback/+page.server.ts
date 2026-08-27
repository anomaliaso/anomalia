import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals: { safeGetSession } }) => {
  const cliPort = url.searchParams.get('cli_port') ?? '';
  const cliState = url.searchParams.get('cli_state') ?? '';

  if (!cliPort || !cliState) throw redirect(303, '/app');

  const { session, user } = await safeGetSession();
  if (!session || !user) {
    throw redirect(303, `/login?cli_port=${encodeURIComponent(cliPort)}&cli_state=${encodeURIComponent(cliState)}`);
  }

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? 0,
    cliPort,
    cliState,
    userEmail: user.email ?? ''
  };
};
