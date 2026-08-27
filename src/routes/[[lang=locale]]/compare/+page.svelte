<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import { COMPARISONS, t } from '$lib/data/comparisons';
  import { marketingStartHref } from '$lib/start-href';
  import '$lib/styles/landing.css';

  let { data } = $props();
  const lang = $derived(((($locale as Locale) ?? 'en') === 'it' ? 'it' : 'en') as 'en' | 'it');
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const cta = $derived(data.waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const loggedIn = $derived(Boolean(data.session));
  const waitlistActive = $derived(data.waitlistActive);
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));

  const pageTitle = $derived(
    lang === 'it'
      ? 'Confronti — Buffer vs Hootsuite e alternative · Anomalia'
      : 'Compare — Buffer vs Hootsuite & alternatives · Anomalia'
  );
  const pageDesc = $derived(
    lang === 'it'
      ? 'Confronti tra Buffer, Hootsuite, Later, Predis.ai e Taplio: differenze reali, e dove un autopilot AI batte uno scheduler.'
      : 'Side-by-sides of Buffer, Hootsuite, Later, Predis.ai and Taplio: real differences, and where an AI autopilot beats a scheduler.'
  );
</script>

<svelte:head>
  <title>{pageTitle}</title>
  <meta name="description" content={pageDesc} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={pageTitle} />
  <meta property="og:description" content={pageDesc} />
  <meta name="twitter:title" content={pageTitle} />
  <meta name="twitter:description" content={pageDesc} />
</svelte:head>

<SiteNav {cta} ctaHref={startHref} current="compare" />

<main class="cmp-hub">
  <section class="cmp-hero">
    <div class="cmp-wrap">
      <p class="cmp-eyebrow">{lang === 'it' ? 'Alternative' : 'Alternatives'}</p>
      <h1 class="cmp-h1">{lang === 'it' ? 'Confronti' : 'Compare'}</h1>
      <p class="cmp-sub">
        {lang === 'it'
          ? 'Buffer, Hootsuite, Later e gli altri — differenze reali, senza marketing. Alla fine di ogni pagina: dove Anomalia fa da autopilot.'
          : 'Buffer, Hootsuite, Later and the rest — real differences, no fluff. At the end of each page: where Anomalia runs as autopilot.'}
      </p>
    </div>
  </section>

  <section class="cmp-list-sec">
    <div class="cmp-wrap">
      <div class="cmp-grid">
        {#each COMPARISONS as c (c.slug)}
          <a class="cmp-card" href={lp(`/compare/${c.slug}`)}>
            <div class="cmp-card-vs">
              <span>{c.a}</span>
              <span class="cmp-card-x">vs</span>
              <span>{c.b}</span>
            </div>
            <h2>{t(c.title, lang)}</h2>
            <p>{t(c.excerpt, lang)}</p>
            <span class="cmp-card-link">{lang === 'it' ? 'Leggi il confronto' : 'Read the comparison'} →</span>
          </a>
        {/each}
      </div>
    </div>
  </section>

  <section class="cmp-pitch">
    <div class="cmp-wrap cmp-pitch-inner">
      <h2>
        {lang === 'it'
          ? 'Non ti serve un altro scheduler'
          : 'You don’t need another scheduler'}
      </h2>
      <p>
        {lang === 'it'
          ? 'Anomalia pianifica, scrive, disegna e pubblica. Tu approvi.'
          : 'Anomalia plans, writes, designs and publishes. You approve.'}
      </p>
      <a class="cmp-cta" href={startHref}>{cta} <span>→</span></a>
    </div>
  </section>
</main>

<SiteFooter ctaHref={startHref} />

<style>
  .cmp-wrap { max-width: 960px; margin: 0 auto; padding: 0 24px; }

  .cmp-hero {
    padding: 140px 0 56px;
    background:
      radial-gradient(ellipse 80% 60% at 50% -10%, rgba(var(--accent-rgb), 0.12), transparent 60%),
      var(--paper);
  }
  .cmp-eyebrow {
    font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--ink-soft); margin: 0 0 16px;
  }
  .cmp-h1 {
    font-size: clamp(2.5rem, 5vw, 3.5rem); font-weight: 500; letter-spacing: -0.03em;
    line-height: 1.05; margin: 0 0 16px;
  }
  .cmp-sub {
    font-size: 1.05rem; color: var(--ink-soft); line-height: 1.55; margin: 0; max-width: 46ch;
  }

  .cmp-list-sec { padding: 24px 0 80px; }
  .cmp-grid {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;
  }
  .cmp-card {
    display: flex; flex-direction: column; gap: 10px;
    padding: 28px 24px; border-radius: 18px;
    background: var(--paper-2, var(--paper));
    border: 1px solid var(--line);
    text-decoration: none; color: inherit;
    transition: border-color 0.15s, transform 0.15s;
  }
  .cmp-card:hover { border-color: rgba(var(--accent-rgb), 0.45); transform: translateY(-2px); }
  .cmp-card-vs {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
    color: var(--accent, #7c5cff);
  }
  .cmp-card-x { opacity: 0.5; font-weight: 600; }
  .cmp-card h2 {
    font-family: var(--sans); font-size: 1.05rem; font-weight: 600;
    letter-spacing: -0.02em; margin: 0; line-height: 1.35;
  }
  .cmp-card p { margin: 0; color: var(--ink-soft); font-size: 0.95rem; line-height: 1.5; flex: 1; }
  .cmp-card-link { font-size: 13px; font-weight: 600; color: var(--accent, #7c5cff); }

  .cmp-pitch {
    padding: 72px 0 96px;
    background: #111; color: #fff;
  }
  .cmp-pitch-inner { text-align: center; max-width: 640px; }
  .cmp-pitch h2 {
    font-size: clamp(1.5rem, 3vw, 2rem); font-weight: 500; margin: 0 0 12px; letter-spacing: -0.02em;
  }
  .cmp-pitch p { color: rgba(255,255,255,0.6); margin: 0 0 28px; line-height: 1.5; }
  .cmp-cta {
    display: inline-flex; align-items: center; gap: 8px;
    background: #fff; color: #111; font-weight: 600; font-size: 15px;
    padding: 12px 24px; border-radius: 999px; text-decoration: none;
  }
  .cmp-cta:hover { background: rgba(255,255,255,0.9); }

  @media (max-width: 720px) {
    .cmp-grid { grid-template-columns: 1fr; }
    .cmp-hero { padding-top: 120px; }
  }
</style>
