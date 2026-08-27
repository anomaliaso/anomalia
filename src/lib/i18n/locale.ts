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

/**
 * Notices, job reports and rate-limit copy that only ship English/Italian.
 * Anything that is not Italian — empty, `en-IN`, Hindi-only, Spanish, `*` — is English.
 * Never the other way around: missing `en` in Accept-Language used to collapse to Italian.
 */
export function bilingualNoticeLocale(locale: string | undefined | null): 'en' | 'it' {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('it') ? 'it' : 'en';
}

/**
 * How the chatbot picks the language of a reply. Same rule as Radar comments: the text the
 * person just wrote wins. Dashboard locale is only a fallback when there is nothing to detect
 * (empty, a URL, a chip with no sentence). Brand caption language and Italian prompt examples
 * must not drag an English message into Italian — production amazon.in, 27/8/2026.
 */
export function chatReplyLanguageBlock(uiLocale: string | undefined | null): string {
  const lang = localeLanguageName(uiLocale);
  return `REPLY LANGUAGE — ABSOLUTE RULE: write every user-facing message in the language of the user's latest message (detect it from the text they just sent). The dashboard locale (${lang}), the brand's caption language, the brand timezone, the language of these instructions, and any style or voice material are IRRELEVANT when the user wrote in a clear language: an English message gets an English reply even if this dashboard is Italian or a background job summary was Italian, and vice versa. Dashboard locale (${lang}) is only a fallback when the message is empty, a URL, a chip/command with no sentence, or otherwise has no detectable language. Style instructions shape style, never language.`;
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
