/** Settings URLs for knowledge + Search Console connectors. */

export function connectorsSettingsHref(brandSlug: string): string {
  return `/app/${brandSlug}/settings/connectors`;
}

export function searchConsoleSettingsHref(brandSlug: string): string {
  return `/app/${brandSlug}/settings/search-console`;
}
