<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import WallTile from '$lib/components/WallTile.svelte';
  import { WALL_REMOVAL_EMAIL } from '$lib/links';
  import { marketingStartHref } from '$lib/start-href';
  import { DESIGN_AXES } from '$lib/wall';
  import type { PageData } from './$types';
  import '$lib/styles/landing.css';

  let { data }: { data: PageData } = $props();

  const lang = $derived((($locale as Locale) ?? 'en') as Locale);
  const lp = $derived((p: string) => localePath(p, lang));
  const waitlistActive = $derived(data.waitlistActive);
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const startHref = $derived(marketingStartHref({ loggedIn: Boolean(data.session), waitlistActive }));

  const card = $derived(data.card);
  const siteUrl = $derived($page.url.origin);
  const canonical = $derived(`${siteUrl}${lp(`/design/${card.slug}`)}`);

  const title = $derived(
    `${card.account ?? card.platform} — ${$_('wall.design.h1')} · Anomalia`
  );
  const description = $derived(card.note ?? card.caption ?? $_('meta.wallDesign.description'));

  const published = $derived(
    card.publishedAt ? new Date(card.publishedAt).toLocaleDateString(lang, { dateStyle: 'medium' }) : null
  );

  /**
   * `ImageObject` rather than `CreativeWork`, and `creditText`/`author` filled from the handle: the
   * structured data has to say out loud that the work is somebody else's, exactly like the visible
   * credit line does.
   */
  const jsonLd = $derived(
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'ImageObject',
      '@id': canonical,
      url: canonical,
      contentUrl: card.posterUrl,
      thumbnailUrl: card.posterUrl,
      name: card.caption ?? card.account ?? card.platform,
      description,
      ...(card.account ? { author: { '@type': 'Person', name: card.account }, creditText: card.account } : {}),
      ...(card.publishedAt ? { datePublished: card.publishedAt } : {}),
      isBasedOn: card.sourceUrl,
      inLanguage: lang
    })
  );
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <!-- The card is our editorial page about someone else's post; the post itself lives at sourceUrl. -->
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <link rel="canonical" href={canonical} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:type" content="article" />
  <meta property="og:url" content={canonical} />
  <meta property="og:image" content={card.posterUrl} />
  <meta name="twitter:card" content="summary_large_image" />
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">
  <article class="wd">
    <div class="wrap wd-wrap">
      <div class="wd-media">
        {#if card.previewUrl}
          <!-- The animation is the point of the detail page, so here it loads immediately — one
               image on one page, rather than 36 on a grid. -->
          <img class="wd-img" src={card.previewUrl} alt={card.caption ?? card.account ?? card.platform} />
        {:else}
          <img class="wd-img" src={card.posterUrl} alt={card.caption ?? card.account ?? card.platform} />
        {/if}
      </div>

      <div class="wd-side">
        <p class="wd-back"><a href={lp('/design')}>← {$_('wall.detail.back')}</a></p>

        <h1 class="wd-h1">{card.account ?? card.platform}</h1>

        {#if card.note}
          <section class="wd-block">
            <h2>{$_('wall.detail.why')}</h2>
            <p class="wd-note">{card.note}</p>
          </section>
        {/if}

        {#if card.designScores}
          <section class="wd-block">
            <h2>{$_('wall.detail.breakdown')}</h2>
            <dl class="wd-axes">
              {#each DESIGN_AXES as axis}
                {@const value = card.designScores[axis]}
                {#if value != null}
                  <div class="wd-axis">
                    <dt>{$_(`wall.axes.${axis}`)}</dt>
                    <dd>
                      <span class="wd-bar"><span class="wd-bar-fill" style:width={`${value * 10}%`}></span></span>
                      <span class="wd-axis-n">{value}</span>
                    </dd>
                  </div>
                {/if}
              {/each}
            </dl>
            {#if card.designScore != null}
              <p class="wd-total">{$_('wall.card.score', { values: { score: Math.round(card.designScore) } })}</p>
            {/if}
          </section>
        {/if}

        {#if card.tags.length}
          <section class="wd-block">
            <h2>{$_('wall.detail.style')}</h2>
            <p class="wd-tags">
              {#each card.tags as tag}
                <a class="wd-tag" href={`${lp('/design')}?tag=${tag}`}>{$_(`wall.tags.${tag}`)}</a>
              {/each}
            </p>
          </section>
        {/if}

        <section class="wd-block">
          <h2>{$_('wall.detail.meta')}</h2>
          <dl class="wd-meta">
            <div><dt>{$_('wall.detail.platform')}</dt><dd>{card.platform}</dd></div>
            {#if published}
              <div><dt>{$_('wall.detail.published')}</dt><dd>{published}</dd></div>
            {/if}
            {#if card.outperformance}
              <div>
                <dt>{$_('wall.trending.h1')}</dt>
                <dd>{$_('wall.trending.metric', { values: { value: card.outperformance.toFixed(1) } })}</dd>
              </div>
            {/if}
          </dl>
        </section>

        <p class="wd-cta">
          <a class="wd-original" href={card.sourceUrl} target="_blank" rel="noopener nofollow ugc">
            {$_('wall.detail.original')}
          </a>
        </p>

        {#if card.caption}
          <p class="wd-caption">{card.caption}</p>
        {/if}

        <p class="wd-credit">
          {$_('wall.detail.credit', {
            values: { account: card.account ?? '—', platform: card.platform }
          })}
        </p>
        <p class="wd-removal">{$_('wall.removal', { values: { email: WALL_REMOVAL_EMAIL } })}</p>
      </div>
    </div>

    {#if data.related.length}
      <div class="wrap wd-related">
        <h2>{$_('wall.design.h1')}</h2>
        <div class="wd-related-grid">
          {#each data.related as related (related.slug)}
            <WallTile card={related} />
          {/each}
        </div>
      </div>
    {/if}
  </article>
</main>

<SiteFooter ctaLabel={cta} ctaHref={startHref} />

<style>
  .wd {
    padding: 5.5rem 0 4rem;
  }
  .wd-wrap {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    gap: 2.4rem;
    align-items: start;
  }
  @media (max-width: 900px) {
    .wd-wrap {
      grid-template-columns: 1fr;
    }
  }
  .wd-media {
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.1);
    line-height: 0;
  }
  .wd-img {
    display: block;
    width: 100%;
    height: auto;
  }
  .wd-back {
    margin: 0 0 1rem;
    font-size: 0.84rem;
  }
  .wd-back a {
    color: inherit;
    opacity: 0.6;
    text-decoration: none;
  }
  .wd-h1 {
    font-size: clamp(1.7rem, 3.4vw, 2.4rem);
    letter-spacing: -0.02em;
    margin: 0 0 1.4rem;
  }
  .wd-block {
    margin-bottom: 1.6rem;
  }
  .wd-block h2 {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    opacity: 0.45;
    margin: 0 0 0.5rem;
  }
  .wd-note {
    margin: 0;
    font-size: 1.02rem;
    line-height: 1.55;
  }
  .wd-axes {
    margin: 0;
    display: grid;
    gap: 0.4rem;
  }
  .wd-axis {
    display: grid;
    grid-template-columns: 8.5rem 1fr;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.82rem;
  }
  .wd-axis dt {
    opacity: 0.6;
  }
  .wd-axis dd {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .wd-bar {
    display: block;
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }
  .wd-bar-fill {
    display: block;
    height: 100%;
    background: currentColor;
  }
  .wd-axis-n {
    font-variant-numeric: tabular-nums;
    opacity: 0.55;
    min-width: 1.4rem;
    text-align: right;
  }
  .wd-total {
    margin: 0.6rem 0 0;
    font-size: 0.82rem;
    opacity: 0.55;
    font-variant-numeric: tabular-nums;
  }
  .wd-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: 0;
  }
  .wd-tag {
    padding: 0.24rem 0.6rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    font-size: 0.75rem;
    text-decoration: none;
    color: inherit;
    opacity: 0.75;
  }
  .wd-meta {
    margin: 0;
    display: grid;
    gap: 0.3rem;
    font-size: 0.84rem;
  }
  .wd-meta > div {
    display: grid;
    grid-template-columns: 8.5rem 1fr;
    gap: 0.6rem;
  }
  .wd-meta dt {
    opacity: 0.5;
    text-transform: capitalize;
  }
  .wd-meta dd {
    margin: 0;
    text-transform: capitalize;
  }
  .wd-cta {
    margin: 1.8rem 0 1rem;
  }
  .wd-original {
    display: inline-block;
    padding: 0.7rem 1.3rem;
    border-radius: 999px;
    border: 1px solid currentColor;
    text-decoration: none;
    color: inherit;
    font-size: 0.88rem;
  }
  .wd-caption {
    font-size: 0.88rem;
    line-height: 1.55;
    opacity: 0.6;
    margin: 0 0 1rem;
  }
  .wd-credit,
  .wd-removal {
    font-size: 0.75rem;
    line-height: 1.5;
    opacity: 0.4;
    margin: 0 0 0.4rem;
  }
  .wd-related {
    margin-top: 4rem;
  }
  .wd-related h2 {
    font-size: 1.1rem;
    margin: 0 0 1.2rem;
  }
  .wd-related-grid {
    column-count: 3;
    column-gap: 1.15rem;
  }
  @media (max-width: 760px) {
    .wd-related-grid {
      column-count: 2;
    }
  }
</style>
