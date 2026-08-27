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
  const tk = 'pain.cantAfford';
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
  <!-- HERO: split — text left, price comparison visual right -->
  <section class="ca-hero">
    <div class="ca-wrap ca-hero-grid">
      <div class="ca-hero-copy">
        <span class="ca-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="ca-h1">{$_(`${tk}.headline`)}</h1>
        <p class="ca-sub">{$_(`${tk}.sub`)}</p>
        <a class="ca-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      </div>
      <div class="ca-hero-visual" aria-hidden="true">
        <div class="ca-price-card ca-price-old">
          <span class="ca-price-label">Freelancer / Agency</span>
          <span class="ca-price-val">€2,000<span class="ca-price-unit">/mo</span></span>
          <div class="ca-price-strike"></div>
        </div>
        <div class="ca-price-vs">vs</div>
        <div class="ca-price-card ca-price-new">
          <span class="ca-price-label">Anomalia</span>
          <span class="ca-price-val">€79<span class="ca-price-unit">/mo</span></span>
          <div class="ca-price-glow"></div>
        </div>
      </div>
    </div>
  </section>

  <!-- PAIN: list with accent badges -->
  <section class="ca-pain">
    <div class="ca-wrap">
      <h2 class="ca-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="ca-pain-list">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="ca-pain-item">
            <span class="ca-pain-badge">{i}</span>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- SOLUTION: 3 feature cards -->
  <section class="ca-solution">
    <div class="ca-wrap">
      <h2 class="ca-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="ca-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="ca-feat-row">
        {#each [1, 2, 3] as i (i)}
          <div class="ca-feat">
            <div class="ca-feat-icon">
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
  <section class="ca-stats">
    <div class="ca-wrap">
      <div class="ca-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="ca-stat">
            <span class="ca-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="ca-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- HOW: numbered steps -->
  <section class="ca-how">
    <div class="ca-wrap">
      <h2 class="ca-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="ca-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="ca-step">
            <span class="ca-step-n">{i}</span>
            <div><h3>{$_(`${tk}.how.s${i}.title`)}</h3><p>{$_(`${tk}.how.s${i}.desc`)}</p></div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- FINAL CTA -->
  <section class="ca-final">
    <div class="ca-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="ca-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .ca-wrap { max-width: 920px; margin: 0 auto; padding: 0 24px; }

  /* ——— HERO: split with price comparison ——— */
  .ca-hero {
    padding: 110px 0 80px;
    background: var(--paper);
    overflow: hidden;
  }
  .ca-hero-grid {
    display: grid;
    grid-template-columns: 1.1fr 0.9fr;
    gap: 56px;
    align-items: center;
  }
  .ca-hero-copy { min-width: 0; }
  .ca-eyebrow {
    display: inline-block;
    font-size: 12px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.08);
    padding: 5px 14px; border-radius: 999px;
    margin-bottom: 20px;
  }
  .ca-h1 {
    font-size: clamp(2.2rem, 5vw, 3.2rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    line-height: 1.08;
    margin: 0;
    overflow-wrap: break-word;
  }
  .ca-sub {
    font-size: 1.1rem; line-height: 1.6;
    color: var(--ink-soft);
    margin: 18px 0 0;
    max-width: 42ch;
  }
  .ca-cta {
    display: inline-flex; margin-top: 28px;
    background: var(--invert-surface); color: #fff;
    text-decoration: none; border-radius: 980px;
    padding: 14px 32px; font-size: 15px; font-weight: 700;
    transition: transform 0.2s var(--ease), box-shadow 0.2s var(--ease);
  }
  .ca-cta:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(0,0,0,0.14); }

  /* Price comparison visual */
  .ca-hero-visual {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 18px;
  }
  .ca-price-card {
    position: relative;
    padding: 28px 24px;
    border-radius: 18px;
    border: 1px solid var(--line);
    background: var(--paper);
    text-align: center;
    min-width: 140px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.06);
  }
  .ca-price-label {
    display: block;
    font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--ink-soft);
    margin-bottom: 10px;
  }
  .ca-price-val {
    display: block;
    font-size: 2rem; font-weight: 800;
    letter-spacing: -0.03em;
    color: var(--ink);
  }
  .ca-price-unit {
    font-size: 0.9rem; font-weight: 600;
    color: var(--ink-soft);
  }
  .ca-price-old { opacity: 0.55; }
  .ca-price-old .ca-price-val {
    color: var(--ink-soft);
    text-decoration: line-through;
    text-decoration-color: rgba(var(--accent-rgb), 0.5);
    text-decoration-thickness: 3px;
  }
  .ca-price-new {
    border-color: rgba(var(--accent-rgb), 0.35);
    box-shadow: 0 16px 48px -12px rgba(var(--accent-rgb), 0.25);
  }
  .ca-price-new .ca-price-val { color: var(--accent); }
  .ca-price-strike {
    position: absolute; inset: 0;
    border-radius: 18px;
    background: linear-gradient(135deg, transparent 45%, rgba(var(--accent-rgb), 0.06) 50%, transparent 55%);
    pointer-events: none;
  }
  .ca-price-glow {
    position: absolute;
    bottom: -8px; left: 50%; transform: translateX(-50%);
    width: 80%; height: 20px;
    background: radial-gradient(ellipse, rgba(var(--accent-rgb), 0.2), transparent 70%);
    filter: blur(8px);
    pointer-events: none;
  }
  .ca-price-vs {
    font-size: 14px; font-weight: 700;
    color: var(--ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  /* ——— PAIN: list with accent badges ——— */
  .ca-pain { padding: 96px 0; background: var(--paper-2, #f5f5f7); }
  .ca-h2 {
    font-size: clamp(1.5rem, 3.5vw, 2.1rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    margin: 0 0 40px; text-align: center;
    overflow-wrap: break-word;
  }
  .ca-pain-list {
    display: flex; flex-direction: column;
    gap: 14px; max-width: 640px; margin: 0 auto;
  }
  .ca-pain-item {
    display: flex; align-items: flex-start; gap: 16px;
    padding: 22px 24px;
    border-radius: 14px;
    background: var(--paper);
    border: 1px solid var(--line);
  }
  .ca-pain-badge {
    flex: 0 0 auto;
    width: 32px; height: 32px; border-radius: 50%;
    background: rgba(var(--accent-rgb), 0.1);
    color: var(--accent);
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 700;
  }
  .ca-pain-item p { font-size: 0.95rem; line-height: 1.5; color: var(--ink); margin: 0; }

  /* ——— SOLUTION: 3 feature cards ——— */
  .ca-solution { padding: 96px 0; background: var(--paper); }
  .ca-sol-sub {
    text-align: center; color: var(--ink-soft);
    margin: 0 0 48px; font-size: 1.05rem;
    max-width: 44ch; margin-left: auto; margin-right: auto;
  }
  .ca-feat-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
  }
  .ca-feat {
    padding: 28px 24px;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: var(--paper);
    transition: box-shadow 0.25s var(--ease), border-color 0.25s var(--ease);
  }
  .ca-feat:hover {
    box-shadow: 0 12px 32px rgba(var(--accent-rgb), 0.1);
    border-color: rgba(var(--accent-rgb), 0.25);
  }
  .ca-feat-icon {
    width: 40px; height: 40px; border-radius: 10px;
    background: rgba(var(--accent-rgb), 0.1);
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 16px;
  }
  .ca-feat-icon :global(.brandmark path) { fill: var(--accent); }
  .ca-feat h3 { font-size: 1rem; font-weight: 700; margin: 0 0 8px; }
  .ca-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }

  /* ——— STATS: dark strip ——— */
  .ca-stats {
    padding: 72px 0;
    background: var(--invert-surface);
    color: #fff;
  }
  .ca-stats-row {
    display: flex; justify-content: center;
    gap: 64px; flex-wrap: wrap;
  }
  .ca-stat { text-align: center; }
  .ca-stat-num {
    display: block;
    font-size: clamp(2rem, 5vw, 3rem);
    font-weight: 800; letter-spacing: -0.03em;
    color: var(--accent-2);
  }
  .ca-stat-lbl {
    font-size: 0.88rem;
    color: rgba(255,255,255,0.5);
    margin-top: 6px;
  }

  /* ——— HOW: numbered steps ——— */
  .ca-how { padding: 96px 0; background: var(--paper-2, #f5f5f7); }
  .ca-steps {
    display: flex; flex-direction: column;
    gap: 20px; max-width: 640px; margin: 0 auto;
  }
  .ca-step {
    display: flex; gap: 18px; align-items: flex-start;
    padding: 22px; border-radius: 14px;
    background: var(--paper);
    border: 1px solid var(--line);
  }
  .ca-step-n {
    flex: 0 0 auto;
    width: 36px; height: 36px; border-radius: 50%;
    background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; font-weight: 700;
  }
  .ca-step h3 { font-size: 0.95rem; font-weight: 700; margin: 0 0 4px; }
  .ca-step p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.5; margin: 0; }

  /* ——— FINAL CTA ——— */
  .ca-final {
    padding: 110px 0; text-align: center;
    background: var(--paper);
    border-top: 1px solid var(--line);
  }
  .ca-final h2 {
    font-size: clamp(1.7rem, 3.5vw, 2.4rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    margin: 0; overflow-wrap: break-word;
  }
  .ca-final p {
    color: var(--ink-soft);
    margin: 14px 0 0;
    font-size: 1.05rem;
    max-width: 44ch;
    margin-left: auto; margin-right: auto;
    line-height: 1.6;
  }

  /* ——— RESPONSIVE ——— */
  @media (max-width: 720px) {
    .ca-hero { padding: 80px 0 56px; }
    .ca-hero-grid { grid-template-columns: 1fr; gap: 40px; text-align: center; }
    .ca-sub { margin-left: auto; margin-right: auto; }
    .ca-hero-visual { flex-direction: column; gap: 12px; }
    .ca-price-card { min-width: 180px; }
    .ca-price-vs { display: none; }
    .ca-pain { padding: 64px 0; }
    .ca-solution { padding: 64px 0; }
    .ca-feat-row { grid-template-columns: 1fr; }
    .ca-stats { padding: 56px 0; }
    .ca-stats-row { gap: 36px; }
    .ca-how { padding: 64px 0; }
    .ca-final { padding: 80px 0; }
  }
</style>
