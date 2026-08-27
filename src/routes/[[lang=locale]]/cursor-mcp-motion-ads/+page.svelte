<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import MarcoWidget from '$lib/components/MarcoWidget.svelte';
  import HeroUrlCta from '$lib/components/HeroUrlCta.svelte';
  import { HOW_GUIDE, howGuideCopy, type HowLocale } from '$lib/data/how-guide';
  import { marketingStartHref } from '$lib/start-href';
  import '$lib/styles/landing.css';

  let { data } = $props();

  const lang = $derived(((($locale as Locale) ?? 'en') === 'it' ? 'it' : 'en') as HowLocale);
  const lp = $derived((p: string) => localePath(p, lang));
  const copy = $derived(howGuideCopy(lang));
  const waitlistActive = $derived(data.waitlistActive);
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const loggedIn = $derived(Boolean(data.session));
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));

  const pageTitle = $derived(`${copy.metaTitle} · Anomalia`);
  const origin = $derived($page.url.origin);

  const jsonLd = $derived(
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: `${copy.title} ${copy.titleEm}`,
      description: copy.metaDescription,
      datePublished: HOW_GUIDE.publishedAt,
      inLanguage: lang === 'it' ? 'it-IT' : 'en-US',
      author: { '@type': 'Organization', name: 'Anomalia', url: origin },
      publisher: {
        '@type': 'Organization',
        name: 'Anomalia',
        url: origin,
        logo: { '@type': 'ImageObject', url: `${origin}/icon-512.png` }
      },
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': `${origin}${lang === 'it' ? '/it' : ''}/cursor-mcp-motion-ads`
      },
      step: copy.sections.map((s, i) => ({
        '@type': 'HowToStep',
        position: i + 1,
        name: s.heading,
        text: s.body.join(' ')
      }))
    })
  );

  function hrefFor(link: { href: string; external?: boolean }) {
    return link.external ? link.href : lp(link.href);
  }
</script>

<svelte:head>
  <title>{pageTitle}</title>
  <meta name="description" content={copy.metaDescription} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <meta property="og:title" content={pageTitle} />
  <meta property="og:description" content={copy.metaDescription} />
  <meta property="og:type" content="article" />
  <meta property="og:image" content={`${origin}/cursor-mcp/phone-agent.png`} />
  <meta property="article:published_time" content={HOW_GUIDE.publishedAt} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={pageTitle} />
  <meta name="twitter:description" content={copy.metaDescription} />
  <meta name="twitter:image" content={`${origin}/cursor-mcp/phone-agent.png`} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top" class="cm-page">
  <header class="cm-hero">
    <div class="wrap">
      <div class="cm-inner">
        <p class="cm-eyebrow">{copy.eyebrow}</p>
        <h1 class="cm-h1">
          {copy.title}<br />
          <span class="cm-em">{copy.titleEm}</span>
        </h1>
        <p class="cm-deck">{copy.deck}</p>
        <div class="cm-url">
          <HeroUrlCta {loggedIn} {waitlistActive} />
        </div>
      </div>
    </div>
  </header>

  {#each copy.sections as section (section.id)}
    <section class="cm-sec" class:cm-tone={section.id === 'ios' || section.id === 'ship'} id={section.id}>
      <div class="wrap">
        <div class="cm-inner">
          <p class="cm-kicker">{section.kicker}</p>
          <h2 class="cm-h2">{section.heading}</h2>
          {#each section.body as p}
            <p class="cm-p">{p}</p>
          {/each}
          {#if section.bullets?.length}
            <ul class="cm-list">
              {#each section.bullets as b}
                <li>{b}</li>
              {/each}
            </ul>
          {/if}
          {#if section.link}
            <a
              class="cm-link"
              href={hrefFor(section.link)}
              target={section.link.external ? '_blank' : undefined}
              rel={section.link.external ? 'noopener noreferrer' : undefined}
            >
              {section.link.label}
            </a>
          {/if}
        </div>
        {#if section.image}
          <figure class="cm-figure">
            <img
              src={section.image.src}
              alt={section.image.alt}
              width={section.id === 'ship' ? 1584 : 1376}
              height={section.id === 'ship' ? 672 : 768}
              loading="lazy"
            />
          </figure>
        {/if}
      </div>
    </section>
  {/each}
</main>

<SiteFooter />
<MarcoWidget />

<style>
  .cm-page {
    padding-top: 72px;
  }

  /* Same shell as other marketing pages: .wrap = --maxw (1440). Content column centered inside. */
  .cm-inner {
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    text-align: left;
  }

  .cm-hero {
    position: relative;
    padding: 72px 0 64px;
    overflow: hidden;
  }
  .cm-hero::before {
    content: '';
    position: absolute;
    top: -18%;
    left: 50%;
    transform: translateX(-50%);
    width: min(900px, 100%);
    height: 520px;
    background: radial-gradient(closest-side, rgba(var(--accent-rgb), 0.14), transparent 72%);
    filter: blur(20px);
    z-index: -1;
    pointer-events: none;
  }

  .cm-eyebrow {
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 18px;
  }

  .cm-h1 {
    font-size: clamp(2.4rem, 5.5vw, 3.75rem);
    font-weight: var(--heading-weight, 300);
    line-height: 1.05;
    letter-spacing: var(--heading-tracking, -0.04em);
    margin: 0;
    max-width: 16ch;
  }

  .cm-em {
    background: linear-gradient(120deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .cm-deck {
    margin: 22px 0 0;
    max-width: 38rem;
    font-size: clamp(1.05rem, 1.6vw, 1.25rem);
    line-height: 1.5;
    letter-spacing: -0.02em;
    color: var(--ink-soft);
  }

  .cm-url {
    margin-top: 28px;
    width: min(100%, 520px);
  }
  .cm-url :global(.hero-url-cta) {
    margin: 0;
  }

  .cm-sec {
    padding: 64px 0 72px;
  }
  /* Space before the phone section’s background shift */
  #mcp {
    padding-bottom: 88px;
  }
  .cm-sec.cm-tone {
    background: var(--paper-2);
  }

  .cm-kicker {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--ink) 45%, transparent);
    margin: 0 0 12px;
  }

  .cm-h2 {
    font-size: clamp(1.55rem, 3vw, 2rem);
    font-weight: var(--heading-weight, 300);
    letter-spacing: -0.035em;
    line-height: 1.15;
    margin: 0 0 16px;
    max-width: 22ch;
  }

  .cm-p {
    font-size: 1.0625rem;
    line-height: 1.65;
    letter-spacing: -0.02em;
    color: color-mix(in srgb, var(--ink) 86%, transparent);
    margin: 0 0 14px;
    max-width: 40rem;
  }

  .cm-list {
    margin: 8px 0 18px;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .cm-list li {
    position: relative;
    padding-left: 1.1rem;
    font-size: 1.02rem;
    line-height: 1.45;
    letter-spacing: -0.02em;
    color: color-mix(in srgb, var(--ink) 82%, transparent);
  }
  .cm-list li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0.55em;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }

  .cm-link {
    display: inline-flex;
    margin-top: 4px;
    font-size: 0.98rem;
    font-weight: 550;
    letter-spacing: -0.02em;
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 4px;
    text-decoration-color: color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .cm-link:hover {
    color: var(--accent);
  }

  .cm-figure {
    margin: 36px auto 0;
    max-width: 1040px;
  }
  .cm-figure img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 18px;
    border: 1px solid var(--line);
    box-shadow: 0 28px 60px -36px rgba(0, 0, 0, 0.45);
    object-fit: cover;
    aspect-ratio: 16 / 9;
  }
  #ship .cm-figure img {
    aspect-ratio: 21 / 9;
  }

  @media (max-width: 720px) {
    .cm-hero {
      padding: 48px 0 40px;
    }
    #mcp {
      padding-bottom: 64px;
    }
    .cm-sec {
      padding: 48px 0 56px;
    }
    .cm-figure img {
      border-radius: 14px;
    }
    #ship .cm-figure img {
      aspect-ratio: 16 / 9;
    }
  }
</style>
