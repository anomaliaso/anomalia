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
  const tk = 'pain.noTime';
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
  <!-- HERO: large clock illustration + headline -->
  <section class="nt-hero">
    <div class="nt-wrap nt-hero-inner">
      <div class="nt-hero-text">
        <span class="nt-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="nt-h1">{$_(`${tk}.headline`)}</h1>
        <p class="nt-sub">{$_(`${tk}.sub`)}</p>
        <a class="nt-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      </div>
      <div class="nt-hero-clock" aria-hidden="true">
        <svg viewBox="0 0 200 200" fill="none">
          <circle cx="100" cy="100" r="90" stroke="var(--line)" stroke-width="2"/>
          <circle cx="100" cy="100" r="90" stroke="var(--accent)" stroke-width="3" stroke-dasharray="420" stroke-dashoffset="320" stroke-linecap="round" class="nt-clock-progress"/>
          {#each Array.from({length: 12}) as _, h}
            <line x1="100" y1={h % 3 === 0 ? 16 : 22} x2="100" y2="28" stroke="var(--ink)" stroke-width={h % 3 === 0 ? 2.5 : 1} transform={`rotate(${h * 30} 100 100)`} opacity={h % 3 === 0 ? 0.8 : 0.3}/>
          {/each}
          <line x1="100" y1="100" x2="100" y2="40" stroke="var(--ink)" stroke-width="3" stroke-linecap="round" class="nt-hand-h"/>
          <line x1="100" y1="100" x2="100" y2="28" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" class="nt-hand-m"/>
          <circle cx="100" cy="100" r="5" fill="var(--accent)"/>
        </svg>
        <div class="nt-clock-label">
          <span class="nt-clock-lost">5h+</span>
          <span class="nt-clock-text">lost / week</span>
        </div>
      </div>
    </div>
  </section>

  <!-- PAIN: hours lost per activity -->
  <section class="nt-pain">
    <div class="nt-wrap">
      <h2 class="nt-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="nt-pain-bars">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="nt-bar">
            <div class="nt-bar-fill" style={`width: ${30 + i * 15}%`}></div>
            <div class="nt-bar-content">
              <span class="nt-bar-h">-{i}h</span>
              <p>{$_(`${tk}.problem.b${i}`)}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- SOLUTION: time regained -->
  <section class="nt-solution">
    <div class="nt-wrap">
      <h2 class="nt-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="nt-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="nt-feat-row">
        {#each [1, 2, 3] as i (i)}
          <div class="nt-feat">
            <div class="nt-feat-icon">
              <BrandMark size={20} />
            </div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- STATS -->
  <section class="nt-stats">
    <div class="nt-wrap">
      <div class="nt-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="nt-stat">
            <span class="nt-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="nt-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- HOW -->
  <section class="nt-how">
    <div class="nt-wrap">
      <h2 class="nt-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="nt-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="nt-step">
            <span class="nt-step-n">{i}</span>
            <div><h3>{$_(`${tk}.how.s${i}.title`)}</h3><p>{$_(`${tk}.how.s${i}.desc`)}</p></div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- FINAL -->
  <section class="nt-final">
    <div class="nt-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="nt-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .nt-wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }

  /* HERO: split with clock */
  .nt-hero { padding: 100px 0 80px; background: var(--paper); }
  .nt-hero-inner { display: flex; align-items: center; gap: 64px; }
  .nt-hero-text { flex: 1; min-width: 0; }
  .nt-eyebrow { display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); background: rgba(var(--accent-rgb), 0.08); padding: 5px 14px; border-radius: 999px; margin-bottom: 20px; }
  .nt-h1 { font-size: clamp(2rem, 4.5vw, 3rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); line-height: 1.08; margin: 0; overflow-wrap: break-word; }
  .nt-sub { font-size: 1.1rem; line-height: 1.6; color: var(--ink-soft); margin: 18px 0 0; max-width: 42ch; }
  .nt-cta { display: inline-flex; margin-top: 28px; background: var(--invert-surface); color: #fff; text-decoration: none; border-radius: 980px; padding: 14px 32px; font-size: 15px; font-weight: 700; transition: transform 0.15s, box-shadow 0.15s; }
  .nt-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
  .nt-hero-clock { flex-shrink: 0; width: 200px; height: 200px; position: relative; }
  .nt-hero-clock svg { width: 100%; height: 100%; }
  .nt-clock-progress { animation: nt-dash 4s ease-in-out infinite; }
  @keyframes nt-dash { 0% { stroke-dashoffset: 420; } 50% { stroke-dashoffset: 280; } 100% { stroke-dashoffset: 420; } }
  .nt-hand-h { transform-origin: 100px 100px; animation: nt-rotate-h 12s linear infinite; }
  .nt-hand-m { transform-origin: 100px 100px; animation: nt-rotate-m 3s linear infinite; }
  @keyframes nt-rotate-h { to { transform: rotate(360deg); } }
  @keyframes nt-rotate-m { to { transform: rotate(360deg); } }
  .nt-clock-label { position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); text-align: center; background: var(--paper); padding: 6px 16px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  .nt-clock-lost { display: block; font-size: 1.3rem; font-weight: 800; color: var(--accent); }
  .nt-clock-text { font-size: 11px; color: var(--ink-soft); font-weight: 600; }

  /* PAIN: horizontal bars showing hours lost */
  .nt-pain { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .nt-h2 { font-size: clamp(1.5rem, 3.5vw, 2.1rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0 0 36px; text-align: center; overflow-wrap: break-word; }
  .nt-pain-bars { display: flex; flex-direction: column; gap: 14px; max-width: 640px; margin: 0 auto; }
  .nt-bar { position: relative; background: var(--paper); border-radius: 12px; border: 1px solid var(--line); overflow: hidden; min-height: 64px; }
  .nt-bar-fill { position: absolute; inset: 0; background: rgba(var(--accent-rgb), 0.04); border-radius: 12px; transition: width 0.6s ease; }
  .nt-bar-content { position: relative; display: flex; align-items: center; gap: 16px; padding: 16px 20px; }
  .nt-bar-h { flex-shrink: 0; font-size: 1.1rem; font-weight: 800; color: var(--accent); min-width: 36px; }
  .nt-bar-content p { font-size: 0.92rem; line-height: 1.45; color: var(--ink); margin: 0; }

  /* SOLUTION */
  .nt-solution { padding: 80px 0; background: var(--paper); }
  .nt-sol-sub { text-align: center; color: var(--ink-soft); margin: 0 0 40px; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; }
  .nt-feat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .nt-feat { padding: 28px 24px; border-radius: 16px; border: 1px solid var(--line); background: var(--paper); transition: box-shadow 0.2s; }
  .nt-feat:hover { box-shadow: 0 8px 24px rgba(var(--accent-rgb), 0.08); }
  .nt-feat-icon { width: 40px; height: 40px; border-radius: 10px; background: rgba(var(--accent-rgb), 0.1); display: flex; align-items: center; justify-content: center; margin-bottom: 16px; }
  .nt-feat-icon :global(.brandmark path) { fill: var(--accent); }
  .nt-feat h3 { font-size: 1rem; font-weight: 700; margin: 0 0 8px; }
  .nt-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }

  /* STATS */
  .nt-stats { padding: 64px 0; background: var(--invert-surface); color: #fff; }
  .nt-stats-row { display: flex; justify-content: center; gap: 56px; flex-wrap: wrap; }
  .nt-stat { text-align: center; }
  .nt-stat-num { display: block; font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; color: var(--accent-2, #9d86ff); }
  .nt-stat-lbl { font-size: 0.85rem; color: rgba(255,255,255,0.55); margin-top: 4px; }

  /* HOW */
  .nt-how { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .nt-steps { display: flex; flex-direction: column; gap: 20px; max-width: 600px; margin: 0 auto; }
  .nt-step { display: flex; gap: 18px; align-items: flex-start; padding: 22px; border-radius: 14px; background: var(--paper); border: 1px solid var(--line); }
  .nt-step-n { flex: 0 0 auto; width: 36px; height: 36px; border-radius: 50%; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700; }
  .nt-step h3 { font-size: 0.95rem; font-weight: 700; margin: 0 0 4px; }
  .nt-step p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.5; margin: 0; }

  /* FINAL */
  .nt-final { padding: 100px 0; text-align: center; background: var(--paper); border-top: 1px solid var(--line); }
  .nt-final h2 { font-size: clamp(1.7rem, 3.5vw, 2.4rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; overflow-wrap: break-word; }
  .nt-final p { color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; }

  @media (max-width: 720px) {
    .nt-hero { padding: 64px 0 48px; }
    .nt-hero-inner { flex-direction: column; text-align: center; gap: 40px; }
    .nt-sub { margin-left: auto; margin-right: auto; }
    .nt-hero-clock { width: 160px; height: 160px; }
    .nt-pain, .nt-solution, .nt-how { padding: 56px 0; }
    .nt-feat-row { grid-template-columns: 1fr; }
    .nt-stats { padding: 48px 0; }
    .nt-stats-row { gap: 32px; }
    .nt-final { padding: 72px 0; }
  }
</style>
