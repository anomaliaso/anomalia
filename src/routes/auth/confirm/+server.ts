import { redirect } from '@sveltejs/kit';
import type { EmailOtpType } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

// Server-side OTP verification for emailed auth links (currently: password recovery). We email a
// token_hash (minted via the admin API in the /login reset action) pointing here, then exchange it
// for a session with verifyOtp — this avoids Supabase's redirect-allow-list entirely. On success we
// forward to `next` (e.g. /auth/reset-password); on failure, back to /login flagged so the user can
// retry. `next` is constrained to in-app paths to prevent open-redirects.
export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const nextParam = url.searchParams.get('next') ?? '/app';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/app';

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) throw redirect(303, next);
  }

  throw redirect(303, '/login?error=link');
};
