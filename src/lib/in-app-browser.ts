// Detects embedded "in-app" browsers — the webviews inside native apps like Instagram,
// Facebook, TikTok, LinkedIn, etc. Google (and most OAuth providers) reject sign-in from
// these with a `disallowed_useragent` error, so we need to bounce the user out into their
// real default browser before starting the OAuth flow.

export type InAppBrowser = {
  /** True when we believe the page is running inside a native app's embedded webview. */
  isInApp: boolean;
  os: 'ios' | 'android' | 'other';
  /** Best-effort name of the host app, used to make the "open in browser" hint friendlier. */
  app: string | null;
};

// Apps that advertise themselves in the UA string. Order matters only for the label we show.
const IN_APP_PATTERNS: Array<[RegExp, string]> = [
  [/Instagram/i, 'Instagram'],
  [/FBAN|FBAV|FB_IAB|FB4A|FBIOS/i, 'Facebook'],
  [/Messenger/i, 'Messenger'],
  [/TikTok|musical_ly|BytedanceWebview|trill/i, 'TikTok'],
  [/LinkedInApp/i, 'LinkedIn'],
  [/Twitter/i, 'X'],
  [/Line\//i, 'LINE'],
  [/Snapchat/i, 'Snapchat'],
  [/Pinterest/i, 'Pinterest'],
  [/WhatsApp/i, 'WhatsApp'],
  [/GSA\//i, 'Google App']
];

export function detectInAppBrowser(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): InAppBrowser {
  const os: InAppBrowser['os'] = /iPhone|iPad|iPod/i.test(ua)
    ? 'ios'
    : /Android/i.test(ua)
      ? 'android'
      : 'other';

  let app: string | null = null;
  for (const [re, name] of IN_APP_PATTERNS) {
    if (re.test(ua)) {
      app = name;
      break;
    }
  }

  let isInApp = app !== null;

  // Generic heuristics for in-app browsers that don't name themselves in the UA:
  // - Android System WebView injects "; wv)" into the UA.
  // - iOS webviews run WebKit ("AppleWebKit") but, unlike real Safari, drop the "Safari" token
  //   (and aren't Chrome/Firefox/Edge for iOS, which keep CriOS/FxiOS/EdgiOS).
  if (!isInApp) {
    if (os === 'android' && /;\s*wv\)/i.test(ua)) isInApp = true;
    if (os === 'ios' && /AppleWebKit/i.test(ua) && !/Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)) isInApp = true;
  }

  return { isInApp, os, app };
}

// Android can hand a URL straight to the user's default browser via an `intent://` URL.
// iOS webviews have no reliable programmatic escape, so callers fall back to instructions.
export function androidIntentUrl(rawUrl: string): string {
  const u = new URL(rawUrl);
  const scheme = u.protocol.replace(':', '');
  const withoutScheme = rawUrl.slice(u.protocol.length + 2); // strip "https://"
  return `intent://${withoutScheme}#Intent;scheme=${scheme};action=android.intent.action.VIEW;end`;
}
