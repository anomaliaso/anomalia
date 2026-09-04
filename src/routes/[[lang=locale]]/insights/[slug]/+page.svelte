<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { localePath } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import MarcoWidget from '$lib/components/MarcoWidget.svelte';
  import { insightLocales, type InsightArticle } from '$lib/data/insights';
  import { marketingStartHref } from '$lib/start-href';
  import '$lib/styles/landing.css';

  let { data } = $props();

  const article = $derived(data.article as InsightArticle);
  const lang = $derived((($locale as 'en' | 'it') ?? 'en') as 'en' | 'it');
  const lp = $derived((p: string) => localePath(p, lang));
  const copy = $derived(insightLocales(article, lang));
  const waitlistActive = $derived(data.waitlistActive);
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const loggedIn = $derived(Boolean(data.session));
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));

  const pageTitle = $derived(`${copy.title} · Anomalia`);
  const origin = $derived($page.url.origin);

  const jsonLd = $derived(
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: copy.title,
      description: copy.description,
      datePublished: article.publishedAt,
      dateModified: article.publishedAt,
      inLanguage: lang === 'it' ? 'it-IT' : 'en-US',
      author: { '@type': 'Organization', name: 'Anomalia', url: origin },
      publisher: {
        '@type': 'Organization',
        name: 'Anomalia',
        url: origin,
        logo: { '@type': 'ImageObject', url: `${origin}/icon-512.png` }
      },
      image: copy.cover ? `${origin}${copy.cover.src}` : undefined,
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': `${origin}${lang === 'it' ? '/it' : ''}/insights/${article.slug}`
      }
    })
  );

  function formatDate(iso: string) {
    return new Date(iso + 'T00:00:00').toLocaleDateString(lang === 'it' ? 'it-IT' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  const RELATED_LABELS: Record<string, { en: string; it: string }> = {
    '/': { en: 'Anomalia homepage', it: 'Homepage Anomalia' },
    '/pricing': { en: 'Pricing', it: 'Prezzi' },
    '/usecases': { en: 'Use cases', it: 'Casi d’uso' },
    '/autoposts': { en: 'Autoposts', it: 'Autoposts' },
    '/ai-seo-agent': { en: 'AI SEO Agent', it: 'AI SEO Agent' },
    '/autoblog': { en: 'Autoblog', it: 'Autoblog' },
    '/cant-afford': { en: 'When you can’t afford an agency', it: 'Quando non puoi permetterti un’agenzia' },
    '/docs/geo-audit': { en: 'GEO Audit docs', it: 'Docs GEO Audit' }
  };
</script>

<svelte:head>
  <title>{pageTitle}</title>
  <meta name="description" content={copy.description} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <meta property="og:title" content={pageTitle} />
  <meta property="og:description" content={copy.description} />
  <meta property="og:type" content="article" />
  {#if copy.cover}
    <meta property="og:image" content={`${origin}${copy.cover.src}`} />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content={`${origin}${copy.cover.src}`} />
  {/if}
  <meta property="article:published_time" content={article.publishedAt} />
  <meta name="twitter:title" content={pageTitle} />
  <meta name="twitter:description" content={copy.description} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} current="insights" />

<main id="top" class="insa-page">
  <article class="insa-article">
    <header class="insa-hero">
      <div class="wrap insa-hero-inner">
        <nav class="insa-crumb" aria-label="Breadcrumb">
          <a href={lp('/insights')}>Insights</a>
          <span aria-hidden="true">›</span>
          <span>{copy.category}</span>
        </nav>
        <p class="insa-meta">
          <span>{copy.category}</span>
          <span aria-hidden="true">·</span>
          <time datetime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
          <span aria-hidden="true">·</span>
          <span>{article.readingMinutes} {lang === 'it' ? 'min di lettura' : 'min read'}</span>
        </p>
        <h1 class="insa-h1">{copy.title}</h1>
        <p class="insa-deck">{copy.excerpt}</p>
      </div>
    </header>

    <div class="wrap insa-body">
      {#each copy.sections as section}
        <section class="insa-section">
          <h2>{section.heading}</h2>
          {#each section.paragraphs as p}
            <p>{p}</p>
          {/each}
          {#if section.bullets?.length}
            <ul>
              {#each section.bullets as b}
                <li>{b}</li>
              {/each}
            </ul>
          {/if}
          {#if section.image}
            <figure class="insa-figure">
              <img
                src={section.image.src}
                alt={section.image.alt}
                width={section.image.width ?? 1376}
                height={section.image.height ?? 768}
                loading="lazy"
              />
            </figure>
          {/if}
        </section>
      {/each}

      {#if article.relatedPaths.length}
        <aside class="insa-related">
          <h2>{lang === 'it' ? 'Continua su Anomalia' : 'Keep exploring'}</h2>
          <ul>
            {#each article.relatedPaths as path}
              <li>
                <a href={lp(path)}>
                  {RELATED_LABELS[path]?.[lang] ?? path}
                </a>
              </li>
            {/each}
          </ul>
        </aside>
      {/if}

      <div class="insa-cta">
        <h2>{lang === 'it' ? 'Metti i social in autopilot.' : 'Put your social on autopilot.'}</h2>
        <p>
          {lang === 'it'
            ? 'Anomalia pianifica, scrive e pubblica. Tu approvi.'
            : 'Anomalia plans, writes and publishes. You approve.'}
        </p>
        <div class="insa-cta-row">
          <a class="btn-primary" href={startHref}>{cta}</a>
          <a class="btn-ghost" href={lp('/insights')}>{lang === 'it' ? 'Altri insights' : 'More insights'}</a>
        </div>
      </div>
    </div>
  </article>
</main>

<SiteFooter ctaHref={startHref} />
<MarcoWidget />

<style>
  .insa-page {
    padding-top: 72px;
  }
  .insa-hero {
    padding: 48px 0 40px;
    background:
      radial-gradient(ellipse 70% 50% at 80% 0%, rgba(var(--accent-rgb), 0.1), transparent 50%),
      linear-gradient(180deg, var(--paper), color-mix(in srgb, var(--paper) 90%, #e8e4dc));
  }
  .insa-crumb {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 0.875rem;
    color: color-mix(in srgb, var(--ink) 55%, transparent);
    margin-bottom: 20px;
    letter-spacing: -0.02em;
  }
  .insa-crumb a:hover {
    color: var(--ink);
  }
  .insa-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 0.8125rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: color-mix(in srgb, var(--ink) 55%, transparent);
    margin-bottom: 14px;
  }
  .insa-h1 {
    font-size: clamp(2rem, 4.5vw, 3.25rem);
    letter-spacing: -0.04em;
    line-height: 1.08;
    max-width: 18ch;
    margin-bottom: 18px;
  }
  .insa-deck {
    max-width: 36rem;
    font-size: 1.125rem;
    line-height: 1.45;
    letter-spacing: -0.02em;
    color: color-mix(in srgb, var(--ink) 72%, transparent);
  }
  .insa-body {
    max-width: 720px;
    padding-top: 40px;
    padding-bottom: 96px;
  }
  .insa-section {
    margin-bottom: 36px;
  }
  .insa-section h2 {
    font-size: 1.5rem;
    letter-spacing: -0.03em;
    margin-bottom: 14px;
  }
  .insa-section p {
    font-size: 1.0625rem;
    line-height: 1.65;
    letter-spacing: -0.02em;
    color: color-mix(in srgb, var(--ink) 88%, transparent);
    margin-bottom: 14px;
  }
  .insa-section ul {
    margin: 8px 0 16px;
    padding-left: 1.25rem;
  }
  .insa-section li {
    font-size: 1.0625rem;
    line-height: 1.55;
    letter-spacing: -0.02em;
    margin-bottom: 8px;
  }
  .insa-figure {
    margin: 8px 0 4px;
    border-radius: 14px;
    overflow: hidden;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .insa-figure img {
    display: block;
    width: 100%;
    height: auto;
  }
  .insa-related {
    margin: 48px 0;
    padding-top: 28px;
    border-top: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
  }
  .insa-related h2 {
    font-size: 1.25rem;
    margin-bottom: 12px;
  }
  .insa-related ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .insa-related a {
    color: color-mix(in srgb, var(--ink) 75%, transparent);
    letter-spacing: -0.02em;
  }
  .insa-related a:hover {
    color: var(--ink);
  }
  .insa-cta {
    margin-top: 56px;
    padding: 36px 0 0;
    border-top: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
  }
  .insa-cta h2 {
    font-size: 1.75rem;
    letter-spacing: -0.035em;
    margin-bottom: 8px;
  }
  .insa-cta p {
    color: color-mix(in srgb, var(--ink) 70%, transparent);
    margin-bottom: 20px;
    letter-spacing: -0.02em;
  }
  .insa-cta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .btn-primary,
  .btn-ghost {
    display: inline-flex;
    align-items: center;
    padding: 12px 20px;
    border-radius: 999px;
    font-size: 0.9375rem;
    font-weight: 550;
    letter-spacing: -0.02em;
  }
  .btn-primary {
    background: var(--ink);
    color: var(--paper);
  }
  .btn-ghost {
    border: 1px solid color-mix(in srgb, var(--ink) 18%, transparent);
  }
</style>
