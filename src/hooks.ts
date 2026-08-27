import type { Reroute } from '@sveltejs/kit';
import { building } from '$app/environment';
import { PUBLIC_APP_URL } from '$env/static/public';

// Multi-tenant blog hosting: any request arriving on a host that ISN'T the main Anomalia app (i.e. a
// brand's own custom domain pointed here via CNAME) is served from the `_site` route group, which
// resolves the brand by hostname and renders its published articles. The main app is untouched.
const appHost = (() => { try { return new URL(PUBLIC_APP_URL).hostname; } catch { return ''; } })();

function isAppHost(h: string): boolean {
  // FAIL SAFE: if we don't know the app's own host (PUBLIC_APP_URL unset), treat EVERY host as the
  // app — blog hosting simply stays off rather than risk rerouting the real app domain to a 404.
  if (!appHost) return true;
  if (!h) return true;
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')) return true;
  if (h.endsWith('.vercel.app')) return true;          // preview + vercel-assigned prod domains
  if (h === appHost || h === `www.${appHost}`) return true;
  return false;
}

export const reroute: Reroute = ({ url }) => {
  // Never reroute during build/prerender: the prerender origin host (sveltekit-prerender) isn't the
  // app host, so it would wrongly get treated as a blog host and 404 real app pages. Blog hosting is
  // a runtime-only concern.
  if (building) return;
  if (isAppHost(url.hostname)) return;                  // main app: no change
  // Don't touch SvelteKit internals/assets or an already-rerouted path.
  if (url.pathname.startsWith('/_app') || url.pathname.startsWith('/_site') || url.pathname.startsWith('/@')) return;
  return `/_site${url.pathname === '/' ? '' : url.pathname}`;
};
