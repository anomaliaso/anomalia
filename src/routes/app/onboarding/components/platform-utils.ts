import { PLATFORM_KEYS, PLATFORM_META } from '$lib/components/platform-meta';

export const LINKEDIN_PATH = 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z';

export const pmeta = (k: string | undefined | null) => PLATFORM_META[(k ?? '').toLowerCase()] ?? null;

export const plabel = (k: string | undefined | null) => pmeta(k)?.label ?? k ?? '';

export const picon = (k: string | undefined | null) => {
  const m = pmeta(k);
  if (m?.icon) return m.icon;
  return (k ?? '').toLowerCase() === 'linkedin' ? { path: LINKEDIN_PATH, hex: '0a66c2' } : null;
};

// LinkedIn / Facebook pages are often pasted as URLs — keep those as profileUrl so scrapers
// (and the final brand_social_handles row) get a usable target.
const URLISH = new Set(['linkedin', 'facebook']);

export type HandleRef = { platform: string; username: string | null; profileUrl: string | null };

export const buildHandleList = (handles: Record<string, string>): HandleRef[] =>
  PLATFORM_KEYS.map((k) => {
    const raw = (handles[k] ?? '').trim();
    if (!raw) return null;
    if (URLISH.has(k) && (raw.includes('/') || raw.includes('.'))) {
      const profileUrl = raw.startsWith('http') ? raw : `https://${raw}`;
      return { platform: k, username: null as string | null, profileUrl };
    }
    return {
      platform: k,
      username: raw.replace(/^@/, '').replace(/^u\//, ''),
      profileUrl: null as string | null
    };
  }).filter((h): h is NonNullable<typeof h> => !!h);

export async function requestRecommendedPlatforms(
  brandId: string,
  profile: unknown
): Promise<{ recommended?: string[]; rationale?: string }> {
  const res = await fetch('/app/onboarding/recommend-platforms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brandId, profile })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { recommended?: string[]; rationale?: string };
}
