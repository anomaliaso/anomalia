import { createBrowserClient } from '@supabase/ssr';
import { env as publicEnv } from '$env/dynamic/public';

// Browser-side Supabase client (shares the SSR cookie session).
export function createSupabaseBrowserClient() {
  return createBrowserClient(publicEnv.PUBLIC_SUPABASE_URL, publicEnv.PUBLIC_SUPABASE_ANON_KEY);
}
