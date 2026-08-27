<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import { COMPARISONS, t, type Comparison } from '$lib/data/comparisons';
  import { marketingStartHref } from '$lib/start-href';
  import '$lib/styles/landing.css';

  let { data } = $props();
  const comparison = $derived(data.comparison as Comparison);
  const lang = $derived(((($locale as Locale) ?? 'en') === 'it' ? 'it' : 'en') as 'en' | 'it');
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const cta = $derived(data.waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const loggedIn = $derived(Boolean(data.session));
  const waitlistActive = $derived(data.waitlistActive);
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));

  const others = $derived(COMPARISONS.filter((c) => c.slug !== comparison.slug).slice(0, 3));

  const jsonLd = $derived(
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: t(comparison.title, lang),
      description: t(comparison.description, lang),
      about: [
        { '@type': 'SoftwareApplication', name: comparison.a },
        { '@type': 'SoftwareApplication', name: comparison.b },
        { '@type': 'SoftwareApplication', name: 'Anomalia' }
      ]
    })
  );
</script>

<svelte:head>
  <title>{t(comparison.title, lang)} · Anomalia</title>
  <meta name="description" content={t(comparison.description, lang)} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={t(comparison.title, lang)} />
  <meta property="og:description" content={t(comparison.description, lang)} />
  <meta name="twitter:title" content={t(comparison.title, lang)} />
  <meta name="twitter:description" content={t(comparison.description, lang)} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} current="compare" />

<main class="cv">
  <section class="cv-hero">
    <div class="cv-wrap">
      <a class="cv-back" href={lp('/compare')}>{lang === 'it' ? '← Tutti i confronti' : '← All comparisons'}</a>
      <p class="cv-eyebrow">{comparison.a} vs {comparison.b}</p>
      <h1 class="cv-h1">{t(comparison.title, lang)}</h1>
      <p class="cv-sub">{t(comparison.excerpt, lang)}</p>
      <div class="cv-best">
        <div>
          <span class="cv-best-label">{lang === 'it' ? 'Meglio' : 'Best for'} {comparison.a}</span>
          <p>{t(comparison.bestForA, lang)}</p>
        </div>
        <div>
          <span class="cv-best-label">{lang === 'it' ? 'Meglio' : 'Best for'} {comparison.b}</span>
          <p>{t(comparison.bestForB, lang)}</p>
        </div>
      </div>
    </div>
  </section>

  <section class="cv-table-sec">
    <div class="cv-wrap">
      <h2 class="cv-h2">{lang === 'it' ? 'A colpo d’occhio' : 'At a glance'}</h2>
      <div class="cv-table" role="table">
        <div class="cv-tr cv-th" role="row">
          <div role="columnheader">{lang === 'it' ? 'Funzione' : 'Feature'}</div>
          <div role="columnheader">{comparison.a}</div>
          <div role="columnheader">{comparison.b}</div>
        </div>
        {#each comparison.rows as row (t(row.feature, 'en'))}
          <div class="cv-tr" role="row">
            <div role="cell"><strong>{t(row.feature, lang)}</strong></div>
            <div role="cell">{t(row.a, lang)}</div>
            <div role="cell">{t(row.b, lang)}</div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="cv-pros">
    <div class="cv-wrap cv-pros-grid">
      <div class="cv-side">
        <h2 class="cv-h2">{comparison.a}</h2>
        <h3>{lang === 'it' ? 'Pro' : 'Pros'}</h3>
        <ul>
          {#each comparison.aPros as p (t(p, 'en'))}
            <li class="ok">{t(p, lang)}</li>
          {/each}
        </ul>
        <h3>{lang === 'it' ? 'Contro' : 'Cons'}</h3>
        <ul>
          {#each comparison.aCons as p (t(p, 'en'))}
            <li class="no">{t(p, lang)}</li>
          {/each}
        </ul>
      </div>
      <div class="cv-side">
        <h2 class="cv-h2">{comparison.b}</h2>
        <h3>{lang === 'it' ? 'Pro' : 'Pros'}</h3>
        <ul>
          {#each comparison.bPros as p (t(p, 'en'))}
            <li class="ok">{t(p, lang)}</li>
          {/each}
        </ul>
        <h3>{lang === 'it' ? 'Contro' : 'Cons'}</h3>
        <ul>
          {#each comparison.bCons as p (t(p, 'en'))}
            <li class="no">{t(p, lang)}</li>
          {/each}
        </ul>
      </div>
    </div>
  </section>

  <section class="cv-gap">
    <div class="cv-wrap">
      <h2 class="cv-h2">{t(comparison.gap.title, lang)}</h2>
      <ul class="cv-gap-list">
        {#each comparison.gap.points as p (t(p, 'en'))}
          <li>{t(p, lang)}</li>
        {/each}
      </ul>
    </div>
  </section>

  <section class="cv-anomalia">
    <div class="cv-wrap">
      <p class="cv-eyebrow light">Anomalia</p>
      <h2 class="cv-h2 light">{t(comparison.anomalia.title, lang)}</h2>
      <p class="cv-anomalia-sub">{t(comparison.anomalia.sub, lang)}</p>
      <ul class="cv-anomalia-points">
        {#each comparison.anomalia.points as p (t(p, 'en'))}
          <li>{t(p, lang)}</li>
        {/each}
      </ul>
      <a class="cv-cta" href={startHref}>{cta} <span>→</span></a>
    </div>
  </section>

  {#if others.length}
    <section class="cv-more">
      <div class="cv-wrap">
        <h2 class="cv-h2">{lang === 'it' ? 'Altri confronti' : 'More comparisons'}</h2>
        <div class="cv-more-grid">
          {#each others as o (o.slug)}
            <a href={lp(`/compare/${o.slug}`)}>{o.a} vs {o.b}</a>
          {/each}
        </div>
      </div>
    </section>
  {/if}
</main>

<SiteFooter ctaHref={startHref} />

<style>
  .cv-wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }

  .cv-hero {
    padding: 130px 0 48px;
    background:
      radial-gradient(ellipse 70% 50% at 20% 0%, rgba(var(--accent-rgb), 0.1), transparent 55%),
      var(--paper);
  }
  .cv-back {
    display: inline-block; font-size: 13px; font-weight: 600; color: var(--ink-soft);
    text-decoration: none; margin-bottom: 20px;
  }
  .cv-back:hover { color: var(--ink); }
  .cv-eyebrow {
    font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--accent, #7c5cff); margin: 0 0 14px;
  }
  .cv-eyebrow.light { color: rgba(255,255,255,0.55); }
  .cv-h1 {
    font-size: clamp(1.75rem, 4vw, 2.6rem); font-weight: 500; letter-spacing: -0.03em;
    line-height: 1.12; margin: 0 0 14px; max-width: 20ch;
  }
  .cv-sub { font-size: 1.05rem; color: var(--ink-soft); line-height: 1.55; margin: 0 0 28px; max-width: 48ch; }
  .cv-best {
    display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
  }
  .cv-best > div {
    padding: 18px 16px; border-radius: 14px; border: 1px solid var(--line); background: var(--paper-2, var(--paper));
  }
  .cv-best-label {
    display: block; font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--accent, #7c5cff); margin-bottom: 6px;
  }
  .cv-best p { margin: 0; font-size: 0.95rem; line-height: 1.45; color: var(--ink-soft); }

  .cv-h2 {
    font-size: clamp(1.35rem, 2.5vw, 1.75rem); font-weight: 500; letter-spacing: -0.02em; margin: 0 0 20px;
  }
  .cv-h2.light { color: #fff; }

  .cv-table-sec { padding: 48px 0 24px; }
  .cv-table { border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
  .cv-tr {
    display: grid; grid-template-columns: 1.1fr 1fr 1fr; gap: 0;
    border-bottom: 1px solid var(--line);
  }
  .cv-tr:last-child { border-bottom: 0; }
  .cv-tr > div { padding: 14px 16px; font-size: 0.92rem; line-height: 1.4; }
  .cv-th { background: rgba(var(--accent-rgb), 0.06); font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }

  .cv-pros { padding: 40px 0 24px; }
  .cv-pros-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .cv-side {
    padding: 24px; border-radius: 16px; border: 1px solid var(--line); background: var(--paper-2, var(--paper));
  }
  .cv-side h3 { font-size: 13px; font-weight: 700; margin: 16px 0 8px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); }
  .cv-side h3:first-of-type { margin-top: 0; }
  .cv-side ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .cv-side li { font-size: 0.95rem; line-height: 1.4; padding-left: 1.1em; position: relative; }
  .cv-side li.ok::before { content: '✓'; position: absolute; left: 0; color: #1f8a4c; font-weight: 700; }
  .cv-side li.no::before { content: '×'; position: absolute; left: 0; color: #c0392b; font-weight: 700; }

  .cv-gap { padding: 40px 0 56px; }
  .cv-gap-list {
    list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px;
  }
  .cv-gap-list li {
    padding: 16px 18px; border-radius: 12px; border: 1px solid var(--line);
    background: rgba(var(--accent-rgb), 0.04); font-size: 1rem; line-height: 1.45;
  }

  .cv-anomalia {
    padding: 72px 0;
    background: linear-gradient(160deg, #0a0c1a 0%, #15182e 50%, #0a0c1a 100%);
    color: #fff;
  }
  .cv-anomalia-sub {
    color: rgba(255,255,255,0.65); font-size: 1.05rem; line-height: 1.55; margin: 0 0 24px; max-width: 42ch;
  }
  .cv-anomalia-points {
    list-style: none; margin: 0 0 32px; padding: 0; display: flex; flex-direction: column; gap: 10px;
  }
  .cv-anomalia-points li {
    padding-left: 1.25em; position: relative; color: rgba(255,255,255,0.85); line-height: 1.45;
  }
  .cv-anomalia-points li::before {
    content: '→'; position: absolute; left: 0; color: var(--accent, #7c5cff);
  }
  .cv-cta {
    display: inline-flex; align-items: center; gap: 8px;
    background: #fff; color: #111; font-weight: 600; font-size: 15px;
    padding: 12px 24px; border-radius: 999px; text-decoration: none;
  }
  .cv-cta:hover { background: rgba(255,255,255,0.9); }

  .cv-more { padding: 56px 0 80px; }
  .cv-more-grid { display: flex; flex-wrap: wrap; gap: 10px; }
  .cv-more-grid a {
    padding: 10px 14px; border-radius: 999px; border: 1px solid var(--line);
    font-size: 13px; font-weight: 600; text-decoration: none; color: var(--ink-soft);
  }
  .cv-more-grid a:hover { color: var(--ink); border-color: rgba(var(--accent-rgb), 0.4); }

  @media (max-width: 720px) {
    .cv-best, .cv-pros-grid { grid-template-columns: 1fr; }
    .cv-tr { grid-template-columns: 1fr; }
    .cv-th { display: none; }
    .cv-tr > div:first-child { background: rgba(var(--accent-rgb), 0.05); }
    .cv-hero { padding-top: 110px; }
  }
</style>
