import { PLATFORM_KEYS } from '$lib/components/platform-meta';
import { sanitizeWebsiteParam } from '$lib/website-param';

/** sessionStorage key for website + socials collected before login. */
export const GUEST_ONBOARDING_KEY = 'anomalia_guest_onboarding';

/**
 * Short-lived cookie so the server can send the user to `/app/onboarding` after OAuth/login
 * even when `next=onboarding` was dropped (www/apex redirect, Site URL fallback, etc.).
 * Payload stays in sessionStorage; this is only an intent flag.
 */
export const GUEST_ONBOARDING_COOKIE = 'anomalia_guest_ob';
export const GUEST_ONBOARDING_COOKIE_MAX_AGE = 60 * 60; // 1 hour

export type GuestOnboardingPending = {
  v: 1;
  url: string;
  noWebsite: boolean;
  brandName: string;
  creatorNiche: string;
  selectedPlatforms: string[];
  handles: Record<string, string>;
  /** User finished socials and should jump to analyze (or early create) after auth. */
  readyForAnalysis: boolean;
};

function isPlatformKey(k: string): boolean {
  return PLATFORM_KEYS.includes(k);
}

function sanitizeHandles(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isPlatformKey(k)) continue;
    const s = String(v ?? '').trim().slice(0, 200);
    if (s) out[k] = s;
  }
  return out;
}

function sanitizePlatforms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(String).filter(isPlatformKey))];
}

/** Parse + validate a guest onboarding blob (from sessionStorage). */
export function parseGuestOnboarding(raw: unknown): GuestOnboardingPending | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const noWebsite = !!o.noWebsite;
  const url = noWebsite ? '' : sanitizeWebsiteParam(String(o.url ?? ''));
  const brandName = String(o.brandName ?? '').trim().slice(0, 120);
  const creatorNiche = String(o.creatorNiche ?? '').trim().slice(0, 300);
  if (!noWebsite && !url) return null;
  if (noWebsite && !brandName) return null;
  const selectedPlatforms = sanitizePlatforms(o.selectedPlatforms);
  const handles = sanitizeHandles(o.handles);
  const readyForAnalysis = !!o.readyForAnalysis;
  if (readyForAnalysis && !selectedPlatforms.length) return null;
  return {
    v: 1,
    url,
    noWebsite,
    brandName,
    creatorNiche,
    selectedPlatforms,
    handles,
    readyForAnalysis
  };
}

function writeGuestCookie(ready: boolean): void {
  if (typeof document === 'undefined') return;
  try {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    if (ready) {
      document.cookie = `${GUEST_ONBOARDING_COOKIE}=1; Path=/; Max-Age=${GUEST_ONBOARDING_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    } else {
      document.cookie = `${GUEST_ONBOARDING_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    }
  } catch {
    // ignore
  }
}

export function saveGuestOnboarding(pending: GuestOnboardingPending): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(GUEST_ONBOARDING_KEY, JSON.stringify(pending));
  } catch {
    // Quota / private mode — login still carries website via query param.
  }
  writeGuestCookie(pending.readyForAnalysis);
}

export function loadGuestOnboarding(): GuestOnboardingPending | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(GUEST_ONBOARDING_KEY);
    if (!raw) return null;
    return parseGuestOnboarding(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearGuestOnboarding(): void {
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(GUEST_ONBOARDING_KEY);
    } catch {
      // ignore
    }
  }
  writeGuestCookie(false);
}

/** True when the guest-funnel cookie says analysis should run after auth. */
export function hasGuestOnboardingCookie(cookieValue: string | undefined | null): boolean {
  return cookieValue === '1';
}

/** Login URL after guest website + socials. Website is also in the query for resilience. */
export function guestOnboardingLoginHref(pending: GuestOnboardingPending): string {
  const qs = new URLSearchParams({ next: 'onboarding', mode: 'signup' });
  if (!pending.noWebsite && pending.url) qs.set('website', pending.url);
  return `/login?${qs}`;
}
