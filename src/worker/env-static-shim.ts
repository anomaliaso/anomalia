/**
 * Stand-in for `$env/static/public` outside SvelteKit.
 *
 * SvelteKit inlines these at build time; a worker reads them at boot instead. Only the names the
 * server library actually imports are re-exported — a missing one should fail here, loudly and at
 * startup, rather than surface later as an undefined URL in a Supabase client.
 */
function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`[worker] missing required environment variable: ${name}`);
	return value;
}

export const PUBLIC_SUPABASE_URL = required('PUBLIC_SUPABASE_URL');
export const PUBLIC_SUPABASE_ANON_KEY = required('PUBLIC_SUPABASE_ANON_KEY');
