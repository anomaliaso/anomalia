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
  const tk = 'pain.autopilot';
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

<main class="ap-page">
  <section class="ap-hero">
    <div class="ap-hero-grid">
      <div class="ap-hero-copy">
        <span class="ap-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="ap-h1">{$_(`${tk}.headline`)}</h1>
        <p class="ap-sub">{$_(`${tk}.sub`)}</p>
        <a class="ap-cta" href={startHref}>{$_(`${tk}.cta`)} <span class="ap-cta-arr">&rarr;</span></a>
      </div>
      <div class="ap-hero-visual">
        <div class="ap-toggle-wrap">
          <div class="ap-toggle-label ap-toggle-off">OFF</div>
          <div class="ap-toggle">
            <svg class="ap-toggle-svg" viewBox="0 0 200 100" fill="none">
              <rect class="ap-toggle-track" x="4" y="8" width="192" height="84" rx="42" fill="rgba(var(--accent-rgb), 0.08)" stroke="rgba(var(--accent-rgb), 0.2)" stroke-width="2" />
              <rect class="ap-toggle-track-on" x="4" y="8" width="192" height="84" rx="42" fill="rgba(var(--accent-rgb), 0.15)" stroke="var(--accent)" stroke-width="2" />
              <circle class="ap-toggle-knob" cx="50" cy="50" r="34" fill="#fff" stroke="rgba(0,0,0,0.06)" stroke-width="1" />
              <circle class="ap-toggle-knob-on" cx="150" cy="50" r="34" fill="var(--accent)" stroke="rgba(0,0,0,0.06)" stroke-width="1" />
              <path class="ap-toggle-check" d="M136 50l10 10 20-20" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
          <div class="ap-toggle-label ap-toggle-on">ON</div>
        </div>
        <div class="ap-toggle-caption">Autopilot mode</div>
      </div>
    </div>
  </section>

  <section class="ap-pain">
    <div class="ap-wrap">
      <div class="ap-section-head">
        <h2 class="ap-h2">{$_(`${tk}.problem.title`)}</h2>
      </div>
      <div class="ap-pain-grid">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="ap-pain-card">
            <div class="ap-pain-icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 1v16M1 9h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </div>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ap-solution">
    <div class="ap-wrap">
      <div class="ap-section-head">
        <h2 class="ap-h2">{$_(`${tk}.solution.title`)}</h2>
        <p class="ap-section-sub">{$_(`${tk}.solution.sub`)}</p>
      </div>
      <div class="ap-feat-row">
        {#each [1, 2, 3] as i (i)}
          <div class="ap-feat">
            <div class="ap-feat-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ap-stats">
    <div class="ap-wrap">
      <div class="ap-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="ap-stat">
            <span class="ap-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="ap-stat-label">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ap-how">
    <div class="ap-wrap">
      <h2 class="ap-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="ap-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="ap-step">
            <div class="ap-step-num">{i}</div>
            <div class="ap-step-body">
              <h3>{$_(`${tk}.how.s${i}.title`)}</h3>
              <p>{$_(`${tk}.how.s${i}.desc`)}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ap-final">
    <div class="ap-wrap">
      <h2 class="ap-final-title">{$_(`${tk}.final.title`)}</h2>
      <p class="ap-final-sub">{$_(`${tk}.final.sub`)}</p>
      <a class="ap-cta ap-cta-light" href={startHref}>{$_(`${tk}.final.cta`)} <span class="ap-cta-arr">&rarr;</span></a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .ap-wrap { max-width: 960px; margin: 0 auto; padding: 0 24px; }

  .ap-hero {
    position: relative; padding: 140px 0 100px;
    background: linear-gradient(160deg, #0c0720 0%, #1a1040 45%, #0c0720 100%);
    color: #fff; overflow: hidden;
  }
  .ap-hero::before {
    content: ''; position: absolute; width: 600px; height: 600px; border-radius: 50%;
    background: radial-gradient(circle, rgba(var(--accent-rgb), 0.08) 0%, transparent 70%);
    top: -20%; right: -10%; pointer-events: none;
  }
  .ap-hero-grid {
    max-width: 1060px; margin: 0 auto; padding: 0 24px;
    display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center;
  }
  .ap-eyebrow {
    display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.14em; color: rgba(255,255,255,0.5);
    border: 1px solid rgba(255,255,255,0.1); padding: 6px 16px; border-radius: 999px; margin-bottom: 28px;
  }
  .ap-h1 {
    font-size: clamp(2rem, 4.5vw, 3.2rem); font-weight: 800; letter-spacing: -0.03em;
    line-height: 1.08; margin: 0; max-width: 22ch;
  }
  .ap-sub {
    font-size: 1.1rem; line-height: 1.65; color: rgba(255,255,255,0.65);
    margin: 22px 0 0; max-width: 44ch;
  }
  .ap-cta {
    display: inline-flex; align-items: center; gap: 10px; margin-top: 36px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #fff; text-decoration: none; border-radius: 980px; padding: 16px 36px;
    font-size: 16px; font-weight: 700; transition: transform .2s, box-shadow .2s;
  }
  .ap-cta:hover { transform: translateY(-2px); box-shadow: 0 14px 40px rgba(var(--accent-rgb), 0.35); }
  .ap-cta-arr { transition: transform .2s; }
  .ap-cta:hover .ap-cta-arr { transform: translateX(3px); }

  .ap-hero-visual { display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .ap-toggle-wrap { display: flex; align-items: center; gap: 20px; }
  .ap-toggle-label {
    font-size: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    transition: color .4s ease;
  }
  .ap-toggle-off { color: rgba(255,255,255,0.25); }
  .ap-toggle-on { color: var(--accent); }
  .ap-toggle { width: 200px; }
  .ap-toggle-svg { width: 100%; height: auto; }
  .ap-toggle-track-on { opacity: 0; animation: ap-toggle-in 0.6s ease 1s forwards; }
  .ap-toggle-knob { animation: ap-knob-slide 0.6s ease 0.8s forwards; }
  .ap-toggle-knob-on { opacity: 0; animation: ap-knob-appear 0.6s ease 1.2s forwards; }
  .ap-toggle-check { opacity: 0; stroke-dasharray: 60; stroke-dashoffset: 60; animation: ap-check-draw 0.4s ease 1.5s forwards; }
  @keyframes ap-knob-slide { from { cx: 50; } to { cx: 150; opacity: 0; } }
  @keyframes ap-knob-appear { from { opacity: 0; } to { opacity: 1; } }
  @keyframes ap-toggle-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes ap-check-draw { from { stroke-dashoffset: 60; opacity: 0; } to { stroke-dashoffset: 0; opacity: 1; } }
  .ap-toggle-caption {
    margin-top: 16px; font-size: 13px; color: rgba(255,255,255,0.35);
    font-weight: 500; letter-spacing: 0.02em;
  }

  .ap-section-head { text-align: center; margin-bottom: 48px; }
  .ap-h2 {
    font-size: clamp(1.6rem, 3.5vw, 2.2rem); font-weight: 800; letter-spacing: -0.02em;
    margin: 0; text-align: center;
  }
  .ap-section-sub {
    color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; line-height: 1.6;
    max-width: 48ch; margin-left: auto; margin-right: auto; text-align: center;
  }

  .ap-pain { padding: 100px 0 88px; background: #fff; }
  .ap-pain-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 720px; margin: 0 auto;
  }
  .ap-pain-card {
    display: flex; align-items: flex-start; gap: 14px; padding: 22px 24px; border-radius: 14px;
    background: rgba(192,57,43,0.02); border: 1px solid rgba(192,57,43,0.08);
    border-left: 4px solid #c0392b; transition: border-color .2s, background .2s;
  }
  .ap-pain-card:hover { border-color: rgba(192,57,43,0.22); background: rgba(192,57,43,0.05); }
  .ap-pain-icon {
    flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%;
    background: rgba(192,57,43,0.1); color: #c0392b;
    display: flex; align-items: center; justify-content: center;
  }
  .ap-pain-card p { font-size: .95rem; line-height: 1.5; color: var(--ink); margin: 0; }

  .ap-solution { padding: 88px 0 100px; background: #fff; }
  .ap-feat-row {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; max-width: 820px; margin: 0 auto;
  }
  .ap-feat {
    background: #fff; border-radius: 20px; padding: 34px 28px;
    border: 1px solid rgba(var(--accent-rgb), 0.1); box-shadow: 0 2px 16px rgba(0,0,0,0.04);
    transition: transform .25s, box-shadow .25s; text-align: center;
  }
  .ap-feat:hover { transform: translateY(-5px); box-shadow: 0 16px 44px rgba(var(--accent-rgb), 0.12); }
  .ap-feat-icon {
    width: 48px; height: 48px; border-radius: 14px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff;
    display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;
  }
  .ap-feat h3 { font-size: 1.05rem; font-weight: 700; margin: 0 0 10px; letter-spacing: -0.01em; }
  .ap-feat p { font-size: .92rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }

  .ap-stats { padding: 72px 0; background: #0c0720; color: #fff; }
  .ap-stats-row { display: flex; justify-content: center; gap: 64px; flex-wrap: wrap; }
  .ap-stat { text-align: center; }
  .ap-stat-num {
    display: block; font-size: clamp(2rem, 5vw, 3rem); font-weight: 800; letter-spacing: -0.03em;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  }
  .ap-stat-label { font-size: .88rem; color: rgba(255,255,255,0.5); margin-top: 6px; max-width: 20ch; margin-left: auto; margin-right: auto; }

  .ap-how { padding: 100px 0; background: #fff; }
  .ap-steps { display: flex; flex-direction: column; gap: 28px; max-width: 640px; margin: 44px auto 0; }
  .ap-step {
    display: flex; gap: 20px; align-items: flex-start; padding: 26px; border-radius: 18px;
    background: #faf8ff; border: 1px solid rgba(var(--accent-rgb), 0.08); transition: border-color .2s;
  }
  .ap-step:hover { border-color: rgba(var(--accent-rgb), 0.25); }
  .ap-step-num {
    flex: 0 0 auto; width: 44px; height: 44px; border-radius: 13px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800;
  }
  .ap-step-body h3 { font-size: 1.02rem; font-weight: 700; margin: 0 0 6px; }
  .ap-step-body p { font-size: .92rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }

  .ap-final {
    padding: 120px 0; text-align: center;
    background: linear-gradient(160deg, #0c0720 0%, #1a1040 100%);
    color: #fff; position: relative; overflow: hidden;
  }
  .ap-final::before {
    content: ''; position: absolute; width: 500px; height: 500px; border-radius: 50%;
    background: radial-gradient(circle, rgba(var(--accent-rgb), 0.12) 0%, transparent 70%);
    top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none;
  }
  .ap-final-title {
    font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.02em; margin: 0; position: relative;
  }
  .ap-final-sub {
    color: rgba(255,255,255,0.6); margin: 16px 0 0; font-size: 1.1rem;
    max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; position: relative;
  }
  .ap-cta-light { background: #fff; color: #0c0720; }
  .ap-cta-light:hover { background: #f0edff; box-shadow: 0 14px 40px rgba(255,255,255,0.15); }

  @media (max-width: 720px) {
    .ap-hero { padding: 100px 0 80px; }
    .ap-hero-grid { grid-template-columns: 1fr; text-align: center; }
    .ap-hero-copy { display: flex; flex-direction: column; align-items: center; }
    .ap-h1 { max-width: none; }
    .ap-pain { padding: 72px 0 64px; }
    .ap-pain-grid { grid-template-columns: 1fr; }
    .ap-solution { padding: 64px 0 72px; }
    .ap-feat-row { grid-template-columns: 1fr; gap: 16px; }
    .ap-stats { padding: 56px 0; }
    .ap-stats-row { gap: 36px; }
    .ap-how { padding: 72px 0; }
    .ap-final { padding: 88px 0; }
    .ap-toggle-wrap { gap: 12px; }
    .ap-toggle { width: 140px; }
  }
</style>
