// Cookie consent for the PUBLIC brand blog — independent from Anomalia's app consent (different
// visitor, different domain). It gates ONLY the Meta Pixel, which is the sole tracker that runs on
// blog pages. Strictly-functional storage (theme choice) needs no consent and is unaffected.
import { browser } from '$app/environment';
import { loadMetaPixel } from '$lib/analytics';

type Choice = 'granted' | 'denied' | null;
const KEY = 'anomalia_blog_consent_v1';

let _choice = $state<Choice>(null);
let _open = $state(false);
let _init = false;

/** Read the stored choice once (call from the banner's onMount). Re-fires the pixel for returning
 *  visitors who already accepted; shows the banner on first visit. No SSR flash: _open stays false
 *  until this runs client-side. */
export function initBlogConsent() {
  if (_init || !browser) return;
  _init = true;
  const v = localStorage.getItem(KEY);
  _choice = v === 'granted' || v === 'denied' ? v : null;
  if (_choice === null) _open = true;
  else if (_choice === 'granted') loadMetaPixel();
}

export function blogBannerOpen() { return _open; }
export function openBlogCookieSettings() { _open = true; }

export function setBlogConsent(value: 'granted' | 'denied') {
  _choice = value;
  if (browser) localStorage.setItem(KEY, value);
  _open = false;
  if (value === 'granted') loadMetaPixel();
}
