<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
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
  const tk = 'pain.notWorking';
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

<main class="nw-page">
  <section class="nw-hero">
    <div class="nw-hero-grid">
      <div class="nw-hero-copy">
        <span class="nw-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="nw-h1">{$_(`${tk}.headline`)}</h1>
        <p class="nw-sub">{$_(`${tk}.sub`)}</p>
        <a class="nw-cta" href={startHref}>{$_(`${tk}.cta`)} <span class="nw-cta-arr">&rarr;</span></a>
      </div>
      <div class="nw-hero-visual">
        <div class="nw-chart-wrap">
          <div class="nw-chart-label">Engagement</div>
          <svg class="nw-chart nw-chart-down" viewBox="0 0 320 200" fill="none">
            <defs>
              <linearGradient id="nw-grad-down" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="rgba(192,57,43,0.25)" />
                <stop offset="100%" stop-color="rgba(192,57,43,0)" />
              </linearGradient>
            </defs>
            <path d="M0 160 C40 155, 60 140, 90 130 C120 120, 140 100, 170 110 C200 120, 220 90, 250 70 C270 58, 290 80, 320 40 L320 200 L0 200Z" fill="url(#nw-grad-down)" />
            <path class="nw-line-down" d="M0 160 C40 155, 60 140, 90 130 C120 120, 140 100, 170 110 C200 120, 220 90, 250 70 C270 58, 290 80, 320 40" stroke="#c0392b" stroke-width="3" stroke-linecap="round" />
            <circle cx="320" cy="40" r="5" fill="#c0392b" />
          </svg>
          <div class="nw-chart-arrow nw-chart-arrow-down">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4v12m0 0l-4-4m4 4l4-4" stroke="#c0392b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="nw-pain">
    <div class="nw-wrap">
      <div class="nw-section-head">
        <h2 class="nw-h2">{$_(`${tk}.problem.title`)}</h2>
      </div>
      <div class="nw-metrics">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="nw-metric">
            <div class="nw-metric-bar">
              <div class="nw-metric-fill" style="width: {Math.max(15, 85 - i * 18)}%"></div>
            </div>
            <p class="nw-metric-text">{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="nw-solution">
    <div class="nw-wrap">
      <div class="nw-section-head">
        <h2 class="nw-h2">{$_(`${tk}.solution.title`)}</h2>
        <p class="nw-section-sub">{$_(`${tk}.solution.sub`)}</p>
      </div>
      <div class="nw-feat-row">
        {#each [1, 2, 3] as i (i)}
          <div class="nw-feat">
            <div class="nw-feat-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="nw-stats">
    <div class="nw-wrap">
      <div class="nw-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="nw-stat">
            <span class="nw-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="nw-stat-label">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="nw-how">
    <div class="nw-wrap">
      <h2 class="nw-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="nw-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="nw-step">
            <div class="nw-step-num">{i}</div>
            <div class="nw-step-body">
              <h3>{$_(`${tk}.how.s${i}.title`)}</h3>
              <p>{$_(`${tk}.how.s${i}.desc`)}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="nw-solution-chart">
    <div class="nw-wrap">
      <div class="nw-chart-card">
        <div class="nw-chart-card-label">Growth with Anomalia</div>
        <svg class="nw-chart nw-chart-up" viewBox="0 0 320 200" fill="none">
          <defs>
            <linearGradient id="nw-grad-up" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(var(--accent-rgb), 0.25)" />
              <stop offset="100%" stop-color="rgba(var(--accent-rgb), 0)" />
            </linearGradient>
          </defs>
          <path d="M0 180 C30 175, 60 160, 100 140 C140 120, 160 100, 190 80 C220 60, 250 50, 280 30 C300 18, 310 15, 320 10 L320 200 L0 200Z" fill="url(#nw-grad-up)" />
          <path class="nw-line-up" d="M0 180 C30 175, 60 160, 100 140 C140 120, 160 100, 190 80 C220 60, 250 50, 280 30 C300 18, 310 15, 320 10" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" />
          <circle cx="320" cy="10" r="5" fill="var(--accent)" />
        </svg>
        <div class="nw-chart-arrow nw-chart-arrow-up">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 16V4m0 0l-4 4m4-4l4 4" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>
    </div>
  </section>

  <section class="nw-final">
    <div class="nw-wrap">
      <h2 class="nw-final-title">{$_(`${tk}.final.title`)}</h2>
      <p class="nw-final-sub">{$_(`${tk}.final.sub`)}</p>
      <a class="nw-cta nw-cta-light" href={startHref}>{$_(`${tk}.final.cta`)} <span class="nw-cta-arr">&rarr;</span></a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .nw-wrap { max-width: 960px; margin: 0 auto; padding: 0 24px; }

  .nw-hero {
    position: relative; padding: 140px 0 100px;
    background: linear-gradient(160deg, #1a0a0a 0%, #2a1215 45%, #1a0a0a 100%);
    color: #fff; overflow: hidden;
  }
  .nw-hero-grid {
    max-width: 1060px; margin: 0 auto; padding: 0 24px;
    display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center;
  }
  .nw-eyebrow {
    display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.14em; color: rgba(255,255,255,0.5);
    border: 1px solid rgba(255,255,255,0.1); padding: 6px 16px; border-radius: 999px; margin-bottom: 28px;
  }
  .nw-h1 {
    font-size: clamp(2rem, 4.5vw, 3.2rem); font-weight: 800; letter-spacing: -0.03em;
    line-height: 1.08; margin: 0; max-width: 22ch;
  }
  .nw-sub {
    font-size: 1.1rem; line-height: 1.65; color: rgba(255,255,255,0.65);
    margin: 22px 0 0; max-width: 44ch;
  }
  .nw-cta {
    display: inline-flex; align-items: center; gap: 10px; margin-top: 36px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #fff; text-decoration: none; border-radius: 980px; padding: 16px 36px;
    font-size: 16px; font-weight: 700; transition: transform .2s, box-shadow .2s;
  }
  .nw-cta:hover { transform: translateY(-2px); box-shadow: 0 14px 40px rgba(var(--accent-rgb), 0.35); }
  .nw-cta-arr { transition: transform .2s; }
  .nw-cta:hover .nw-cta-arr { transform: translateX(3px); }

  .nw-hero-visual { display: flex; justify-content: center; }
  .nw-chart-wrap {
    position: relative; width: 100%; max-width: 380px; padding: 28px;
    border-radius: 24px; background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
  }
  .nw-chart-label {
    font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
    color: rgba(255,255,255,0.4); margin-bottom: 12px;
  }
  .nw-chart { width: 100%; height: auto; }
  .nw-line-down {
    stroke-dasharray: 500; stroke-dashoffset: 500;
    animation: nw-draw 2s ease forwards 0.5s;
  }
  .nw-chart-arrow {
    position: absolute; display: flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: 50%;
  }
  .nw-chart-arrow-down { bottom: 36px; right: 40px; background: rgba(192,57,43,0.12); }

  @keyframes nw-draw { to { stroke-dashoffset: 0; } }

  .nw-section-head { text-align: center; margin-bottom: 48px; }
  .nw-h2 {
    font-size: clamp(1.6rem, 3.5vw, 2.2rem); font-weight: 800; letter-spacing: -0.02em;
    margin: 0; text-align: center;
  }
  .nw-section-sub {
    color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; line-height: 1.6;
    max-width: 48ch; margin-left: auto; margin-right: auto; text-align: center;
  }

  .nw-pain { padding: 100px 0 88px; background: #fff; }
  .nw-metrics { display: flex; flex-direction: column; gap: 20px; max-width: 640px; margin: 0 auto; }
  .nw-metric {
    padding: 20px 24px; border-radius: 14px;
    background: rgba(192,57,43,0.02); border: 1px solid rgba(192,57,43,0.08);
    transition: border-color .2s;
  }
  .nw-metric:hover { border-color: rgba(192,57,43,0.2); }
  .nw-metric-bar {
    height: 6px; border-radius: 3px; background: rgba(192,57,43,0.08); margin-bottom: 14px; overflow: hidden;
  }
  .nw-metric-fill {
    height: 100%; border-radius: 3px; background: linear-gradient(90deg, #c0392b, #e74c3c);
    transition: width 1s var(--ease, ease);
  }
  .nw-metric-text { font-size: .95rem; line-height: 1.5; color: var(--ink); margin: 0; }

  .nw-solution { padding: 88px 0 100px; background: #fff; }
  .nw-feat-row {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; max-width: 820px; margin: 0 auto;
  }
  .nw-feat {
    background: #fff; border-radius: 20px; padding: 34px 28px;
    border: 1px solid rgba(var(--accent-rgb), 0.1); box-shadow: 0 2px 16px rgba(0,0,0,0.04);
    transition: transform .25s, box-shadow .25s; text-align: center;
  }
  .nw-feat:hover { transform: translateY(-5px); box-shadow: 0 16px 44px rgba(var(--accent-rgb), 0.12); }
  .nw-feat-icon {
    width: 48px; height: 48px; border-radius: 14px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff;
    display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;
  }
  .nw-feat h3 { font-size: 1.05rem; font-weight: 700; margin: 0 0 10px; letter-spacing: -0.01em; }
  .nw-feat p { font-size: .92rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }

  .nw-stats { padding: 72px 0; background: #1a0a0a; color: #fff; }
  .nw-stats-row { display: flex; justify-content: center; gap: 64px; flex-wrap: wrap; }
  .nw-stat { text-align: center; }
  .nw-stat-num {
    display: block; font-size: clamp(2rem, 5vw, 3rem); font-weight: 800; letter-spacing: -0.03em;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  }
  .nw-stat-label { font-size: .88rem; color: rgba(255,255,255,0.5); margin-top: 6px; max-width: 20ch; margin-left: auto; margin-right: auto; }

  .nw-how { padding: 100px 0; background: #fff; }
  .nw-steps { display: flex; flex-direction: column; gap: 28px; max-width: 640px; margin: 44px auto 0; }
  .nw-step {
    display: flex; gap: 20px; align-items: flex-start; padding: 26px; border-radius: 18px;
    background: #faf8ff; border: 1px solid rgba(var(--accent-rgb), 0.08); transition: border-color .2s;
  }
  .nw-step:hover { border-color: rgba(var(--accent-rgb), 0.25); }
  .nw-step-num {
    flex: 0 0 auto; width: 44px; height: 44px; border-radius: 13px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800;
  }
  .nw-step-body h3 { font-size: 1.02rem; font-weight: 700; margin: 0 0 6px; }
  .nw-step-body p { font-size: .92rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }

  .nw-solution-chart { padding: 0 0 100px; background: #fff; }
  .nw-chart-card {
    position: relative; max-width: 520px; margin: 0 auto; padding: 32px;
    border-radius: 24px; background: #faf8ff;
    border: 1px solid rgba(var(--accent-rgb), 0.12);
    box-shadow: 0 8px 32px rgba(var(--accent-rgb), 0.08);
  }
  .nw-chart-card-label {
    font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--accent); margin-bottom: 12px;
  }
  .nw-line-up {
    stroke-dasharray: 500; stroke-dashoffset: 500;
    animation: nw-draw 2s ease forwards 0.3s;
  }
  .nw-chart-arrow-up {
    position: absolute; top: 36px; right: 40px;
    background: rgba(var(--accent-rgb), 0.12); display: flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: 50%;
  }

  .nw-final {
    padding: 120px 0; text-align: center;
    background: linear-gradient(160deg, #0c0720 0%, #1a1040 100%);
    color: #fff; position: relative; overflow: hidden;
  }
  .nw-final::before {
    content: ''; position: absolute; width: 500px; height: 500px; border-radius: 50%;
    background: radial-gradient(circle, rgba(var(--accent-rgb), 0.12) 0%, transparent 70%);
    top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none;
  }
  .nw-final-title {
    font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.02em; margin: 0; position: relative;
  }
  .nw-final-sub {
    color: rgba(255,255,255,0.6); margin: 16px 0 0; font-size: 1.1rem;
    max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; position: relative;
  }
  .nw-cta-light { background: #fff; color: #0c0720; }
  .nw-cta-light:hover { background: #f0edff; box-shadow: 0 14px 40px rgba(255,255,255,0.15); }

  @media (max-width: 720px) {
    .nw-hero { padding: 100px 0 80px; }
    .nw-hero-grid { grid-template-columns: 1fr; text-align: center; }
    .nw-hero-copy { display: flex; flex-direction: column; align-items: center; }
    .nw-h1 { max-width: none; }
    .nw-pain { padding: 72px 0 64px; }
    .nw-solution { padding: 64px 0 72px; }
    .nw-feat-row { grid-template-columns: 1fr; gap: 16px; }
    .nw-stats { padding: 56px 0; }
    .nw-stats-row { gap: 36px; }
    .nw-how { padding: 72px 0; }
    .nw-solution-chart { padding: 0 0 72px; }
    .nw-final { padding: 88px 0; }
  }
</style>
