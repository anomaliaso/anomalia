import { redirect } from '@sveltejs/kit';
import {
  issueCode,
  readClientId,
  redirectUriMatches,
  stashOAuthReturn
} from '$lib/server/oauth';
import { canEnter } from '$lib/server/access';
import type { Actions, PageServerLoad } from './$types';

type Parsed =
  /** Bad client_id / redirect_uri — must be rendered in place, never redirected. */
  | { kind: 'fatal'; message: string }
  /** Reportable error: send the client back to its redirect_uri with ?error=. */
  | { kind: 'error'; back: URL }
  | {
      kind: 'ok';
      redirectUri: string;
      state: string;
      challenge: string;
      clientId: string;
      clientName: string;
    };

/**
 * Validate the authorization request. A bad client_id/redirect_uri must NOT be redirected back
 * (RFC 6749 §4.1.2.1) — that would turn this endpoint into an open redirector — so those come
 * back as `fatal` and are rendered in place. Everything else is reported to the client.
 */
function parse(url: URL): Parsed {
  const clientId = url.searchParams.get('client_id') ?? '';
  const redirectUri = url.searchParams.get('redirect_uri') ?? '';
  const client = readClientId(clientId);
  if (!client) return { kind: 'fatal', message: 'Client non riconosciuto o registrazione scaduta.' };
  if (!redirectUri || !redirectUriMatches(client, redirectUri)) {
    return { kind: 'fatal', message: 'redirect_uri non corrisponde a quella registrata dal client.' };
  }

  const state = url.searchParams.get('state') ?? '';
  const fail = (error: string, description: string): Parsed => {
    const back = new URL(redirectUri);
    back.searchParams.set('error', error);
    back.searchParams.set('error_description', description);
    if (state) back.searchParams.set('state', state);
    return { kind: 'error', back };
  };

  if (url.searchParams.get('response_type') !== 'code') {
    return fail('unsupported_response_type', 'Only response_type=code is supported');
  }
  const challenge = url.searchParams.get('code_challenge') ?? '';
  if (!challenge || url.searchParams.get('code_challenge_method') !== 'S256') {
    return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required');
  }

  return { kind: 'ok', redirectUri, state, challenge, clientId, clientName: client.name };
}

export const load: PageServerLoad = async ({ url, cookies, locals: { supabase, safeGetSession } }) => {
  const parsed = parse(url);
  if (parsed.kind === 'error') throw redirect(303, parsed.back.toString());
  if (parsed.kind === 'fatal') return { fatal: parsed.message };

  const { session, user } = await safeGetSession();
  if (!session || !user) {
    stashOAuthReturn(cookies, url.pathname + url.search);
    throw redirect(303, '/login');
  }

  // The waitlist gate lives here, not in the login redirect hooks: this is the single point
  // both the already-signed-in and the just-signed-in paths pass through.
  if (!(await canEnter(supabase))) {
    return { fatal: 'Questo account non ha ancora accesso ad Anomalia.' };
  }

  return {
    fatal: null,
    clientName: parsed.clientName,
    userEmail: user.email ?? '',
    search: url.search
  };
};

export const actions: Actions = {
  approve: async ({ url, locals: { supabase, safeGetSession } }) => {
    const parsed = parse(url);
    if (parsed.kind === 'error') throw redirect(303, parsed.back.toString());
    if (parsed.kind === 'fatal') throw redirect(303, '/app');

    const { session, user } = await safeGetSession();
    if (!session || !user?.email) throw redirect(303, '/login');
    // Re-checked here too: the action is reachable without ever rendering the page.
    if (!(await canEnter(supabase))) throw redirect(303, '/waitlist');

    const code = issueCode({
      email: user.email,
      cid: parsed.clientId,
      uri: parsed.redirectUri,
      chal: parsed.challenge
    });

    const back = new URL(parsed.redirectUri);
    back.searchParams.set('code', code);
    if (parsed.state) back.searchParams.set('state', parsed.state);
    throw redirect(303, back.toString());
  },

  deny: async ({ url }) => {
    const parsed = parse(url);
    if (parsed.kind === 'error') throw redirect(303, parsed.back.toString());
    if (parsed.kind === 'fatal') throw redirect(303, '/app');

    const back = new URL(parsed.redirectUri);
    back.searchParams.set('error', 'access_denied');
    if (parsed.state) back.searchParams.set('state', parsed.state);
    throw redirect(303, back.toString());
  }
};
