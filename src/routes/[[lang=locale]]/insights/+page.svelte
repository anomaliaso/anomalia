<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import MarcoWidget from '$lib/components/MarcoWidget.svelte';
  import { INSIGHTS } from '$lib/data/insights';
  import { marketingStartHref } from '$lib/start-href';
  import '$lib/styles/landing.css';

  let { data } = $props();

  const lang = $derived((($locale as 'en' | 'it') ?? 'en') as 'en' | 'it');
  const lp = $derived((p: string) => localePath(p, lang));
  const waitlistActive = $derived(data.waitlistActive);
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const loggedIn = $derived(Boolean(data.session));
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));

  const pageTitle = $derived(
    lang === 'it'
      ? 'Insights — Guide su AI, social e GEO · Anomalia'
      : 'Insights — Guides on AI, social & GEO · Anomalia'
  );
  const pageDesc = $derived(
    lang === 'it'
      ? 'Articoli di Anomalia su autopilot AI per i social, GEO, SEO e growth organico per PMI e founder.'
      : 'Anomalia articles on AI social autopilot, GEO, SEO and organic growth for SMBs and founders.'
  );

  const jsonLd = $derived(
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: 'Anomalia Insights',
      description: pageDesc,
      url: `https://anomalia.so${lang === 'it' ? '/it' : ''}/insights`,
      publisher: {
        '@type': 'Organization',
        name: 'Anomalia',
        url: 'https://anomalia.so'
      }
    })
  );

  function formatDate(iso: string) {
    return new Date(iso + 'T00:00:00').toLocaleDateString(lang === 'it' ? 'it-IT' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
</script>

<svelte:head>
  <title>{pageTitle}</title>
  <meta name="description" content={pageDesc} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <meta property="og:title" content={pageTitle} />
  <meta property="og:description" content={pageDesc} />
  <meta property="og:type" content="website" />
  <meta name="twitter:title" content={pageTitle} />
  <meta name="twitter:description" content={pageDesc} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} current="insights" />

<main id="top" class="ins-page">
  <section class="ins-hero">
    <div class="wrap">
      <span class="eyebrow">{lang === 'it' ? 'Risorse' : 'Resources'}</span>
      <h1 class="ins-h1">Insights</h1>
      <p class="ins-sub">
        {lang === 'it'
          ? 'Guide pratiche su social autopilot, SEO, GEO e growth — scritte dal team Anomalia.'
          : 'Practical guides on social autopilot, SEO, GEO and growth — from the Anomalia team.'}
      </p>
    </div>
  </section>

  <section class="ins-list">
    <div class="wrap">
      <ul class="ins-cards">
        {#each INSIGHTS as article (article.slug)}
          <li>
            <a class="ins-card" href={lp(`/insights/${article.slug}`)}>
              {#if article.cover}
                <img
                  class="ins-card-cover"
                  src={article.cover.src}
                  alt={article.cover.alt[lang]}
                  width={article.cover.width ?? 1376}
                  height={article.cover.height ?? 768}
                  loading="lazy"
                />
              {/if}
              <div class="ins-card-meta">
                <span>{article.category[lang]}</span>
                <span aria-hidden="true">·</span>
                <time datetime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
                <span aria-hidden="true">·</span>
                <span
                  >{article.readingMinutes}
                  {lang === 'it' ? 'min' : 'min read'}</span
                >
              </div>
              <h2>{article.title[lang]}</h2>
              <p>{article.excerpt[lang]}</p>
              <span class="ins-card-cta">{lang === 'it' ? 'Leggi' : 'Read'} →</span>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </section>
</main>

<SiteFooter ctaHref={startHref} />
<MarcoWidget />

<style>
  .ins-page {
    padding-top: 88px;
    min-height: 70vh;
  }
  .ins-hero {
    padding: 64px 0 40px;
    background:
      radial-gradient(ellipse 80% 60% at 20% 0%, rgba(var(--accent-rgb), 0.12), transparent 55%),
      linear-gradient(180deg, var(--paper) 0%, color-mix(in srgb, var(--paper) 88%, #e8e4dc) 100%);
  }
  .ins-h1 {
    font-size: clamp(2.5rem, 5vw, 3.75rem);
    letter-spacing: -0.04em;
    line-height: 1.05;
    margin: 12px 0 16px;
  }
  .ins-sub {
    max-width: 36rem;
    font-size: 1.125rem;
    color: color-mix(in srgb, var(--ink) 72%, transparent);
    letter-spacing: -0.02em;
    line-height: 1.45;
  }
  .ins-list {
    padding: 24px 0 96px;
  }
  .ins-cards {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0;
    border-top: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
  }
  .ins-card {
    display: block;
    padding: 32px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
    transition: opacity 0.2s var(--ease);
  }
  .ins-card-cover {
    display: block;
    width: 100%;
    max-width: 40rem;
    height: auto;
    border-radius: 14px;
    margin-bottom: 18px;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .ins-card:hover {
    opacity: 0.78;
  }
  .ins-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 0.8125rem;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--ink) 55%, transparent);
    margin-bottom: 10px;
  }
  .ins-card h2 {
    font-size: clamp(1.35rem, 2.5vw, 1.75rem);
    letter-spacing: -0.03em;
    line-height: 1.2;
    margin-bottom: 10px;
  }
  .ins-card p {
    max-width: 40rem;
    color: color-mix(in srgb, var(--ink) 70%, transparent);
    letter-spacing: -0.02em;
    line-height: 1.5;
    margin-bottom: 14px;
  }
  .ins-card-cta {
    font-size: 0.9375rem;
    font-weight: 550;
    letter-spacing: -0.02em;
  }
</style>
