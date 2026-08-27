import { env as publicEnv } from '$env/dynamic/public';

/**
 * Absolute origin for auth email links and OAuth `redirectTo`.
 *
 * Prefer the request origin when it matches PUBLIC_APP_URL's registrable host
 * (www vs apex). Using only PUBLIC_APP_URL breaks Google/GitHub OAuth when the
 * browser is on www.anomalia.so but PUBLIC_APP_URL is https://anomalia.so —
 * Supabase rejects the unlisted redirectTo and dumps `?code=` on the Site URL
 * root instead of /auth/callback.
 */
export function appOrigin(url: URL): string {
  const isLocal = /^(localhost|127\.0\.0\.1)(:|$)/.test(url.hostname);
  if (isLocal) return url.origin.replace(/\/$/, '');

  // Preview deployments must bounce OAuth back to the same *.vercel.app host.
  if (url.hostname.endsWith('.vercel.app')) return url.origin.replace(/\/$/, '');

  const configured = (publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
  let configuredHost = '';
  try {
    configuredHost = new URL(configured).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    configuredHost = '';
  }
  const requestHost = url.hostname.replace(/^www\./, '').toLowerCase();
  if (configuredHost && requestHost === configuredHost) {
    return url.origin.replace(/\/$/, '');
  }
  return configured || url.origin.replace(/\/$/, '');
}
