import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Clears the Supabase session (cookies) and bounces back to the login page.
// scope 'local' on purpose: the supabase-js default is 'global', which revokes *every* refresh
// token the user has — so signing out of the browser also killed the CLI (`anomalia login`) and
// any MCP client connected via OAuth. Sign-out here means "this browser", not "everywhere".
// Revoking every device is a separate, explicit action if we ever want it.
export const POST: RequestHandler = async ({ locals: { supabase } }) => {
  await supabase.auth.signOut({ scope: 'local' });
  throw redirect(303, '/login');
};
