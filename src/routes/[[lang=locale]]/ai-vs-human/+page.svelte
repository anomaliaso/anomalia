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
  const tk = 'pain.aiVsHuman';
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

<main class="ah-page">
  <section class="ah-hero">
    <div class="ah-hero-inner">
      <span class="ah-eyebrow">{$_(`${tk}.eyebrow`)}</span>
      <h1 class="ah-h1">{$_(`${tk}.headline`)}</h1>
      <p class="ah-sub">{$_(`${tk}.sub`)}</p>
      <a class="ah-cta" href={startHref}>{$_(`${tk}.cta`)} <span class="ah-cta-arr">&rarr;</span></a>
    </div>
    <div class="ah-compare">
      <div class="ah-side ah-side-human">
        <div class="ah-side-header">
          <svg class="ah-side-icon" width="28" height="28" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="10" r="5" stroke="currentColor" stroke-width="2"/><path d="M4 24c0-5.5 4.5-10 10-10s10 4.5 10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <span class="ah-side-label">Human</span>
        </div>
        <ul class="ah-list">
          <li class="ah-li ah-li-limited"><span class="ah-li-dot"></span>3-5 posts per week</li>
          <li class="ah-li ah-li-limited"><span class="ah-li-dot"></span>1-2 platforms</li>
          <li class="ah-li ah-li-limited"><span class="ah-li-dot"></span>Business hours only</li>
          <li class="ah-li ah-li-limited"><span class="ah-li-dot"></span>Burnout risk</li>
          <li class="ah-li ah-li-limited"><span class="ah-li-dot"></span>Inconsistent voice</li>
        </ul>
      </div>
      <div class="ah-vs">VS</div>
      <div class="ah-side ah-side-ai">
        <div class="ah-side-header">
          <svg class="ah-side-icon" width="28" height="28" viewBox="0 0 28 28" fill="none"><rect x="4" y="4" width="20" height="20" rx="4" stroke="currentColor" stroke-width="2"/><circle cx="10" cy="12" r="2" fill="currentColor"/><circle cx="18" cy="12" r="2" fill="currentColor"/><path d="M10 18h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 2v2m0 18v2M2 14h2m18 0h2M5.6 5.6l1.4 1.4m14 14l1.4 1.4m0-16.8l-1.4 1.4m-14 14l-1.4 1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <span class="ah-side-label">AI with Anomalia</span>
        </div>
        <ul class="ah-list">
          <li class="ah-li ah-li-unlimited"><span class="ah-li-dot"></span>30+ posts per week</li>
          <li class="ah-li ah-li-unlimited"><span class="ah-li-dot"></span>All platforms at once</li>
          <li class="ah-li ah-li-unlimited"><span class="ah-li-dot"></span>24/7 automation</li>
          <li class="ah-li ah-li-unlimited"><span class="ah-li-dot"></span>Zero burnout</li>
          <li class="ah-li ah-li-unlimited"><span class="ah-li-dot"></span>On-brand always</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="ah-pain">
    <div class="ah-wrap">
      <div class="ah-section-head">
        <h2 class="ah-h2">{$_(`${tk}.problem.title`)}</h2>
      </div>
      <div class="ah-pain-grid">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="ah-pain-card">
            <span class="ah-pain-icon" aria-hidden="true">&times;</span>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ah-solution">
    <div class="ah-wrap">
      <div class="ah-section-head">
        <h2 class="ah-h2">{$_(`${tk}.solution.title`)}</h2>
        <p class="ah-section-sub">{$_(`${tk}.solution.sub`)}</p>
      </div>
      <div class="ah-feat-row">
        {#each [1, 2, 3] as i (i)}
          <div class="ah-feat">
            <div class="ah-feat-num">{i}</div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ah-stats">
    <div class="ah-wrap">
      <div class="ah-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="ah-stat">
            <span class="ah-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="ah-stat-label">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ah-how">
    <div class="ah-wrap">
      <h2 class="ah-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="ah-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="ah-step">
            <div class="ah-step-num">{i}</div>
            <div class="ah-step-body">
              <h3>{$_(`${tk}.how.s${i}.title`)}</h3>
              <p>{$_(`${tk}.how.s${i}.desc`)}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ah-final">
    <div class="ah-wrap">
      <h2 class="ah-final-title">{$_(`${tk}.final.title`)}</h2>
      <p class="ah-final-sub">{$_(`${tk}.final.sub`)}</p>
      <a class="ah-cta ah-cta-light" href={startHref}>{$_(`${tk}.final.cta`)} <span class="ah-cta-arr">&rarr;</span></a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .ah-wrap { max-width: 960px; margin: 0 auto; padding: 0 24px; }

  .ah-hero {
    position: relative; padding: 140px 0 80px;
    background: linear-gradient(160deg, #0a0c1a 0%, #111530 45%, #0a0c1a 100%);
    color: #fff; overflow: hidden; text-align: center;
  }
  .ah-hero-inner { max-width: 700px; margin: 0 auto; padding: 0 24px; }
  .ah-eyebrow {
    display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.14em; color: rgba(255,255,255,0.5);
    border: 1px solid rgba(255,255,255,0.1); padding: 6px 16px; border-radius: 999px; margin-bottom: 28px;
  }
  .ah-h1 {
    font-size: clamp(2rem, 4.5vw, 3.2rem); font-weight: 800; letter-spacing: -0.03em;
    line-height: 1.08; margin: 0; max-width: 22ch; margin-left: auto; margin-right: auto;
  }
  .ah-sub {
    font-size: 1.1rem; line-height: 1.65; color: rgba(255,255,255,0.65);
    margin: 22px auto 0; max-width: 44ch;
  }
  .ah-cta {
    display: inline-flex; align-items: center; gap: 10px; margin-top: 36px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #fff; text-decoration: none; border-radius: 980px; padding: 16px 36px;
    font-size: 16px; font-weight: 700; transition: transform .2s, box-shadow .2s;
  }
  .ah-cta:hover { transform: translateY(-2px); box-shadow: 0 14px 40px rgba(var(--accent-rgb), 0.35); }
  .ah-cta-arr { transition: transform .2s; }
  .ah-cta:hover .ah-cta-arr { transform: translateX(3px); }

  .ah-compare {
    display: grid; grid-template-columns: 1fr auto 1fr; gap: 20px;
    max-width: 820px; margin: 60px auto 0; padding: 0 24px; align-items: stretch;
  }
  .ah-side {
    border-radius: 24px; padding: 32px 28px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
  }
  .ah-side-human { border-color: rgba(192,57,43,0.2); background: rgba(192,57,43,0.03); }
  .ah-side-ai { border-color: rgba(var(--accent-rgb), 0.3); background: rgba(var(--accent-rgb), 0.05); box-shadow: 0 0 60px -20px rgba(var(--accent-rgb), 0.2); }
  .ah-side-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
  .ah-side-icon { flex-shrink: 0; }
  .ah-side-human .ah-side-icon { color: rgba(255,255,255,0.4); }
  .ah-side-ai .ah-side-icon { color: var(--accent); }
  .ah-side-label { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
  .ah-side-human .ah-side-label { color: rgba(255,255,255,0.5); }
  .ah-side-ai .ah-side-label { color: #fff; }
  .ah-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; }
  .ah-li { display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 500; }
  .ah-li-limited { color: rgba(255,255,255,0.35); }
  .ah-li-unlimited { color: rgba(255,255,255,0.85); }
  .ah-li-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  }
  .ah-li-limited .ah-li-dot { background: rgba(192,57,43,0.4); }
  .ah-li-unlimited .ah-li-dot { background: var(--accent); box-shadow: 0 0 8px rgba(var(--accent-rgb), 0.5); }
  .ah-vs {
    align-self: center; font-size: 14px; font-weight: 800; letter-spacing: 0.1em;
    color: rgba(255,255,255,0.2); writing-mode: vertical-lr; text-orientation: mixed;
  }

  .ah-section-head { text-align: center; margin-bottom: 48px; }
  .ah-h2 {
    font-size: clamp(1.6rem, 3.5vw, 2.2rem); font-weight: 800; letter-spacing: -0.02em;
    margin: 0; text-align: center;
  }
  .ah-section-sub {
    color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; line-height: 1.6;
    max-width: 48ch; margin-left: auto; margin-right: auto; text-align: center;
  }

  .ah-pain { padding: 100px 0 88px; background: #fff; }
  .ah-pain-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 720px; margin: 0 auto;
  }
  .ah-pain-card {
    display: flex; align-items: flex-start; gap: 14px; padding: 22px 24px; border-radius: 14px;
    background: rgba(192,57,43,0.02); border: 1px solid rgba(192,57,43,0.08);
    border-left: 4px solid #c0392b; transition: border-color .2s, background .2s;
  }
  .ah-pain-card:hover { border-color: rgba(192,57,43,0.22); background: rgba(192,57,43,0.05); }
  .ah-pain-icon {
    flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%;
    background: rgba(192,57,43,0.1); color: #c0392b;
    display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700;
  }
  .ah-pain-card p { font-size: .95rem; line-height: 1.5; color: var(--ink); margin: 0; }

  .ah-solution { padding: 88px 0 100px; background: #fff; }
  .ah-feat-row {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; max-width: 820px; margin: 0 auto;
  }
  .ah-feat {
    background: #fff; border-radius: 20px; padding: 34px 28px;
    border: 1px solid rgba(var(--accent-rgb), 0.1); box-shadow: 0 2px 16px rgba(0,0,0,0.04);
    transition: transform .25s, box-shadow .25s;
  }
  .ah-feat:hover { transform: translateY(-5px); box-shadow: 0 16px 44px rgba(var(--accent-rgb), 0.12); }
  .ah-feat-num {
    width: 38px; height: 38px; border-radius: 11px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 800; margin-bottom: 20px;
  }
  .ah-feat h3 { font-size: 1.05rem; font-weight: 700; margin: 0 0 10px; letter-spacing: -0.01em; }
  .ah-feat p { font-size: .92rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }

  .ah-stats { padding: 72px 0; background: #0a0c1a; color: #fff; }
  .ah-stats-row { display: flex; justify-content: center; gap: 64px; flex-wrap: wrap; }
  .ah-stat { text-align: center; }
  .ah-stat-num {
    display: block; font-size: clamp(2rem, 5vw, 3rem); font-weight: 800; letter-spacing: -0.03em;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  }
  .ah-stat-label { font-size: .88rem; color: rgba(255,255,255,0.5); margin-top: 6px; max-width: 20ch; margin-left: auto; margin-right: auto; }

  .ah-how { padding: 100px 0; background: #fff; }
  .ah-steps { display: flex; flex-direction: column; gap: 28px; max-width: 640px; margin: 44px auto 0; }
  .ah-step {
    display: flex; gap: 20px; align-items: flex-start; padding: 26px; border-radius: 18px;
    background: #faf8ff; border: 1px solid rgba(var(--accent-rgb), 0.08); transition: border-color .2s;
  }
  .ah-step:hover { border-color: rgba(var(--accent-rgb), 0.25); }
  .ah-step-num {
    flex: 0 0 auto; width: 44px; height: 44px; border-radius: 13px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800;
  }
  .ah-step-body h3 { font-size: 1.02rem; font-weight: 700; margin: 0 0 6px; }
  .ah-step-body p { font-size: .92rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }

  .ah-final {
    padding: 120px 0; text-align: center;
    background: linear-gradient(160deg, #0c0720 0%, #1a1040 100%);
    color: #fff; position: relative; overflow: hidden;
  }
  .ah-final::before {
    content: ''; position: absolute; width: 500px; height: 500px; border-radius: 50%;
    background: radial-gradient(circle, rgba(var(--accent-rgb), 0.12) 0%, transparent 70%);
    top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none;
  }
  .ah-final-title {
    font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.02em; margin: 0; position: relative;
  }
  .ah-final-sub {
    color: rgba(255,255,255,0.6); margin: 16px 0 0; font-size: 1.1rem;
    max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; position: relative;
  }
  .ah-cta-light { background: #fff; color: #0c0720; }
  .ah-cta-light:hover { background: #f0edff; box-shadow: 0 14px 40px rgba(255,255,255,0.15); }

  @media (max-width: 720px) {
    .ah-hero { padding: 100px 0 60px; }
    .ah-compare { grid-template-columns: 1fr; gap: 16px; margin-top: 40px; }
    .ah-vs { writing-mode: horizontal-tb; padding: 8px 0; }
    .ah-pain { padding: 72px 0 64px; }
    .ah-pain-grid { grid-template-columns: 1fr; }
    .ah-solution { padding: 64px 0 72px; }
    .ah-feat-row { grid-template-columns: 1fr; gap: 16px; }
    .ah-stats { padding: 56px 0; }
    .ah-stats-row { gap: 36px; }
    .ah-how { padding: 72px 0; }
    .ah-final { padding: 88px 0; }
  }
</style>
