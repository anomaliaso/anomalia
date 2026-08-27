import '$lib/i18n';
import { locale, waitLocale } from 'svelte-i18n';
import type { LayoutLoad } from './$types';
import { dev } from '$app/environment';
import { injectAnalytics } from '@vercel/analytics/sveltekit';

injectAnalytics({ mode: dev ? 'development' : 'production' });

// Runs on server (SSR) and client (hydration) before the tree renders. Setting the
// locale and awaiting the dictionary here is what keeps SSR output and the first client
// render in the same language — no flash of fallback strings, no hydration mismatch.
export const load: LayoutLoad = async ({ data }) => {
  // MUST await locale.set: it's async (lazy-loads the locale's dictionary) and returns a promise
  // that resolves only once that dictionary is in memory. Fire-and-forget here let waitLocale()
  // resolve against the still-committed initial 'en' locale, so /it rendered English until it.json
  // arrived a tick later — visible as an English flash (or worse on slow links) in session replays.
  if (data?.locale) await locale.set(data.locale);
  await waitLocale();
  // Spread so session / waitlistActive / locale from +layout.server.ts reach child pages.
  return { ...data };
};
