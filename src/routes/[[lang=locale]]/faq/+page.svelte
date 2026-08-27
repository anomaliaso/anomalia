<script lang="ts">
  import { _ } from 'svelte-i18n';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import AskAiCta from '$lib/components/AskAiCta.svelte';
  import { marketingStartHref } from '$lib/start-href';
  import '$lib/styles/landing.css';

  let { data } = $props();
  const waitlistActive = $derived(data.waitlistActive);
  const loggedIn = $derived(Boolean(data.session));
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));

  // Category questions buyers type into ChatGPT / Perplexity — not product-objection FAQ.
  const FAQ_KEYS = [
    'bestAiManager',
    'alternativesBuffer',
    'aiVsHuman',
    'howToChoose',
    'onBrandAutopilot',
    'costVsAgency',
    'agencies',
    'geoSeo'
  ] as const;

  const FAQ = $derived(
    FAQ_KEYS.map((key) => ({
      key,
      q: $_(`geoFaq.items.${key}.q`),
      a: $_(`geoFaq.items.${key}.a`)
    }))
  );

  const faqJsonLd = $derived(
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a }
      }))
    })
  );
</script>

<svelte:head>
  <title>{$_('meta.geoFaq.title')}</title>
  <meta name="description" content={$_('meta.geoFaq.description')} />
  <meta
    name="robots"
    content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
  />
  <meta property="og:title" content={$_('meta.geoFaq.title')} />
  <meta property="og:description" content={$_('meta.geoFaq.description')} />
  <meta name="twitter:title" content={$_('meta.geoFaq.title')} />
  <meta name="twitter:description" content={$_('meta.geoFaq.description')} />
  {@html `<script type="application/ld+json">${faqJsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">
  <section class="faq-hero">
    <div class="wrap">
      <span class="eyebrow">{$_('geoFaq.kicker')}</span>
      <h1>{$_('geoFaq.title')}</h1>
      <p class="lede">{$_('geoFaq.lede')}</p>
    </div>
  </section>

  <section class="alt faq-sec">
    <div class="wrap">
      <div class="faq">
        {#each FAQ as item (item.key)}
          <details class="faq-item">
            <summary>{item.q}<span class="chev" aria-hidden="true">+</span></summary>
            <p>{item.a}</p>
          </details>
        {/each}
      </div>
      <p class="faq-note">
        {$_('geoFaq.note')}
        <a href={loggedIn ? '/app' : '/pricing'}>{$_('geoFaq.noteCta')}</a>
      </p>
    </div>
  </section>

  <AskAiCta />
</main>

<SiteFooter />

<style>
  .faq-hero {
    padding: 116px 0 40px;
    text-align: center;
  }
  .faq-hero .eyebrow {
    display: inline-block;
    margin-bottom: 18px;
  }
  .faq-hero h1 {
    font-size: clamp(2.1rem, 5vw, 3.2rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    line-height: 1.05;
    max-width: 22ch;
    margin: 0 auto;
  }
  @media (min-width: 821px) {
    .faq-hero h1 {
      font-size: clamp(56px, 5vw, 64px);
    }
  }
  .faq-hero .lede {
    max-width: 54ch;
    margin: 18px auto 0;
    color: var(--ink-soft);
    font-size: 1.08rem;
    line-height: 1.55;
  }

  .faq-sec {
    padding: 40px 0 88px;
  }
  .faq {
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .faq-item {
    border: 1px solid var(--line, rgba(0, 0, 0, 0.1));
    border-radius: 16px;
    background: var(--paper, #fff);
    padding: 4px 20px;
    transition: border-color 0.2s var(--ease, ease);
  }
  .faq-item[open] {
    border-color: rgba(var(--accent-rgb, 124, 92, 255), 0.35);
  }
  .faq-item summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    cursor: pointer;
    list-style: none;
    padding: 16px 0;
    font-weight: 600;
    font-size: 1.02rem;
    color: var(--ink, #1d1d1f);
    text-align: left;
  }
  .faq-item summary::-webkit-details-marker {
    display: none;
  }
  .faq-item .chev {
    font-size: 1.4rem;
    line-height: 1;
    color: var(--ink-soft, #6e6e73);
    transition: transform 0.2s var(--ease, ease);
    flex: none;
  }
  .faq-item[open] .chev {
    transform: rotate(45deg);
  }
  .faq-item p {
    margin: 0 0 18px;
    color: var(--ink-soft, #6e6e73);
    line-height: 1.55;
  }
  .faq-note {
    max-width: 720px;
    margin: 28px auto 0;
    text-align: center;
    color: var(--ink-soft);
    font-size: 0.95rem;
    line-height: 1.5;
  }
  .faq-note a {
    color: var(--ink);
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
