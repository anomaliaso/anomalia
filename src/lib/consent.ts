// Cookie-consent state for Anomalia.
//
// Consent here gates ONLY the cookie-based, full-fidelity analytics: persistent PostHog
// (cookies) + session replay, plus Microsoft Clarity. An anonymous, cookieless PostHog tier
// runs regardless (see $lib/analytics) — the Garante generally treats that aggregate mode as
// exempt from prior consent. Strictly-necessary sign-in/security cookies are always on too.
//
// The banner is region-gated (see initConsentForRegion): only EEA/UK/CH visitors are asked;
// everyone else is auto-granted full analytics, since prior consent isn't required there.
//
// The choice is stored in localStorage under a versioned key — bump STORAGE_KEY if the
// set of categories changes, so users are re-asked.

import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type Consent = 'granted' | 'denied' | null;

const STORAGE_KEY = 'anomalia_cookie_consent_v1';

function read(): Consent {
  if (!browser) return null;
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'granted' || v === 'denied' ? v : null;
}

/** Current analytics consent: 'granted' | 'denied' | null (not yet chosen). */
export const consent = writable<Consent>(read());

// Starts hidden; initConsentForRegion() decides whether to show it once we know the visitor's
// country. Kept hidden until then so extra-EU visitors never flash a banner they don't need.
export const showBanner = writable<boolean>(false);

// Countries whose privacy law requires PRIOR opt-in consent for analytics cookies / session
// replay: the EEA (EU 27 + Iceland, Liechtenstein, Norway) plus the UK and Switzerland. Visitors
// from anywhere else get full analytics with no banner. Unknown country → treated as in-set (safe).
const CONSENT_REQUIRED = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', // EU 27
  'IS', 'LI', 'NO', // EEA extras
  'GB', 'CH' // UK GDPR + Swiss nFADP
]);

/**
 * Decide consent behaviour from the visitor's country (from the Vercel edge header). Call once the
 * region is known. Respects an explicit prior choice. Extra-EU visitors are auto-granted full
 * analytics (no prior consent required there); EEA/UK/CH or unknown countries get the banner.
 */
export function initConsentForRegion(country: string | null | undefined) {
  if (!browser || read() !== null) return; // respect an explicit prior choice
  if (country && !CONSENT_REQUIRED.has(country)) {
    setConsent('granted'); // extra-EU → full analytics, no banner needed
  } else {
    showBanner.set(true); // EEA/UK/CH or unknown → ask first
  }
}

/** Record a choice, persist it, and (on grant) trigger analytics loading. */
export async function setConsent(value: 'granted' | 'denied') {
  if (browser) localStorage.setItem(STORAGE_KEY, value);
  consent.set(value);
  showBanner.set(false);
  if (value === 'granted') {
    const { enableFullAnalytics } = await import('./analytics');
    enableFullAnalytics();
  }
}

/** Re-open the preferences panel (e.g. from a "Cookie preferences" footer link). */
export function openCookieSettings() {
  showBanner.set(true);
}
