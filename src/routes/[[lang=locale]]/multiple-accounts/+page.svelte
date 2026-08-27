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
  const tk = 'pain.multipleAccounts';
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

<main class="ma-page">
  <section class="ma-hero">
    <div class="ma-hero-grid">
      <div class="ma-hero-copy">
        <span class="ma-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="ma-h1">{$_(`${tk}.headline`)}</h1>
        <p class="ma-sub">{$_(`${tk}.sub`)}</p>
        <a class="ma-cta" href={startHref}>{$_(`${tk}.cta`)} <span class="ma-cta-arr">&rarr;</span></a>
      </div>
      <div class="ma-hero-visual">
        <div class="ma-board ma-board-messy">
          <div class="ma-tile ma-t1"><span class="ma-tile-icon">IG</span><span class="ma-tile-name">Instagram</span></div>
          <div class="ma-tile ma-t2"><span class="ma-tile-icon">TT</span><span class="ma-tile-name">TikTok</span></div>
          <div class="ma-tile ma-t3"><span class="ma-tile-icon">FB</span><span class="ma-tile-name">Facebook</span></div>
          <div class="ma-tile ma-t4"><span class="ma-tile-icon">LI</span><span class="ma-tile-name">LinkedIn</span></div>
          <div class="ma-tile ma-t5"><span class="ma-tile-icon">X</span><span class="ma-tile-name">X</span></div>
          <div class="ma-tile ma-t6"><span class="ma-tile-icon">TH</span><span class="ma-tile-name">Threads</span></div>
          <div class="ma-tile ma-t7"><span class="ma-tile-icon">YT</span><span class="ma-tile-name">YouTube</span></div>
        </div>
        <div class="ma-board-arrow">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><path d="M8 24h28m0 0l-10-10m10 10l-10 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="ma-board ma-board-organized">
          <div class="ma-tile ma-t1"><span class="ma-tile-icon">IG</span><span class="ma-tile-name">Instagram</span></div>
          <div class="ma-tile ma-t2"><span class="ma-tile-icon">TT</span><span class="ma-tile-name">TikTok</span></div>
          <div class="ma-tile ma-t3"><span class="ma-tile-icon">FB</span><span class="ma-tile-name">Facebook</span></div>
          <div class="ma-tile ma-t4"><span class="ma-tile-icon">LI</span><span class="ma-tile-name">LinkedIn</span></div>
          <div class="ma-tile ma-t5"><span class="ma-tile-icon">X</span><span class="ma-tile-name">X</span></div>
          <div class="ma-tile ma-t6"><span class="ma-tile-icon">TH</span><span class="ma-tile-name">Threads</span></div>
          <div class="ma-tile ma-t7"><span class="ma-tile-icon">YT</span><span class="ma-tile-name">YouTube</span></div>
        </div>
      </div>
    </div>
  </section>

  <section class="ma-pain">
    <div class="ma-wrap">
      <div class="ma-section-head">
        <span class="ma-badge ma-badge-red">{$_(`${tk}.problem.eyebrow`) ?? 'The problem'}</span>
        <h2 class="ma-h2">{$_(`${tk}.problem.title`)}</h2>
      </div>
      <div class="ma-pain-grid">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="ma-pain-card">
            <span class="ma-pain-icon" aria-hidden="true">&times;</span>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ma-solution">
    <div class="ma-wrap">
      <div class="ma-section-head">
        <span class="ma-badge ma-badge-purple">{$_(`${tk}.solution.eyebrow`) ?? 'The solution'}</span>
        <h2 class="ma-h2">{$_(`${tk}.solution.title`)}</h2>
        <p class="ma-section-sub">{$_(`${tk}.solution.sub`)}</p>
      </div>
      <div class="ma-feat-row">
        {#each [1, 2, 3] as i (i)}
          <div class="ma-feat">
            <div class="ma-feat-num">{i}</div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ma-stats">
    <div class="ma-wrap">
      <div class="ma-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="ma-stat">
            <span class="ma-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="ma-stat-label">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ma-how">
    <div class="ma-wrap">
      <h2 class="ma-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="ma-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="ma-step">
            <div class="ma-step-num">{i}</div>
            <div class="ma-step-body">
              <h3>{$_(`${tk}.how.s${i}.title`)}</h3>
              <p>{$_(`${tk}.how.s${i}.desc`)}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ma-final">
    <div class="ma-wrap">
      <h2 class="ma-final-title">{$_(`${tk}.final.title`)}</h2>
      <p class="ma-final-sub">{$_(`${tk}.final.sub`)}</p>
      <a class="ma-cta ma-cta-light" href={startHref}>{$_(`${tk}.final.cta`)} <span class="ma-cta-arr">&rarr;</span></a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .ma-wrap { max-width: 960px; margin: 0 auto; padding: 0 24px; }

  .ma-hero {
    position: relative;
    padding: 140px 0 100px;
    background: linear-gradient(160deg, #0c0720 0%, #1a1040 45%, #0c0720 100%);
    color: #fff;
    overflow: hidden;
  }
  .ma-hero-grid {
    max-width: 1060px; margin: 0 auto; padding: 0 24px;
    display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center;
  }
  .ma-eyebrow {
    display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.14em; color: rgba(255,255,255,0.5);
    border: 1px solid rgba(255,255,255,0.1); padding: 6px 16px; border-radius: 999px; margin-bottom: 28px;
  }
  .ma-h1 {
    font-size: clamp(2rem, 4.5vw, 3.2rem); font-weight: 800; letter-spacing: -0.03em;
    line-height: 1.08; margin: 0; max-width: 22ch;
  }
  .ma-sub {
    font-size: 1.1rem; line-height: 1.65; color: rgba(255,255,255,0.65);
    margin: 22px 0 0; max-width: 44ch;
  }
  .ma-cta {
    display: inline-flex; align-items: center; gap: 10px; margin-top: 36px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #fff; text-decoration: none; border-radius: 980px; padding: 16px 36px;
    font-size: 16px; font-weight: 700; transition: transform .2s, box-shadow .2s;
  }
  .ma-cta:hover { transform: translateY(-2px); box-shadow: 0 14px 40px rgba(124,92,255,0.35); }
  .ma-cta-arr { transition: transform .2s; }
  .ma-cta:hover .ma-cta-arr { transform: translateX(3px); }

  .ma-hero-visual {
    display: flex; align-items: center; justify-content: center; gap: 20px;
  }
  .ma-board {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;
    padding: 20px; border-radius: 20px; background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
  }
  .ma-board-messy .ma-tile { opacity: 0.7; }
  .ma-board-messy .ma-t1 { transform: rotate(-4deg) translateY(-6px); }
  .ma-board-messy .ma-t2 { transform: rotate(3deg) translateX(8px); }
  .ma-board-messy .ma-t3 { transform: rotate(-2deg) translateY(5px); }
  .ma-board-messy .ma-t4 { transform: rotate(5deg) translateX(-4px); }
  .ma-board-messy .ma-t5 { transform: rotate(-6deg) translateY(-3px); }
  .ma-board-messy .ma-t6 { transform: rotate(4deg) translateX(6px); }
  .ma-board-messy .ma-t7 { transform: rotate(-3deg) translateY(4px); }
  .ma-board-organized { background: rgba(var(--accent-rgb), 0.06); border-color: rgba(var(--accent-rgb), 0.18); }
  .ma-board-organized .ma-tile { transform: none; opacity: 1; }
  .ma-board-arrow { color: rgba(255,255,255,0.3); flex-shrink: 0; }
  .ma-tile {
    width: 80px; height: 68px; border-radius: 14px;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
    font-weight: 700; transition: transform .3s, opacity .3s;
  }
  .ma-tile-icon { font-size: 13px; letter-spacing: 0.04em; }
  .ma-tile-name { font-size: 9px; opacity: 0.6; font-weight: 500; }
  .ma-t1 { background: linear-gradient(135deg, #e1306c, #f77737); }
  .ma-t2 { background: #010101; }
  .ma-t3 { background: linear-gradient(135deg, #1877f2, #42a5f5); }
  .ma-t4 { background: #0a66c2; }
  .ma-t5 { background: #000; }
  .ma-t6 { background: #000; }
  .ma-t7 { background: #ff0000; }

  .ma-section-head { text-align: center; margin-bottom: 48px; }
  .ma-badge {
    display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.12em; padding: 5px 14px; border-radius: 999px; margin-bottom: 16px;
  }
  .ma-badge-red { color: #c0392b; background: rgba(192,57,43,0.07); }
  .ma-badge-purple { color: var(--accent); background: rgba(var(--accent-rgb), 0.08); }
  .ma-h2 {
    font-size: clamp(1.6rem, 3.5vw, 2.2rem); font-weight: 800; letter-spacing: -0.02em;
    margin: 0; text-align: center;
  }
  .ma-section-sub {
    color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; line-height: 1.6;
    max-width: 48ch; margin-left: auto; margin-right: auto; text-align: center;
  }

  .ma-pain { padding: 100px 0 88px; background: #fff; }
  .ma-pain-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 720px; margin: 0 auto;
  }
  .ma-pain-card {
    display: flex; align-items: flex-start; gap: 14px; padding: 22px 24px; border-radius: 14px;
    background: rgba(192,57,43,0.02); border: 1px solid rgba(192,57,43,0.08);
    border-left: 4px solid #c0392b; transition: border-color .2s, background .2s;
  }
  .ma-pain-card:hover { border-color: rgba(192,57,43,0.22); background: rgba(192,57,43,0.05); }
  .ma-pain-icon {
    flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%;
    background: rgba(192,57,43,0.1); color: #c0392b;
    display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700;
  }
  .ma-pain-card p { font-size: .95rem; line-height: 1.5; color: var(--ink); margin: 0; }

  .ma-solution { padding: 88px 0 100px; background: #fff; }
  .ma-feat-row {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; max-width: 820px; margin: 0 auto;
  }
  .ma-feat {
    background: #fff; border-radius: 20px; padding: 34px 28px;
    border: 1px solid rgba(var(--accent-rgb), 0.1); box-shadow: 0 2px 16px rgba(0,0,0,0.04);
    transition: transform .25s, box-shadow .25s;
  }
  .ma-feat:hover { transform: translateY(-5px); box-shadow: 0 16px 44px rgba(var(--accent-rgb), 0.12); }
  .ma-feat-num {
    width: 38px; height: 38px; border-radius: 11px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 800; margin-bottom: 20px;
  }
  .ma-feat h3 { font-size: 1.05rem; font-weight: 700; margin: 0 0 10px; letter-spacing: -0.01em; }
  .ma-feat p { font-size: .92rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }

  .ma-stats { padding: 72px 0; background: #0c0720; color: #fff; }
  .ma-stats-row { display: flex; justify-content: center; gap: 64px; flex-wrap: wrap; }
  .ma-stat { text-align: center; }
  .ma-stat-num {
    display: block; font-size: clamp(2rem, 5vw, 3rem); font-weight: 800; letter-spacing: -0.03em;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  }
  .ma-stat-label { font-size: .88rem; color: rgba(255,255,255,0.5); margin-top: 6px; max-width: 20ch; margin-left: auto; margin-right: auto; }

  .ma-how { padding: 100px 0; background: #fff; }
  .ma-steps { display: flex; flex-direction: column; gap: 28px; max-width: 640px; margin: 44px auto 0; }
  .ma-step {
    display: flex; gap: 20px; align-items: flex-start; padding: 26px; border-radius: 18px;
    background: #faf8ff; border: 1px solid rgba(var(--accent-rgb), 0.08); transition: border-color .2s;
  }
  .ma-step:hover { border-color: rgba(var(--accent-rgb), 0.25); }
  .ma-step-num {
    flex: 0 0 auto; width: 44px; height: 44px; border-radius: 13px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800;
  }
  .ma-step-body h3 { font-size: 1.02rem; font-weight: 700; margin: 0 0 6px; }
  .ma-step-body p { font-size: .92rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }

  .ma-final {
    padding: 120px 0; text-align: center;
    background: linear-gradient(160deg, #0c0720 0%, #1a1040 100%);
    color: #fff; position: relative; overflow: hidden;
  }
  .ma-final::before {
    content: ''; position: absolute; width: 500px; height: 500px; border-radius: 50%;
    background: radial-gradient(circle, rgba(var(--accent-rgb), 0.12) 0%, transparent 70%);
    top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none;
  }
  .ma-final-title {
    font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.02em; margin: 0; position: relative;
  }
  .ma-final-sub {
    color: rgba(255,255,255,0.6); margin: 16px 0 0; font-size: 1.1rem;
    max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; position: relative;
  }
  .ma-cta-light { background: #fff; color: #0c0720; }
  .ma-cta-light:hover { background: #f0edff; box-shadow: 0 14px 40px rgba(255,255,255,0.15); }

  @media (max-width: 720px) {
    .ma-hero { padding: 100px 0 80px; }
    .ma-hero-grid { grid-template-columns: 1fr; text-align: center; }
    .ma-hero-copy { display: flex; flex-direction: column; align-items: center; }
    .ma-h1 { max-width: none; }
    .ma-hero-visual { flex-direction: column; }
    .ma-board-arrow { transform: rotate(90deg); }
    .ma-board { grid-template-columns: repeat(2, 1fr); }
    .ma-pain { padding: 72px 0 64px; }
    .ma-pain-grid { grid-template-columns: 1fr; }
    .ma-solution { padding: 64px 0 72px; }
    .ma-feat-row { grid-template-columns: 1fr; gap: 16px; }
    .ma-stats { padding: 56px 0; }
    .ma-stats-row { gap: 36px; }
    .ma-how { padding: 72px 0; }
    .ma-final { padding: 88px 0; }
  }
</style>
