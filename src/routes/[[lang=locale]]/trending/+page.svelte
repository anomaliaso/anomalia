<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import WallTile from '$lib/components/WallTile.svelte';
  import { WALL_REMOVAL_EMAIL } from '$lib/links';
  import { marketingStartHref } from '$lib/start-href';
  import { WALL_PLATFORMS } from '$lib/wall';
  import type { PageData } from './$types';
  import '$lib/styles/landing.css';

  let { data }: { data: PageData } = $props();

  const lang = $derived((($locale as Locale) ?? 'en') as Locale);
  const lp = $derived((p: string) => localePath(p, lang));
  const waitlistActive = $derived(data.waitlistActive);
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const startHref = $derived(marketingStartHref({ loggedIn: Boolean(data.session), waitlistActive }));

  const siteUrl = $derived($page.url.origin);
  const canonical = $derived(`${siteUrl}${lp('/trending')}`);

  function hrefFor(next: { platform?: string | null; page?: number }) {
    const params = new URLSearchParams();
    const platform = next.platform === undefined ? data.platform : next.platform;
    const n = next.page ?? 1;
    if (platform) params.set('platform', platform);
    if (n > 1) params.set('page', String(n));
    const qs = params.toString();
    return lp('/trending') + (qs ? `?${qs}` : '');
  }

  const jsonLd = $derived(
    JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'CollectionPage',
          '@id': canonical,
          url: canonical,
          name: $_('meta.wallTrending.title'),
          description: $_('meta.wallTrending.description'),
          inLanguage: lang,
          isPartOf: { '@type': 'WebSite', url: `${siteUrl}/`, name: 'Anomalia' }
        },
        {
          '@type': 'ItemList',
          itemListOrder: 'https://schema.org/ItemListOrderDescending',
          numberOfItems: data.cards.length,
          itemListElement: data.cards.map((card, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: `${siteUrl}${lp(`/design/${card.slug}`)}`,
            name: card.account ?? card.platform
          }))
        }
      ]
    })
  );
</script>

<svelte:head>
  <title>{$_('meta.wallTrending.title')}</title>
  <meta name="description" content={$_('meta.wallTrending.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <link rel="canonical" href={canonical} />
  <meta property="og:title" content={$_('meta.wallTrending.title')} />
  <meta property="og:description" content={$_('meta.wallTrending.description')} />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={canonical} />
  {#if data.cards[0]}
    <meta property="og:image" content={data.cards[0].posterUrl} />
    <link rel="preload" as="image" href={data.cards[0].posterUrl} fetchpriority="high" />
  {/if}
  {#if data.page > 1}
    <link rel="prev" href={hrefFor({ page: data.page - 1 })} />
  {/if}
  {#if data.hasMore}
    <link rel="next" href={hrefFor({ page: data.page + 1 })} />
  {/if}
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">
  <section class="wall-hero">
    <div class="wrap">
      <span class="eyebrow">{$_('wall.trending.eyebrow')}</span>
      <h1 class="wall-h1">{$_('wall.trending.h1')}</h1>
      <p class="wall-sub">{$_('wall.trending.sub')}</p>
      <p class="wall-crosslink">
        <a href={lp('/design')}>{$_('wall.nav.design')} →</a>
      </p>
    </div>
  </section>

  <section class="wall-filters">
    <div class="wrap">
      <nav class="wall-chips" aria-label={$_('wall.filters.platform')}>
        <a class="wall-chip" class:is-on={!data.platform} href={hrefFor({ platform: null })}>
          {$_('wall.filters.all')}
        </a>
        {#each WALL_PLATFORMS as p}
          <a class="wall-chip" class:is-on={data.platform === p} href={hrefFor({ platform: p })}>
            {p}
          </a>
        {/each}
      </nav>
    </div>
  </section>

  <section class="wall-body">
    <div class="wrap">
      {#if data.cards.length}
        <div class="wall-grid">
          {#each data.cards as card, i (card.slug)}
            <WallTile {card} showMetric eager={i < 4} />
          {/each}
        </div>

        {#if data.hasMore || data.page > 1}
          <nav class="wall-pager">
            {#if data.page > 1}
              <a class="wall-page-link" href={hrefFor({ page: data.page - 1 })} rel="prev">←</a>
            {/if}
            {#if data.hasMore}
              <a class="wall-page-link" href={hrefFor({ page: data.page + 1 })} rel="next">{$_('wall.more')}</a>
            {/if}
          </nav>
        {/if}
      {:else}
        <p class="wall-empty">{$_('wall.trending.empty')}</p>
      {/if}
    </div>
  </section>

  <section class="wall-about">
    <div class="wrap">
      <h2>{$_('wall.howItWorks.title')}</h2>
      <p>{$_('wall.howItWorks.body')}</p>
      <p class="wall-about-cta"><a href={startHref}>{$_('wall.howItWorks.cta')}</a></p>
      <p class="wall-removal">{$_('wall.removal', { values: { email: WALL_REMOVAL_EMAIL } })}</p>
    </div>
  </section>
</main>

<SiteFooter ctaLabel={cta} ctaHref={startHref} />

<style>
  .wall-hero {
    padding: 6rem 0 2rem;
  }
  .wall-h1 {
    font-size: clamp(2.4rem, 6vw, 4rem);
    line-height: 1.05;
    margin: 0.6rem 0 0.9rem;
    letter-spacing: -0.03em;
  }
  .wall-sub {
    max-width: 62ch;
    font-size: 1.02rem;
    line-height: 1.6;
    opacity: 0.68;
    margin: 0;
  }
  .wall-crosslink {
    margin: 1rem 0 0;
    font-size: 0.88rem;
  }
  .wall-crosslink a {
    color: inherit;
    opacity: 0.7;
  }
  .wall-filters {
    padding: 1.6rem 0 0.4rem;
  }
  .wall-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .wall-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.34rem 0.7rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    font-size: 0.78rem;
    text-decoration: none;
    color: inherit;
    opacity: 0.72;
    text-transform: capitalize;
  }
  .wall-chip:hover {
    opacity: 1;
    border-color: rgba(255, 255, 255, 0.3);
  }
  .wall-chip.is-on {
    opacity: 1;
    border-color: currentColor;
  }
  .wall-body {
    padding: 1.6rem 0 3rem;
  }
  .wall-grid {
    column-count: 4;
    column-gap: 1.15rem;
  }
  @media (max-width: 1100px) {
    .wall-grid {
      column-count: 3;
    }
  }
  @media (max-width: 760px) {
    .wall-grid {
      column-count: 2;
    }
  }
  @media (max-width: 460px) {
    .wall-grid {
      column-count: 1;
    }
  }
  .wall-pager {
    display: flex;
    gap: 0.6rem;
    justify-content: center;
    margin-top: 2.4rem;
  }
  .wall-page-link {
    padding: 0.6rem 1.2rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    text-decoration: none;
    color: inherit;
    font-size: 0.88rem;
  }
  .wall-empty {
    opacity: 0.6;
    padding: 3rem 0;
  }
  .wall-about {
    padding: 3rem 0 5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  .wall-about h2 {
    font-size: 1.3rem;
    margin: 0 0 0.7rem;
  }
  .wall-about p {
    max-width: 68ch;
    line-height: 1.65;
    opacity: 0.68;
    margin: 0 0 0.7rem;
  }
  .wall-removal {
    font-size: 0.82rem;
    opacity: 0.45;
  }
</style>
