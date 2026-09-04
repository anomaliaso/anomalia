<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import MarcoWidget from '$lib/components/MarcoWidget.svelte';
  import HeroUrlCta from '$lib/components/HeroUrlCta.svelte';
  import { BOOKING_URL } from '$lib/links';
  import { marketingStartHref } from '$lib/start-href';
  import '$lib/styles/landing.css';

  let { data } = $props();
  const waitlistActive = $derived(data.waitlistActive);
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const loggedIn = $derived(Boolean(data.session));
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));
  const tk = 'landing.thisAd';

  // The creatives on this page ARE the campaign's creatives (static/ads).
  // Only IT and EN sets exist; every other locale sees the English ones.
  const set = $derived((($locale as Locale) ?? 'en') === 'it' ? 'it' : 'en');
  const CREATIVES = ['a-claim', 'b-log', 'c-inception'];

  // Same illustrations the app uses for those empty states — one visual language across product
  // and site, nothing new to draw.
  const ALSO = [
    { k: 'i1', img: '/plan-hero.webp' },
    { k: 'i2', img: '/seo-geo-hero.webp' },
    { k: 'i3', img: '/library-hero.webp' }
  ];
</script>

<svelte:head>
  <title>{$_('meta.thisAd.title')}</title>
  <meta name="description" content={$_('meta.thisAd.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <meta property="og:title" content={$_('meta.thisAd.title')} />
  <meta property="og:description" content={$_('meta.thisAd.description')} />
  <meta name="twitter:title" content={$_('meta.thisAd.title')} />
  <meta name="twitter:description" content={$_('meta.thisAd.description')} />
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">
  <!-- ============ HERO ============ -->
  <section class="ad-hero">
    <div class="wrap ad-hero-inner">
      <span class="eyebrow">{$_(`${tk}.hero.eyebrow`)}</span>
      <h1 class="ad-h1">
        {$_(`${tk}.hero.titleLead`)}<br /><span class="ad-accent">{$_(`${tk}.hero.titleEm`)}</span>
      </h1>
      <p class="ad-sub">{$_(`${tk}.hero.desc`)}</p>
      <!-- Same entry point as the homepage: paste the site, the onboarding does the rest. -->
      <div class="ad-actions">
        <HeroUrlCta loggedIn={loggedIn} {waitlistActive} />
      </div>
      <p class="ad-note">
        {$_(`${tk}.hero.note`)} ·
        <a href={BOOKING_URL} target="_blank" rel="noopener" class="ad-note-link">{$_(`${tk}.hero.ctaSecondary`)}</a>
      </p>
    </div>
  </section>

  <!-- ============ THE CREATIVES OF THIS VERY CAMPAIGN ============ -->
  <section class="ad-creatives">
    <div class="wrap">
      <div class="sec-head">
        <div class="kicker">{$_(`${tk}.creatives.kicker`)}</div>
        <h2>{$_(`${tk}.creatives.title`)}</h2>
        <p>{$_(`${tk}.creatives.sub`)}</p>
      </div>
      <div class="ad-grid">
        {#each CREATIVES as id, i (id)}
          <figure class="ad-shot">
            <img src={`/ads/${id}-${set}-4x5.png`} alt={$_(`${tk}.creatives.c${i + 1}`)} loading="lazy" width="1080" height="1350" />
            <figcaption>{$_(`${tk}.creatives.c${i + 1}`)}</figcaption>
          </figure>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ HOW IT WAS MADE ============ -->
  <section class="ad-how">
    <div class="wrap">
      <div class="sec-head">
        <div class="kicker on-dark">{$_(`${tk}.how.kicker`)}</div>
        <h2>{$_(`${tk}.how.title`)}</h2>
      </div>
      <ol class="ad-steps">
        {#each ['s1', 's2', 's3', 's4', 's5'] as k, i (k)}
          <li class="ad-step">
            <span class="ad-step-n">{String(i + 1).padStart(2, '0')}</span>
            <h3>{$_(`${tk}.how.${k}.title`)}</h3>
            <p>{$_(`${tk}.how.${k}.desc`)}</p>
          </li>
        {/each}
      </ol>
    </div>
  </section>

  <!-- ============ WHAT THE SAME WORK COSTS ELSEWHERE ============ -->
  <section class="ad-cost">
    <div class="wrap">
      <div class="sec-head">
        <div class="kicker">{$_(`${tk}.cost.kicker`)}</div>
        <h2>{$_(`${tk}.cost.title`)}</h2>
        <p>{$_(`${tk}.cost.sub`)}</p>
      </div>
      <div class="ad-cost-grid">
        {#each ['agency', 'employee', 'anomalia'] as k (k)}
          <div class="ad-cost-card" class:is-us={k === 'anomalia'}>
            <div class="ad-cost-label">{$_(`${tk}.cost.${k}.label`)}</div>
            <div class="ad-cost-amt">
              {$_(`${tk}.cost.${k}.price`)}<span class="ad-cost-per">{$_(`${tk}.cost.${k}.per`)}</span>
            </div>
            <p class="ad-cost-note">{$_(`${tk}.cost.${k}.note`)}</p>
            <ul>
              {#each ['i1', 'i2', 'i3'] as it (it)}
                <li>{$_(`${tk}.cost.${k}.${it}`)}</li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
      <div class="ad-save">
        <div class="ad-save-item">
          <span class="ad-save-num">{$_(`${tk}.cost.save1.num`)}</span>
          <span class="ad-save-lbl">{$_(`${tk}.cost.save1.label`)}</span>
        </div>
        <div class="ad-save-item">
          <span class="ad-save-num">{$_(`${tk}.cost.save2.num`)}</span>
          <span class="ad-save-lbl">{$_(`${tk}.cost.save2.label`)}</span>
        </div>
      </div>
      <p class="ad-cost-disclaimer">{$_(`${tk}.cost.disclaimer`)}</p>
    </div>
  </section>

  <!-- ============ AND THE SAME MACHINE RUNS YOUR SOCIALS ============ -->
  <section class="ad-also">
    <div class="wrap">
      <div class="sec-head">
        <div class="kicker">{$_(`${tk}.also.kicker`)}</div>
        <h2>{$_(`${tk}.also.title`)}</h2>
        <p>{$_(`${tk}.also.sub`)}</p>
      </div>
      <div class="ad-also-grid">
        {#each ALSO as { k, img } (k)}
          <div class="ad-also-card">
            <img class="ad-also-img" src={img} alt="" loading="lazy" />
            <h3>{$_(`${tk}.also.${k}.title`)}</h3>
            <p>{$_(`${tk}.also.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ FINAL CTA ============ -->
  <section class="ad-final">
    <div class="wrap ad-final-inner">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <div class="ad-actions">
        <HeroUrlCta loggedIn={loggedIn} {waitlistActive} />
      </div>
      <p class="ad-note">
        <a href={BOOKING_URL} target="_blank" rel="noopener" class="ad-note-link">{$_(`${tk}.final.ctaSecondary`)}</a>
      </p>
    </div>
  </section>
</main>

<SiteFooter />
<MarcoWidget />

<style>
  /* ---------- HERO ---------- */
  .ad-hero { position: relative; padding: 150px 0 80px; text-align: center; overflow: hidden; }
  .ad-hero::before {
    content: ""; position: absolute; top: -10%; left: 50%; transform: translateX(-50%);
    width: 900px; height: 640px; max-width: 100%;
    background: radial-gradient(closest-side, rgba(var(--accent-rgb), 0.14), transparent 70%);
    filter: blur(20px); z-index: -1; pointer-events: none;
  }
  .ad-hero-inner { display: flex; flex-direction: column; align-items: center; }
  .ad-h1 {
    font-size: clamp(2.6rem, 6.4vw, 5.2rem);
    font-weight: var(--heading-weight); line-height: 1.05;
    letter-spacing: var(--heading-tracking); margin: 0; max-width: min(100%, 20ch);
    text-wrap: balance;
  }
  .ad-accent {
    background: linear-gradient(120deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  }
  .ad-sub {
    font-size: clamp(1.1rem, 1.7vw, 1.4rem); color: var(--ink-soft);
    max-width: 54ch; margin: 26px 0 0; line-height: 1.5; letter-spacing: -0.015em;
  }
  .ad-actions { margin-top: 34px; width: min(100%, 520px); }
  .ad-note { margin-top: 18px; font-size: 13px; color: var(--ink-faint); }
  .ad-note-link { text-decoration: underline; text-underline-offset: 3px; }
  .ad-note-link:hover { color: var(--ink); }

  /* ---------- CREATIVES ---------- */
  .ad-creatives { padding: 88px 0 96px; background: var(--paper-2); }
  .ad-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; max-width: 1040px; margin: 0 auto; }
  .ad-shot { margin: 0; }
  .ad-shot img {
    display: block; width: 100%; height: auto; border-radius: 18px;
    border: 1px solid var(--line); box-shadow: 0 20px 50px -30px rgba(0,0,0,0.4);
  }
  .ad-shot figcaption { margin-top: 12px; font-size: 0.88rem; color: var(--ink-soft); text-align: center; }

  /* ---------- HOW ---------- */
  .ad-how { padding: 96px 0; background: var(--invert-surface); color: #fff; }
  .ad-how :global(.sec-head h2) { color: #fff; }
  .ad-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, 1fr); gap: 18px; }
  .ad-step { padding: 26px 20px; border-radius: 18px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
  .ad-step-n { font-size: 1.4rem; font-weight: var(--heading-weight); color: var(--accent-2); letter-spacing: var(--heading-tracking); }
  .ad-step h3 { font-family: var(--sans); font-size: 1rem; font-weight: 700; margin: 12px 0 0; }
  .ad-step p { font-size: 0.88rem; color: rgba(255,255,255,0.6); margin-top: 8px; line-height: 1.5; }

  /* ---------- COST ---------- */
  .ad-cost { padding: 96px 0; }
  .ad-cost-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; max-width: 1040px; margin: 0 auto; }
  .ad-cost-card { padding: 30px 26px; border-radius: 22px; border: 1px solid var(--line); background: var(--paper-2); display: flex; flex-direction: column; }
  .ad-cost-card.is-us { background: var(--invert-surface); color: #fff; border-color: transparent; box-shadow: 0 30px 60px -30px rgba(var(--accent-rgb), 0.5); }
  .ad-cost-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-faint); }
  .ad-cost-card.is-us .ad-cost-label { color: var(--accent-2); }
  .ad-cost-amt { font-size: 2.4rem; font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin-top: 14px; }
  .ad-cost-per { font-size: 0.95rem; font-weight: 500; color: var(--ink-soft); margin-left: 8px; letter-spacing: -0.01em; }
  .ad-cost-card.is-us .ad-cost-amt { color: var(--accent-2); }
  .ad-cost-card.is-us .ad-cost-per { color: rgba(255,255,255,0.55); }
  .ad-cost-note { font-size: 0.88rem; color: var(--ink-soft); margin-top: 6px; line-height: 1.45; }
  .ad-cost-card.is-us .ad-cost-note { color: rgba(255,255,255,0.6); }
  .ad-cost-card ul { list-style: none; margin: 22px 0 0; padding: 0; display: flex; flex-direction: column; gap: 11px; }
  .ad-cost-card li { font-size: 0.93rem; line-height: 1.4; padding-left: 18px; position: relative; }
  .ad-cost-card li::before { content: "—"; position: absolute; left: 0; color: var(--ink-faint); }
  .ad-cost-card.is-us li::before { content: "✓"; color: var(--accent-2); font-weight: 700; }

  .ad-save { display: flex; flex-wrap: wrap; justify-content: center; gap: 20px 64px; margin: 44px auto 0; text-align: center; }
  .ad-save-num {
    display: block; font-size: clamp(2rem, 4vw, 2.8rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    background: linear-gradient(120deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  }
  .ad-save-lbl { display: block; font-size: 0.92rem; color: var(--ink-soft); margin-top: 4px; }
  .ad-cost-disclaimer { margin: 28px auto 0; max-width: 62ch; text-align: center; font-size: 12px; color: var(--ink-faint); line-height: 1.55; }

  /* ---------- ALSO ---------- */
  .ad-also { padding: 96px 0; }
  .ad-also-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .ad-also-card { padding: 0 0 28px; border-radius: 18px; border: 1px solid var(--line); background: var(--paper); overflow: hidden; }
  .ad-also-img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; margin-bottom: 22px; }
  .ad-also-card h3 { font-family: var(--sans); font-size: 1.05rem; font-weight: 700; margin: 0 24px; }
  .ad-also-card p { font-size: 0.92rem; color: var(--ink-soft); margin: 8px 24px 0; line-height: 1.5; }

  /* ---------- FINAL ---------- */
  .ad-final { padding: 118px 0; text-align: center; }
  .ad-final-inner { display: flex; flex-direction: column; align-items: center; }
  .ad-final h2 { font-size: clamp(2rem, 4.5vw, 3.2rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; max-width: 24ch; text-wrap: balance; }
  .ad-final p { color: var(--ink-soft); margin: 18px 0 0; font-size: 1.12rem; max-width: 48ch; line-height: 1.55; }

  /* ---------- RESPONSIVE ---------- */
  @media (max-width: 980px) {
    .ad-steps { grid-template-columns: repeat(3, 1fr); }
    .ad-cost-grid { grid-template-columns: 1fr; max-width: 460px; }
  }
  @media (max-width: 720px) {
    .ad-hero { padding: 116px 0 56px; }
    .ad-creatives, .ad-how, .ad-also { padding: 64px 0; }
    .ad-final { padding: 84px 0; }
    .ad-grid, .ad-also-grid, .ad-cost-grid { grid-template-columns: 1fr; max-width: 420px; }
    .ad-cost { padding: 64px 0; }
    .ad-steps { grid-template-columns: 1fr; }
  }
</style>
