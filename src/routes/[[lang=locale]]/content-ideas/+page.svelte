<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import { marketingStartHref } from '$lib/start-href';
  import '$lib/styles/landing.css';

  let { data } = $props();
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const cta = $derived(data.waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const loggedIn = $derived(Boolean(data.session));
  const waitlistActive = $derived(data.waitlistActive);
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));
  const tk = 'pain.contentIdeas';
</script>

<svelte:head>
  <title>{$_(`meta.${tk}.title`)}</title>
  <meta name="description" content={$_(`meta.${tk}.description`)} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_(`meta.${tk}.title`)} />
  <meta property="og:description" content={$_(`meta.${tk}.description`)} />
  <meta name="twitter:title" content={$_(`meta.${tk}.title`)} />
  <meta name="twitter:description" content={$_(`meta.${tk}.description`)} />
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main>
  <!-- HERO: split — text left, blank-page illustration right -->
  <section class="ci-hero">
    <div class="ci-wrap ci-hero-grid">
      <div class="ci-hero-copy">
        <span class="ci-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="ci-h1">{$_(`${tk}.headline`)}</h1>
        <p class="ci-sub">{$_(`${tk}.sub`)}</p>
        <a class="ci-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      </div>
      <div class="ci-hero-ill" aria-hidden="true">
        <div class="ci-notebook">
          <div class="ci-notebook-ring"></div>
          <div class="ci-notebook-ring"></div>
          <div class="ci-notebook-ring"></div>
          <div class="ci-page">
            <div class="ci-line ci-line-empty"></div>
            <div class="ci-line ci-line-empty ci-line-short"></div>
            <div class="ci-line ci-line-empty"></div>
            <div class="ci-line ci-line-empty ci-line-shorter"></div>
            <div class="ci-line ci-line-empty"></div>
            <div class="ci-line ci-line-empty ci-line-short"></div>
            <div class="ci-line ci-line-fill"></div>
            <div class="ci-line ci-line-fill ci-line-short"></div>
            <div class="ci-line ci-line-fill"></div>
          </div>
          <div class="ci-cursor"></div>
        </div>
      </div>
    </div>
  </section>

  <!-- PAIN: 2×2 grid of blank cards -->
  <section class="ci-pain">
    <div class="ci-wrap">
      <h2 class="ci-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="ci-pain-grid">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="ci-pain-card">
            <div class="ci-pain-icon" aria-hidden="true">
              <svg viewBox="0 0 40 40" fill="none">
                <rect x="4" y="4" width="32" height="32" rx="6" stroke="var(--line)" stroke-width="2" stroke-dasharray="4 3"/>
              </svg>
            </div>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- SOLUTION: 3 feature cards in a row -->
  <section class="ci-solution">
    <div class="ci-wrap">
      <h2 class="ci-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="ci-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="ci-feat-row">
        {#each [1, 2, 3] as i (i)}
          <div class="ci-feat">
            <div class="ci-feat-icon">
              <BrandMark size={20} />
            </div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- STATS: dark strip -->
  <section class="ci-stats">
    <div class="ci-wrap">
      <div class="ci-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="ci-stat">
            <span class="ci-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="ci-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- HOW: numbered steps -->
  <section class="ci-how">
    <div class="ci-wrap">
      <h2 class="ci-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="ci-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="ci-step">
            <span class="ci-step-n">{i}</span>
            <div><h3>{$_(`${tk}.how.s${i}.title`)}</h3><p>{$_(`${tk}.how.s${i}.desc`)}</p></div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- FINAL CTA -->
  <section class="ci-final">
    <div class="ci-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="ci-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .ci-wrap { max-width: 920px; margin: 0 auto; padding: 0 24px; }

  /* ——— HERO: split layout ——— */
  .ci-hero {
    padding: 110px 0 80px;
    background: var(--paper);
    overflow: hidden;
  }
  .ci-hero-grid {
    display: grid;
    grid-template-columns: 1.1fr 0.9fr;
    gap: 56px;
    align-items: center;
  }
  .ci-hero-copy { min-width: 0; }
  .ci-eyebrow {
    display: inline-block;
    font-size: 12px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.08);
    padding: 5px 14px; border-radius: 999px;
    margin-bottom: 20px;
  }
  .ci-h1 {
    font-size: clamp(2.2rem, 5vw, 3.2rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    line-height: 1.08;
    margin: 0;
    overflow-wrap: break-word;
  }
  .ci-sub {
    font-size: 1.1rem; line-height: 1.6;
    color: var(--ink-soft);
    margin: 18px 0 0;
    max-width: 42ch;
  }
  .ci-cta {
    display: inline-flex; margin-top: 28px;
    background: var(--invert-surface); color: #fff;
    text-decoration: none; border-radius: 980px;
    padding: 14px 32px; font-size: 15px; font-weight: 700;
    transition: transform 0.2s var(--ease), box-shadow 0.2s var(--ease);
  }
  .ci-cta:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(0,0,0,0.14); }

  /* Blank-page illustration */
  .ci-hero-ill { display: flex; justify-content: center; }
  .ci-notebook {
    position: relative;
    width: 260px; padding: 48px 28px 36px;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 18px;
    box-shadow: 0 20px 60px -20px rgba(0,0,0,0.1);
  }
  .ci-notebook-ring {
    position: absolute; top: 14px;
    width: 10px; height: 10px; border-radius: 50%;
    border: 2px solid var(--line);
    background: var(--paper);
  }
  .ci-notebook-ring:nth-child(1) { left: 28px; }
  .ci-notebook-ring:nth-child(2) { left: 46px; }
  .ci-notebook-ring:nth-child(3) { left: 64px; }
  .ci-page { display: flex; flex-direction: column; gap: 14px; }
  .ci-line {
    height: 3px; border-radius: 2px;
    transition: background 0.6s var(--ease);
  }
  .ci-line-empty { background: var(--line); }
  .ci-line-empty.ci-line-short { width: 72%; }
  .ci-line-empty.ci-line-shorter { width: 48%; }
  .ci-line-fill {
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    opacity: 0;
    animation: ci-fill-in 0.5s var(--ease) forwards;
  }
  .ci-line-fill:nth-child(7) { animation-delay: 1.2s; }
  .ci-line-fill:nth-child(8) { animation-delay: 1.6s; width: 72%; }
  .ci-line-fill:nth-child(9) { animation-delay: 2.0s; }
  @keyframes ci-fill-in {
    from { opacity: 0; transform: scaleX(0); transform-origin: left; }
    to { opacity: 1; transform: scaleX(1); transform-origin: left; }
  }
  .ci-cursor {
    position: absolute; bottom: 30px; right: 36px;
    width: 2px; height: 18px;
    background: var(--accent);
    border-radius: 1px;
    animation: ci-blink 1s step-end infinite;
  }
  @keyframes ci-blink { 50% { opacity: 0; } }

  /* ——— PAIN: 2×2 grid ——— */
  .ci-pain { padding: 96px 0; background: var(--paper-2, #f5f5f7); }
  .ci-h2 {
    font-size: clamp(1.5rem, 3.5vw, 2.1rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    margin: 0 0 40px; text-align: center;
    overflow-wrap: break-word;
  }
  .ci-pain-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .ci-pain-card {
    padding: 28px;
    border-radius: 16px;
    background: var(--paper);
    border: 1px solid var(--line);
    transition: border-color 0.2s var(--ease);
  }
  .ci-pain-card:hover { border-color: rgba(var(--accent-rgb), 0.3); }
  .ci-pain-icon { margin-bottom: 14px; }
  .ci-pain-icon svg { width: 36px; height: 36px; }
  .ci-pain-card p { font-size: 0.95rem; line-height: 1.5; color: var(--ink); margin: 0; }

  /* ——— SOLUTION: 3 feature cards ——— */
  .ci-solution { padding: 96px 0; background: var(--paper); }
  .ci-sol-sub {
    text-align: center; color: var(--ink-soft);
    margin: 0 0 48px; font-size: 1.05rem;
    max-width: 44ch; margin-left: auto; margin-right: auto;
  }
  .ci-feat-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
  }
  .ci-feat {
    padding: 28px 24px;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: var(--paper);
    transition: box-shadow 0.25s var(--ease), border-color 0.25s var(--ease);
  }
  .ci-feat:hover {
    box-shadow: 0 12px 32px rgba(var(--accent-rgb), 0.1);
    border-color: rgba(var(--accent-rgb), 0.25);
  }
  .ci-feat-icon {
    width: 40px; height: 40px; border-radius: 10px;
    background: rgba(var(--accent-rgb), 0.1);
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 16px;
  }
  .ci-feat-icon :global(.brandmark path) { fill: var(--accent); }
  .ci-feat h3 { font-size: 1rem; font-weight: 700; margin: 0 0 8px; }
  .ci-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }

  /* ——— STATS: dark strip ——— */
  .ci-stats {
    padding: 72px 0;
    background: var(--invert-surface);
    color: #fff;
  }
  .ci-stats-row {
    display: flex; justify-content: center;
    gap: 64px; flex-wrap: wrap;
  }
  .ci-stat { text-align: center; }
  .ci-stat-num {
    display: block;
    font-size: clamp(2rem, 5vw, 3rem);
    font-weight: 800; letter-spacing: -0.03em;
    color: var(--accent-2);
  }
  .ci-stat-lbl {
    font-size: 0.88rem;
    color: rgba(255,255,255,0.5);
    margin-top: 6px;
  }

  /* ——— HOW: numbered steps ——— */
  .ci-how { padding: 96px 0; background: var(--paper-2, #f5f5f7); }
  .ci-steps {
    display: flex; flex-direction: column;
    gap: 20px; max-width: 640px; margin: 0 auto;
  }
  .ci-step {
    display: flex; gap: 18px; align-items: flex-start;
    padding: 22px; border-radius: 14px;
    background: var(--paper);
    border: 1px solid var(--line);
  }
  .ci-step-n {
    flex: 0 0 auto;
    width: 36px; height: 36px; border-radius: 50%;
    background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; font-weight: 700;
  }
  .ci-step h3 { font-size: 0.95rem; font-weight: 700; margin: 0 0 4px; }
  .ci-step p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.5; margin: 0; }

  /* ——— FINAL CTA ——— */
  .ci-final {
    padding: 110px 0; text-align: center;
    background: var(--paper);
    border-top: 1px solid var(--line);
  }
  .ci-final h2 {
    font-size: clamp(1.7rem, 3.5vw, 2.4rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    margin: 0; overflow-wrap: break-word;
  }
  .ci-final p {
    color: var(--ink-soft);
    margin: 14px 0 0;
    font-size: 1.05rem;
    max-width: 44ch;
    margin-left: auto; margin-right: auto;
    line-height: 1.6;
  }

  /* ——— RESPONSIVE ——— */
  @media (max-width: 720px) {
    .ci-hero { padding: 80px 0 56px; }
    .ci-hero-grid { grid-template-columns: 1fr; gap: 40px; text-align: center; }
    .ci-sub { margin-left: auto; margin-right: auto; }
    .ci-hero-ill { margin-top: 8px; }
    .ci-notebook { width: 220px; padding: 40px 22px 28px; }
    .ci-pain { padding: 64px 0; }
    .ci-pain-grid { grid-template-columns: 1fr; }
    .ci-solution { padding: 64px 0; }
    .ci-feat-row { grid-template-columns: 1fr; }
    .ci-stats { padding: 56px 0; }
    .ci-stats-row { gap: 36px; }
    .ci-how { padding: 64px 0; }
    .ci-final { padding: 80px 0; }
  }
</style>
