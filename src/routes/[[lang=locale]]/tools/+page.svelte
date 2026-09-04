<script lang="ts">
  // Hub for every free tool. The pages existed before this but nothing linked them together,
  // so each one was an orphan that only search could find.
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import '$lib/styles/landing.css';

  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  // slug → i18n namespace. Tools built before ToolPage keep their own key layout, but every one
  // of them has meta.title / meta.description, which is all this listing needs.
  const GROUPS: Array<{ key: string; tools: string[] }> = [
    { key: 'seo', tools: ['keyword-research'] },
    { key: 'ai', tools: ['agent-team', 'geo-audit', 'llms-txt-generator', 'llms-txt-validator'] },
    { key: 'technical', tools: ['sitemap-analyzer'] },
    { key: 'social', tools: ['caption-length', 'best-time-to-post', 'social-media-roi'] }
  ];

  // Tool titles carry the " | Anomalia" suffix for SEO; strip it for the card.
  const cardTitle = (slug: string) => $_(`tools.${slug}.meta.title`).split('|')[0].trim();
</script>

<svelte:head>
  <title>{$_('tools.index.meta.title')}</title>
  <meta name="description" content={$_('tools.index.meta.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <meta property="og:title" content={$_('tools.index.meta.title')} />
  <meta property="og:description" content={$_('tools.index.meta.description')} />
  {@html `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: $_('tools.index.meta.title'),
    url: `${$page.url.origin}${lp('/tools')}`,
    description: $_('tools.index.meta.description'),
    hasPart: GROUPS.flatMap((g) =>
      g.tools.map((slug) => ({
        '@type': 'WebApplication',
        name: cardTitle(slug),
        url: `${$page.url.origin}${lp(`/tools/${slug}`)}`,
        applicationCategory: 'BusinessApplication',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' }
      }))
    )
  })}</script>`}
</svelte:head>

<SiteNav cta={$_('tools.common.navCta')} />

<main>
  <section class="hero">
    <div class="wrap">
      <span class="eyebrow">{$_('tools.common.eyebrow')}</span>
      <h1>{$_('tools.index.hero.title')}</h1>
      <p class="subhead">{$_('tools.index.hero.subhead')}</p>
    </div>
  </section>

  <section class="listing">
    <div class="wrap">
      {#each GROUPS as group (group.key)}
        <h2>{$_(`tools.index.groups.${group.key}`)}</h2>
        <div class="grid">
          {#each group.tools as slug (slug)}
            <a class="card" href={lp(`/tools/${slug}`)}>
              <strong>{cardTitle(slug)}</strong>
              <span>{$_(`tools.${slug}.meta.description`)}</span>
            </a>
          {/each}
        </div>
      {/each}
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .hero { padding: 56px 0 12px; }
  .wrap { max-width: 940px; margin: 0 auto; padding: 0 20px; }
  .eyebrow {
    display: inline-block; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--ink-soft); margin-bottom: 12px;
  }
  h1 { font-size: clamp(1.8rem, 4vw, 2.6rem); margin: 0 0 12px; letter-spacing: -0.03em; }
  .subhead { color: var(--ink-soft); font-size: 1.05rem; line-height: 1.5; margin: 0; }
  .listing { padding: 24px 0 80px; }
  h2 { font-size: 1.05rem; margin: 34px 0 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .card {
    display: flex; flex-direction: column; gap: 6px; text-decoration: none; color: inherit;
    background: var(--paper); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px;
    transition: border-color 0.15s ease, transform 0.15s ease;
  }
  .card:hover { border-color: var(--ink-faint); transform: translateY(-1px); }
  .card strong { font-size: 0.98rem; font-weight: 600; }
  .card span { font-size: 0.85rem; color: var(--ink-soft); line-height: 1.45; }
</style>
