/**
 * Blog locale constants — the language set a hosted blog can publish in.
 *
 * Client-safe on purpose: the blog settings form renders these lists, and anything under
 * $lib/server cannot be imported from a component. The plan-aware resolver that turns a
 * brand's blog_config into an effective locale set lives in $lib/server/blog-locales.ts.
 *
 * Kept separate from $lib/i18n/locale.ts on purpose: that module is the APP UI's language set (4
 * locales, tied to shipped translation catalogs). A brand may blog in any language regardless of
 * which languages our dashboard speaks, so the two lists must not be conflated — but the URL segment
 * still needs a bounded, validated set, because a param matcher runs before any DB lookup and must
 * not swallow real paths like /category or /search as if they were languages.
 */
/**
 * Locales a blog may be published in. ISO 639-1, deliberately a fixed list rather than "any
 * two-letter string": the matcher below decides whether /it/... is a language or a slug, so an open
 * set would shadow every top-level article whose slug happens to be two characters.
 */
export const BLOG_LOCALES = [
  'en', 'it', 'es', 'fr', 'de', 'pt', 'nl', 'pl', 'sv', 'da', 'no', 'fi',
  'cs', 'ro', 'el', 'hu', 'tr', 'ru', 'uk', 'ar', 'he', 'hi', 'id', 'ja', 'ko', 'zh'
] as const;

export type BlogLocale = (typeof BLOG_LOCALES)[number];

export function isBlogLocale(v: string | null | undefined): v is BlogLocale {
  return !!v && (BLOG_LOCALES as readonly string[]).includes(v);
}

/** English language name for a locale — what the article generator is prompted with. */
export const BLOG_LOCALE_LANGUAGE: Record<BlogLocale, string> = {
  en: 'English', it: 'Italian', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese',
  nl: 'Dutch', pl: 'Polish', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish',
  cs: 'Czech', ro: 'Romanian', el: 'Greek', hu: 'Hungarian', tr: 'Turkish', ru: 'Russian',
  uk: 'Ukrainian', ar: 'Arabic', he: 'Hebrew', hi: 'Hindi', id: 'Indonesian', ja: 'Japanese',
  ko: 'Korean', zh: 'Chinese'
};

/** Native label for the language switcher — a reader looking for their language reads it natively. */
export const BLOG_LOCALE_NATIVE: Record<BlogLocale, string> = {
  en: 'English', it: 'Italiano', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português',
  nl: 'Nederlands', pl: 'Polski', sv: 'Svenska', da: 'Dansk', no: 'Norsk', fi: 'Suomi',
  cs: 'Čeština', ro: 'Română', el: 'Ελληνικά', hu: 'Magyar', tr: 'Türkçe', ru: 'Русский',
  uk: 'Українська', ar: 'العربية', he: 'עברית', hi: 'हिन्दी', id: 'Bahasa Indonesia',
  ja: '日本語', ko: '한국어', zh: '中文'
};

/** Map an English language name (how brand_articles.language is stored) back to a locale code. */
export function localeFromLanguageName(name: string | null | undefined): BlogLocale | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  for (const [code, label] of Object.entries(BLOG_LOCALE_LANGUAGE)) {
    if (label.toLowerCase() === n) return code as BlogLocale;
  }
  return isBlogLocale(n) ? (n as BlogLocale) : null;
}
