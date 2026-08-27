<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { openCookieSettings } from '$lib/consent';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { marketingStartHref } from '$lib/start-href';
  import '$lib/styles/landing.css';

  let { data } = $props();
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const waitlistActive = $derived(data.waitlistActive);
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const loggedIn = $derived(Boolean(data.session));
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));

  // Each segment: a key (→ i18n) and a small inline icon. Icons are simple 24×24
  // stroke glyphs in the same family as the landing "why" features.
  const SEGMENTS = [
    { key: 'creators', icon: 'M12 3l2.5 5 5.5.8-4 3.9.9 5.4L12 16l-4.9 2.6.9-5.4-4-3.9 5.5-.8z' },
    { key: 'agencies', icon: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5' },
    { key: 'ecommerce', icon: 'M6 8h12l-1 12H7zM9 8a3 3 0 0 1 6 0' },
    { key: 'brands', icon: 'M12 3l7 3v6c0 4.5-3 7-7 8-4-1-7-3.5-7-8V6zM9 12l2 2 4-4' },
    { key: 'saas', icon: 'M3 5h18v14H3zM3 9h18M8 13l-1.5 1.5L8 16M16 13l1.5 1.5L16 16' },
    { key: 'local', icon: 'M5 10l1-5h12l1 5M5 10v10h14V10M5 10h14M10 20v-5h4v5' },
    { key: 'coaches', icon: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21a7 7 0 0 1 14 0' },
    { key: 'realestate', icon: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6' },
    { key: 'events', icon: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4' }
  ];
</script>

<svelte:head>
  <title>{$_('meta.usecases.title')}</title>
  <meta name="description" content={$_('meta.usecases.description')} />
  <meta
    name="robots"
    content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
  />
  <meta property="og:title" content={$_('meta.usecases.title')} />
  <meta property="og:description" content={$_('meta.usecases.description')} />
  <meta name="twitter:title" content={$_('meta.usecases.title')} />
  <meta name="twitter:description" content={$_('meta.usecases.description')} />
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">
  <!-- ============ HERO ============ -->
  <section class="uc-hero">
    <div class="wrap">
      <span class="eyebrow">{$_('usecases.hero.eyebrow')}</span>
      <h1>{$_('usecases.hero.title')}</h1>
      <p class="lede">{$_('usecases.hero.lede')}</p>
    </div>
  </section>

  <!-- ============ SEGMENT GRID ============ -->
  <section class="uc-grid-sec">
    <div class="wrap">
      <div class="uc-grid">
        {#each SEGMENTS as seg (seg.key)}
          <article class="uc-card">
            <div class="uc-media">
              <div class="uc-media-frame">
                <img src={`/usecases/${seg.key}.jpg`} alt="" loading="lazy" />
              </div>
              <div class="uc-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d={seg.icon} />
                </svg>
              </div>
            </div>
            <div class="uc-body">
              <h3>{$_('usecases.segments.' + seg.key + '.title')}</h3>
              <p class="uc-desc">{$_('usecases.segments.' + seg.key + '.desc')}</p>
              <ul class="uc-bullets">
                {#each ['b1', 'b2', 'b3'] as b (b)}
                  <li>
                    <svg class="uc-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
                    {$_('usecases.segments.' + seg.key + '.' + b)}
                  </li>
                {/each}
              </ul>
            </div>
          </article>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ CTA BAND ============ -->
  <section id="waitlist">
    <div class="wrap final">
      <h2>{$_('usecases.final.title')}</h2>
      <p>{$_('usecases.final.sub')}</p>
      <a href={startHref} class="btn btn-primary final-cta">{cta}</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .uc-hero {
    padding: 116px 0 56px;
    text-align: center;
  }
  .uc-hero .eyebrow {
    display: inline-block;
    margin-bottom: 18px;
  }
  .uc-hero h1 {
    font-size: clamp(2.1rem, 5vw, 3.2rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    line-height: 1.05;
    /* Override landing.css's global `h1 { max-width: 17ch }` so the centered
       heading isn't shrink-wrapped and pinned left. */
    max-width: 20ch;
    margin: 0 auto;
  }
  /* Desktop floor: serif title never drops below 56px. */
  @media (min-width: 821px) {
    .uc-hero h1 { font-size: clamp(56px, 5vw, 64px); }
  }
  .uc-hero .lede {
    max-width: 56ch;
    margin: 18px auto 0;
    color: var(--ink-soft);
    font-size: 1.1rem;
    line-height: 1.55;
  }

  .uc-grid-sec {
    padding: 24px 0 110px;
  }
  .uc-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
  }
  .uc-card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 22px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: transform 0.3s var(--ease), border-color 0.3s var(--ease), box-shadow 0.3s var(--ease);
  }
  .uc-card:hover {
    transform: translateY(-4px);
    border-color: rgba(var(--accent-rgb), 0.35);
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.09);
  }
  /* Photo header — a happy person from that sector, generated in the homepage style.
     The frame clips the image zoom; .uc-media itself doesn't clip, so the icon
     badge can straddle the photo/body edge without being cut off. */
  .uc-media {
    position: relative;
    aspect-ratio: 3 / 2;
  }
  .uc-media-frame {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: var(--paper-2);
  }
  .uc-media-frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.6s var(--ease);
  }
  .uc-card:hover .uc-media-frame img {
    transform: scale(1.045);
  }
  /* Icon chip straddles the photo / body edge for a polished, editorial feel. */
  .uc-ico {
    position: absolute;
    left: 20px;
    bottom: -23px;
    width: 46px;
    height: 46px;
    border-radius: 13px;
    display: grid;
    place-items: center;
    color: var(--accent);
    background: var(--paper);
    border: 1px solid rgba(var(--accent-rgb), 0.16);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
  }
  .uc-ico svg {
    width: 24px;
    height: 24px;
  }
  .uc-body {
    padding: 36px 24px 26px;
  }
  .uc-card h3 {
    font-size: 1.22rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    margin: 0 0 6px;
  }
  .uc-desc {
    color: var(--ink-soft);
    font-size: 0.98rem;
    line-height: 1.45;
    margin: 0 0 18px;
  }
  .uc-bullets {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .uc-bullets li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 0.95rem;
    line-height: 1.4;
    color: var(--ink);
  }
  .uc-check {
    flex: 0 0 auto;
    width: 17px;
    height: 17px;
    margin-top: 2px;
    color: var(--accent);
  }

  @media (max-width: 900px) {
    .uc-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 560px) {
    .uc-grid { grid-template-columns: 1fr; }
    .uc-hero { padding: 104px 0 40px; }
  }
</style>
