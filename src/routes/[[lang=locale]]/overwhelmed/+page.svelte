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
  const tk = 'pain.overwhelmed';
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
  <!-- HERO: notification stack -->
  <section class="ov-hero">
    <div class="ov-wrap ov-hero-inner">
      <div class="ov-hero-text">
        <span class="ov-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="ov-h1">{$_(`${tk}.headline`)}</h1>
        <p class="ov-sub">{$_(`${tk}.sub`)}</p>
        <a class="ov-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      </div>
      <div class="ov-notif-stack" aria-hidden="true">
        <div class="ov-notif n1"><span class="ov-notif-dot"></span>Instagram: 3 posts due today</div>
        <div class="ov-notif n2"><span class="ov-notif-dot"></span>TikTok: No content this week</div>
        <div class="ov-notif n3"><span class="ov-notif-dot"></span>Facebook: Engagement dropping</div>
        <div class="ov-notif n4"><span class="ov-notif-dot"></span>LinkedIn: 2 weeks inactive</div>
        <div class="ov-notif n5"><span class="ov-notif-dot"></span>X: Missed trending topic</div>
        <div class="ov-notif n6"><span class="ov-notif-dot"></span>Threads: Competitor posting daily</div>
        <div class="ov-notif n7"><span class="ov-notif-dot"></span>YouTube: Shorts backlog empty</div>
      </div>
    </div>
  </section>

  <!-- PAIN: notification list -->
  <section class="ov-pain">
    <div class="ov-wrap">
      <h2 class="ov-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="ov-pain-list">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="ov-pain-item">
            <span class="ov-pain-badge" aria-hidden="true">!</span>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- SOLUTION: organized cards -->
  <section class="ov-solution">
    <div class="ov-wrap">
      <h2 class="ov-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="ov-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="ov-feat-row">
        {#each [1, 2, 3] as i (i)}
          <div class="ov-feat">
            <div class="ov-feat-icon"><BrandMark size={20} /></div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- STATS -->
  <section class="ov-stats">
    <div class="ov-wrap">
      <div class="ov-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="ov-stat">
            <span class="ov-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="ov-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- HOW -->
  <section class="ov-how">
    <div class="ov-wrap">
      <h2 class="ov-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="ov-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="ov-step">
            <span class="ov-step-n">{i}</span>
            <div><h3>{$_(`${tk}.how.s${i}.title`)}</h3><p>{$_(`${tk}.how.s${i}.desc`)}</p></div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- FINAL -->
  <section class="ov-final">
    <div class="ov-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="ov-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .ov-wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }

  /* HERO: notification stack */
  .ov-hero { padding: 100px 0 80px; background: var(--paper); }
  .ov-hero-inner { display: flex; align-items: center; gap: 64px; }
  .ov-hero-text { flex: 1; min-width: 0; }
  .ov-eyebrow { display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); background: rgba(var(--accent-rgb), 0.08); padding: 5px 14px; border-radius: 999px; margin-bottom: 20px; }
  .ov-h1 { font-size: clamp(2rem, 4.5vw, 3rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); line-height: 1.08; margin: 0; overflow-wrap: break-word; }
  .ov-sub { font-size: 1.1rem; line-height: 1.6; color: var(--ink-soft); margin: 18px 0 0; max-width: 42ch; }
  .ov-cta { display: inline-flex; margin-top: 28px; background: var(--invert-surface); color: #fff; text-decoration: none; border-radius: 980px; padding: 14px 32px; font-size: 15px; font-weight: 700; transition: transform 0.15s, box-shadow 0.15s; }
  .ov-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }

  /* Notification stack */
  .ov-notif-stack { flex-shrink: 0; width: 320px; display: flex; flex-direction: column; gap: 8px; }
  .ov-notif { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 12px; background: var(--paper); border: 1px solid var(--line); font-size: 13px; font-weight: 600; color: var(--ink); box-shadow: 0 2px 8px rgba(0,0,0,0.04); animation: ov-slide 0.5s ease both; }
  .ov-notif.n1 { animation-delay: 0.1s; }
  .ov-notif.n2 { animation-delay: 0.2s; }
  .ov-notif.n3 { animation-delay: 0.3s; }
  .ov-notif.n4 { animation-delay: 0.4s; }
  .ov-notif.n5 { animation-delay: 0.5s; }
  .ov-notif.n6 { animation-delay: 0.6s; }
  .ov-notif.n7 { animation-delay: 0.7s; }
  @keyframes ov-slide { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: none; } }
  .ov-notif-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }

  /* PAIN */
  .ov-pain { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .ov-h2 { font-size: clamp(1.5rem, 3.5vw, 2.1rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0 0 36px; text-align: center; overflow-wrap: break-word; }
  .ov-pain-list { display: flex; flex-direction: column; gap: 12px; max-width: 600px; margin: 0 auto; }
  .ov-pain-item { display: flex; align-items: center; gap: 14px; padding: 18px 22px; border-radius: 14px; background: var(--paper); border: 1px solid var(--line); }
  .ov-pain-badge { flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; background: rgba(var(--accent-rgb), 0.12); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; }
  .ov-pain-item p { font-size: 0.92rem; line-height: 1.45; color: var(--ink); margin: 0; }

  /* SOLUTION */
  .ov-solution { padding: 80px 0; background: var(--paper); }
  .ov-sol-sub { text-align: center; color: var(--ink-soft); margin: 0 0 40px; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; }
  .ov-feat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .ov-feat { padding: 28px 24px; border-radius: 16px; border: 1px solid var(--line); background: var(--paper); transition: box-shadow 0.2s; }
  .ov-feat:hover { box-shadow: 0 8px 24px rgba(var(--accent-rgb), 0.08); }
  .ov-feat-icon { width: 40px; height: 40px; border-radius: 10px; background: rgba(var(--accent-rgb), 0.1); display: flex; align-items: center; justify-content: center; margin-bottom: 16px; }
  .ov-feat-icon :global(.brandmark path) { fill: var(--accent); }
  .ov-feat h3 { font-size: 1rem; font-weight: 700; margin: 0 0 8px; }
  .ov-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }

  /* STATS */
  .ov-stats { padding: 64px 0; background: var(--invert-surface); color: #fff; }
  .ov-stats-row { display: flex; justify-content: center; gap: 56px; flex-wrap: wrap; }
  .ov-stat { text-align: center; }
  .ov-stat-num { display: block; font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; color: var(--accent-2, #9d86ff); }
  .ov-stat-lbl { font-size: 0.85rem; color: rgba(255,255,255,0.55); margin-top: 4px; }

  /* HOW */
  .ov-how { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .ov-steps { display: flex; flex-direction: column; gap: 20px; max-width: 600px; margin: 0 auto; }
  .ov-step { display: flex; gap: 18px; align-items: flex-start; padding: 22px; border-radius: 14px; background: var(--paper); border: 1px solid var(--line); }
  .ov-step-n { flex: 0 0 auto; width: 36px; height: 36px; border-radius: 50%; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700; }
  .ov-step h3 { font-size: 0.95rem; font-weight: 700; margin: 0 0 4px; }
  .ov-step p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.5; margin: 0; }

  /* FINAL */
  .ov-final { padding: 100px 0; text-align: center; background: var(--paper); border-top: 1px solid var(--line); }
  .ov-final h2 { font-size: clamp(1.7rem, 3.5vw, 2.4rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; overflow-wrap: break-word; }
  .ov-final p { color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; }

  @media (max-width: 720px) {
    .ov-hero { padding: 64px 0 48px; }
    .ov-hero-inner { flex-direction: column; text-align: center; gap: 40px; }
    .ov-sub { margin-left: auto; margin-right: auto; }
    .ov-notif-stack { width: 100%; max-width: 320px; }
    .ov-pain, .ov-solution, .ov-how { padding: 56px 0; }
    .ov-feat-row { grid-template-columns: 1fr; }
    .ov-stats { padding: 48px 0; }
    .ov-stats-row { gap: 32px; }
    .ov-final { padding: 72px 0; }
  }
</style>
