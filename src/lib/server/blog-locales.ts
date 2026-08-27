/**
 * Plan-aware resolution of a brand's blog locales. Constants and pure helpers live in
 * $lib/blog-locales (client-safe, imported by the settings form); this half needs the plan tiers, so
 * it stays server-only.
 */
import { blogTranslationLanguages } from '$lib/server/plans';
import { BLOG_LOCALE_LANGUAGE, isBlogLocale, localeFromLanguageName, type BlogLocale } from '$lib/blog-locales';

export {
  BLOG_LOCALES,
  BLOG_LOCALE_LANGUAGE,
  BLOG_LOCALE_NATIVE,
  isBlogLocale,
  localeFromLanguageName,
  type BlogLocale
} from '$lib/blog-locales';

export type BlogLocaleConfig = {
  /** The locale the bare blog URL redirects to. Always present. */
  defaultLocale: BlogLocale;
  /** Extra locales, already trimmed to the plan's allowance. Never contains defaultLocale. */
  extraLocales: BlogLocale[];
  /** default + extras, in display order — what hreflang and the switcher iterate. */
  allLocales: BlogLocale[];
  /** How many extra locales the plan permits (0 below the top tier). */
  maxExtra: number;
};

/**
 * Resolve a brand's blog locales from blog_config, clamped to the plan.
 *
 * `fallbackLanguage` is the brand's content language (content_prefs.language, an English language
 * name) — used when the blog has never been configured, so an Italian brand's blog defaults to /it
 * rather than to /en.
 *
 * The plan clamp is applied on READ, not just on write: a brand that downgrades keeps its stored
 * config, and this makes the extra locales stop being served without destroying the setting (an
 * upgrade restores them).
 */
export function resolveBlogLocales(
  cfg: Record<string, unknown> | null | undefined,
  plan: string | null | undefined,
  fallbackLanguage?: string | null
): BlogLocaleConfig {
  const maxExtra = blogTranslationLanguages(plan);
  const stored = cfg?.defaultLocale;
  const defaultLocale: BlogLocale =
    (isBlogLocale(typeof stored === 'string' ? stored : null) ? (stored as BlogLocale) : null) ??
    localeFromLanguageName(fallbackLanguage) ??
    'en';

  const raw = Array.isArray(cfg?.locales) ? (cfg!.locales as unknown[]) : [];
  const extraLocales: BlogLocale[] = [];
  for (const v of raw) {
    // Capacity is checked BEFORE accepting, not after: checking after let maxExtra=0 (every tier
    // below the top one) through the first locale, handing out the paid perk for free.
    if (extraLocales.length >= maxExtra) break;
    const code = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (!isBlogLocale(code) || code === defaultLocale || extraLocales.includes(code)) continue;
    extraLocales.push(code);
  }

  return { defaultLocale, extraLocales, allLocales: [defaultLocale, ...extraLocales], maxExtra };
}
