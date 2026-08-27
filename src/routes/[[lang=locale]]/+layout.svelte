<script lang="ts">
  import { page } from '$app/stores';
  import { SUPPORTED, localePath, type Locale } from '$lib/i18n/locale';

  let { children } = $props();

  const localeRe = new RegExp(`^\\/(${SUPPORTED.join('|')})(?=/|$)`);

  // Canonical (English) path with any locale prefix stripped: '/it/pricing' → '/pricing'.
  const basePath = $derived($page.url.pathname.replace(localeRe, '') || '/');
  const origin = $derived($page.url.origin);
  const lang = $derived(($page.params.lang ?? 'en') as Locale);
  const canonical = $derived(origin + localePath(basePath, lang));

  const altUrls = $derived(
    SUPPORTED.map((l) => ({
      lang: l,
      href: origin + localePath(basePath, l)
    }))
  );
  const enUrl = $derived(origin + localePath(basePath, 'en'));

  // Per-locale social card + OG locale codes.
  const ogLocales: Record<Locale, string> = {
    en: 'en_US',
    it: 'it_IT',
    es: 'es_ES',
    fr: 'fr_FR'
  };
  const ogImages: Record<Locale, string> = {
    en: '/og.png',
    it: '/og-it.png',
    es: '/og-es.png',
    fr: '/og-fr.png'
  };
  const ogAlts: Record<Locale, string> = {
    en: 'Anomalia — An AI that runs your social media',
    it: 'Anomalia — Un’AI che gestisce i tuoi social',
    es: 'Anomalia — Una IA que gestiona tus redes sociales',
    fr: 'Anomalia — Une IA qui gère vos réseaux sociaux'
  };
  const ogImage = $derived(origin + (ogImages[lang] ?? '/og.png'));
  const ogAlt = $derived(ogAlts[lang] ?? ogAlts.en);
  const ogLocale = $derived(ogLocales[lang] ?? 'en_US');
  const ogLocaleAlts = $derived(SUPPORTED.filter((l) => l !== lang).map((l) => ogLocales[l]));
</script>

<svelte:head>
  <link rel="canonical" href={canonical} />
  {#each altUrls as alt (alt.lang)}
    <link rel="alternate" hreflang={alt.lang} href={alt.href} />
  {/each}
  <link rel="alternate" hreflang="x-default" href={enUrl} />

  <!-- Open Graph (page-specific og:title/og:description + robots are set per page) -->
  <meta property="og:site_name" content="Anomalia" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={canonical} />
  <meta property="og:locale" content={ogLocale} />
  {#each ogLocaleAlts as alt (alt)}
    <meta property="og:locale:alternate" content={alt} />
  {/each}
  <meta property="og:image" content={ogImage} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content={ogAlt} />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content={ogImage} />
</svelte:head>

{@render children()}
