import { getAvailableFonts } from '@remotion/google-fonts';

export type FontResolveResult = {
  fontFamily: string;
  /** Where the CSS family came from — used by the design-lab font check. */
  source: 'google' | 'system';
  requested: string | null;
};

const SYSTEM_STACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const FALLBACK_GOOGLE = 'Inter';

function findGoogleFont(name: string) {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return getAvailableFonts().find((f) => f.fontFamily.toLowerCase() === needle);
}

/**
 * Resolve a brand/kit font name to a CSS font-family that Remotion can wait on.
 * Prefer Google Fonts (via @remotion/google-fonts load + waitUntilDone); else system stack.
 * Never invents a readiness protocol — Remotion's delayRender is triggered by loadFont itself.
 */
export async function resolveFontFamily(preferred?: string | null): Promise<FontResolveResult> {
  const requested = preferred?.trim() || null;
  const candidates = [requested, FALLBACK_GOOGLE].filter(Boolean) as string[];

  for (const name of candidates) {
    const entry = findGoogleFont(name);
    if (!entry) continue;
    // A font that FAILS TO LOAD must degrade, not abort. Without this try/catch a flaky network
    // on the Google Fonts CDN propagated out of the caller's async effect into cancelRender(),
    // killing the whole PNG export — when a still rendered in the system stack is strictly better
    // than no still at all. Falls through to the next candidate, then to SYSTEM_STACK.
    try {
      const mod = await entry.load();
      const loaded = mod.loadFont('normal', {
        weights: ['400', '500', '600', '700'],
        subsets: ['latin']
      });
      await loaded.waitUntilDone();
      return {
        fontFamily: loaded.fontFamily,
        source: 'google',
        requested
      };
    } catch (err) {
      console.warn(`[design/fonts] "${name}" failed to load, falling through:`, err);
    }
  }

  return { fontFamily: SYSTEM_STACK, source: 'system', requested };
}

/** Pick the first usable font name from brand_kit.fonts (`{name,source}[]` or string[]). */
export function firstBrandFontName(fonts: unknown): string | null {
  if (!Array.isArray(fonts) || fonts.length === 0) return null;
  for (const f of fonts) {
    if (typeof f === 'string' && f.trim()) return f.trim();
    if (f && typeof f === 'object') {
      const name = (f as { name?: string; family?: string }).name ?? (f as { family?: string }).family;
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
  }
  return null;
}
