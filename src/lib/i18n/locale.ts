// Pure-TS locale helpers — NO svelte-i18n import, so this is safe to pull into
// hooks.server.ts and app.d.ts without dragging the client i18n store server-side.

export const SUPPORTED = ['en', 'it', 'es', 'fr'] as const;
export type Locale = (typeof SUPPORTED)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(v: string | undefined | null): v is Locale {
  return !!v && (SUPPORTED as readonly string[]).includes(v);
}

// English name of the language each locale writes in. Used to tell the onboarding AIs
// (brand analysis, competitor discovery, strategy report) to produce their user-facing
// prose in the visitor's site language instead of defaulting to English.
const LOCALE_LANGUAGE_NAME: Record<Locale, string> = {
  en: 'English',
  it: 'Italian',
  es: 'Spanish',
  fr: 'French'
};

// Resolve a locale (code or unknown) to the human-readable language name the AI should
// write in. Falls back to the default locale's language for anything unsupported.
export function localeLanguageName(locale: string | undefined | null): string {
  return isLocale(locale) ? LOCALE_LANGUAGE_NAME[locale] : LOCALE_LANGUAGE_NAME[DEFAULT_LOCALE];
}

// Prefix a canonical (English) marketing path with the active locale: '/pricing' → '/it/pricing',
// '/' → '/it'. English stays unprefixed (the bare path is canonical). Only use for pages that live
// under the [[lang=locale]] group — NOT for /login, /app, etc., which are never prefixed.
export function localePath(path: string, lang: Locale): string {
  if (lang === DEFAULT_LOCALE) return path;
  return path === '/' ? `/${lang}` : `/${lang}${path}`;
}

// Resolve the active locale. Priority: explicit URL prefix (/it, /en) wins so localized
// landing URLs are authoritative, then the saved cookie, then the browser's Accept-Language,
// then English. Used both in hooks.server.ts (SSR) and the language toggle.
export function pickLocale(
  pathname: string,
  cookie: string | undefined | null,
  acceptLanguage: string | undefined | null
): Locale {
  const seg = pathname.split('/')[1];
  if (isLocale(seg)) return seg;
  if (isLocale(cookie)) return cookie;
  if (acceptLanguage) {
    for (const part of acceptLanguage.split(',')) {
      const base = part.trim().split(';')[0].toLowerCase().split('-')[0];
      if (isLocale(base)) return base;
    }
  }
  return DEFAULT_LOCALE;
}
