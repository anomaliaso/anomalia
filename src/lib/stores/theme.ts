import { readable } from 'svelte/store';
import { browser } from '$app/environment';

/**
 * Is the app in dark mode right now? The theme lives as `data-theme` on <html>, set by the
 * toggle in the sidebars and by OS detection at boot, so we watch the attribute rather than
 * `prefers-color-scheme` — a user who forced light on a dark machine must read as light.
 *
 * Defaults to false on the server, where there is no document to ask.
 */
export const isDarkTheme = readable(false, (set) => {
  if (!browser) return;
  const read = () => set(document.documentElement.getAttribute('data-theme') === 'dark');
  read();
  const obs = new MutationObserver(read);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => obs.disconnect();
});
