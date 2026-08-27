<script lang="ts">
  import { onMount } from 'svelte';
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { siInstagram, siTiktok, siFacebook, siX, siThreads } from 'simple-icons';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import MarcoWidget from '$lib/components/MarcoWidget.svelte';
  import { BOOKING_URL } from '$lib/links';
  import { marketingStartHref } from '$lib/start-href';
  import '$lib/styles/landing.css';

  let { data } = $props();
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const waitlistActive = $derived(data.waitlistActive);
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const loggedIn = $derived(Boolean(data.session));
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));
  const tk = 'landing.grow';

  // Marco's "book a call" Calendly — the exact link the floating MarcoWidget uses.
  const CALL = BOOKING_URL;

  // Social platforms the strip shows. LinkedIn isn't in simple-icons (removed upstream),
  // so its mark is inlined; the rest come from the package.
  const SI_LINKEDIN = { hex: '0A66C2', path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' };
  const SOCIALS = [
    { name: 'Instagram', ic: siInstagram },
    { name: 'LinkedIn', ic: SI_LINKEDIN },
    { name: 'Facebook', ic: siFacebook },
    { name: 'X', ic: siX },
    { name: 'Threads', ic: siThreads }
  ];

  // Real generated posts (same assets the homepage showcases). Two marquee rows scroll
  // in opposite directions; each row repeats its set twice for a seamless loop.
  const PLAT_ICON: Record<string, { path: string }> = {
    instagram: siInstagram,
    tiktok: siTiktok,
    facebook: siFacebook
  };
  const SHOWCASE = [
    { image: '/showcase-gen/flashcamp-1.webp', platform: 'instagram', handle: '@flashcamp' },
    { image: '/showcase-gen/mellon-1.webp', platform: 'instagram', handle: '@mellon.studio' },
    { image: '/showcase-gen/andrea-1.webp', platform: 'instagram', handle: '@andreabuttarelli' },
    { image: '/showcase-gen/flashcamp-2.webp', platform: 'tiktok', handle: '@flashcamp' },
    { image: '/showcase-gen/mellon-2.webp', platform: 'facebook', handle: '@mellon.studio' },
    { image: '/showcase-gen/andrea-2.webp', platform: 'instagram', handle: '@andreabuttarelli' },
    { image: '/showcase-gen/flashcamp-3.webp', platform: 'facebook', handle: '@flashcamp' }
  ];
  const ROW_A = [...SHOWCASE, ...SHOWCASE];
  const ROW_B = [...[...SHOWCASE].reverse(), ...[...SHOWCASE].reverse()];

  const GOALS = ['g1', 'g2', 'g3', 'g4'];
  const CATEGORIES = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];
  const STEPS = ['s1', 's2', 's3', 's4'];
  const BEFORE_ITEMS = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6'];

  // Structured data — mirrors the homepage so /grow can stand on its own in search.
  const siteUrl = $derived($page.url.origin);
  const jsonLd = $derived(
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Anomalia',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: `${siteUrl}${lp('/grow')}`,
      description: $_('meta.grow.description')
    })
  );

  onMount(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  });
</script>

<svelte:head>
  <title>{$_('meta.grow.title')}</title>
  <meta name="description" content={$_('meta.grow.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('meta.grow.title')} />
  <meta property="og:description" content={$_('meta.grow.description')} />
  <meta name="twitter:title" content={$_('meta.grow.title')} />
  <meta name="twitter:description" content={$_('meta.grow.description')} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">

  <!-- ============ HERO (centered) ============ -->
  <section class="gr-hero">
    <div class="wrap gr-hero-inner">
      <span class="eyebrow reveal">{$_(`${tk}.hero.eyebrow`)}</span>
      <h1 class="gr-h1 reveal" data-d="1">
        {$_(`${tk}.hero.titleLead`)}<br /><span class="gr-accent">{$_(`${tk}.hero.titleEm`)}</span>
      </h1>
      <p class="gr-sub reveal" data-d="2">{$_(`${tk}.hero.desc`)}</p>
      <div class="gr-actions reveal" data-d="3">
        <a href={startHref} class="btn btn-primary btn-hero">{$_(`${tk}.hero.ctaPrimary`)} <span class="arr">→</span></a>
        <a href={CALL} target="_blank" rel="noopener" class="btn btn-ghost gr-ghost">{$_(`${tk}.hero.ctaSecondary`)}</a>
      </div>
      <p class="gr-note reveal" data-d="3">{$_(`${tk}.hero.note`)}</p>
    </div>
  </section>

  <!-- ============ SOCIALS STRIP ============ -->
  <section class="gr-socials">
    <div class="wrap">
      <div class="gr-socials-kicker reveal">{$_(`${tk}.socials.kicker`)}</div>
      <div class="gr-socials-row reveal" data-d="1">
        {#each SOCIALS as s (s.name)}
          <span class="gr-soc">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={s.ic.path} /></svg>
            {s.name}
          </span>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ REAL CONTENT (two opposite marquees) ============ -->
  <section class="gr-real">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.real.kicker`)}</div>
        <h2>{$_(`${tk}.real.title`)}</h2>
        <p>{$_(`${tk}.real.sub`)}</p>
      </div>
    </div>
    <div class="gr-marquee reveal" data-d="1">
      <div class="gr-track">
        {#each ROW_A as item, i (item.image + '-a' + i)}
          <div class="gr-card">
            <div class="gr-card-head">
              <span class="gr-card-plat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={PLAT_ICON[item.platform].path} /></svg></span>
              <span class="gr-card-handle">{item.handle}</span>
            </div>
            <img src={item.image} alt="" loading="lazy" />
          </div>
        {/each}
      </div>
    </div>
    <div class="gr-marquee">
      <div class="gr-track rev">
        {#each ROW_B as item, i (item.image + '-b' + i)}
          <div class="gr-card">
            <div class="gr-card-head">
              <span class="gr-card-plat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={PLAT_ICON[item.platform].path} /></svg></span>
              <span class="gr-card-handle">{item.handle}</span>
            </div>
            <img src={item.image} alt="" loading="lazy" />
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ BEFORE / AFTER ============ -->
  <section class="gr-compare">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.compare.kicker`)}</div>
        <h2>{$_(`${tk}.compare.title`)}</h2>
      </div>
      <div class="gr-cmp-grid">
        <div class="gr-cmp before reveal" data-d="1">
          <div class="gr-cmp-label">{$_(`${tk}.compare.before.label`)}</div>
          <div class="gr-cmp-tagline">{$_(`${tk}.compare.before.tagline`)}</div>
          <p class="gr-cmp-sub">{$_(`${tk}.compare.before.sub`)}</p>
          <ul>
            {#each BEFORE_ITEMS as k (k)}
              <li><span class="gr-cmp-ic x" aria-hidden="true">✕</span>{$_(`${tk}.compare.before.${k}`)}</li>
            {/each}
          </ul>
          <div class="gr-cmp-price">
            <span class="gr-cmp-amt">{$_(`${tk}.compare.before.price`)}</span>
            <span class="gr-cmp-pnote">{$_(`${tk}.compare.before.priceNote`)}</span>
          </div>
        </div>
        <div class="gr-cmp after reveal" data-d="2">
          <div class="gr-cmp-label">{$_(`${tk}.compare.after.label`)}</div>
          <div class="gr-cmp-tagline">{$_(`${tk}.compare.after.tagline`)}</div>
          <p class="gr-cmp-sub">{$_(`${tk}.compare.after.sub`)}</p>
          <ul>
            {#each BEFORE_ITEMS as k (k)}
              <li><span class="gr-cmp-ic ok" aria-hidden="true">✓</span>{$_(`${tk}.compare.after.${k}`)}</li>
            {/each}
          </ul>
          <div class="gr-cmp-price">
            <span class="gr-cmp-amt">{$_(`${tk}.compare.after.price`)}</span>
            <span class="gr-cmp-pnote">{$_(`${tk}.compare.after.priceNote`)}</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ TANGIBLE GOALS ============ -->
  <section class="gr-goals">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker on-dark">{$_(`${tk}.goals.kicker`)}</div>
        <h2>{$_(`${tk}.goals.title`)}</h2>
      </div>
      <div class="gr-goals-grid">
        {#each GOALS as k, i (k)}
          <div class="gr-goal reveal" data-d={(i % 3) + 1}>
            <span class="gr-goal-num">{$_(`${tk}.goals.${k}.num`)}</span>
            <span class="gr-goal-lbl">{$_(`${tk}.goals.${k}.label`)}</span>
            <p class="gr-goal-desc">{$_(`${tk}.goals.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ PERFECT FOR ============ -->
  <section class="gr-perfect">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.perfectFor.kicker`)}</div>
        <h2>{$_(`${tk}.perfectFor.title`)}</h2>
      </div>
      <div class="gr-perfect-grid">
        {#each CATEGORIES as k, i (k)}
          <div class="gr-cat reveal" data-d={(i % 3) + 1}>
            <h3>{$_(`${tk}.perfectFor.${k}.name`)}</h3>
            <p>{$_(`${tk}.perfectFor.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ HOW IT WORKS ============ -->
  <section class="gr-how">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.how.kicker`)}</div>
        <h2>{$_(`${tk}.how.title`)}</h2>
      </div>
      <div class="gr-steps">
        {#each STEPS as k, i (k)}
          <div class="gr-step reveal" data-d={(i % 3) + 1}>
            <span class="gr-step-n">{String(i + 1).padStart(2, '0')}</span>
            <h3>{$_(`${tk}.how.${k}.title`)}</h3>
            <p>{$_(`${tk}.how.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ FINAL CTA ============ -->
  <section class="gr-final">
    <div class="wrap gr-final-inner reveal">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <div class="gr-actions gr-final-actions">
        <a href={startHref} class="btn btn-primary btn-hero">{$_(`${tk}.final.ctaPrimary`)} <span class="arr">→</span></a>
        <a href={CALL} target="_blank" rel="noopener" class="btn btn-ghost gr-ghost">{$_(`${tk}.final.ctaSecondary`)}</a>
      </div>
    </div>
  </section>

</main>

<SiteFooter />
<MarcoWidget />

<style>
  /* ---------- HERO (centered, no phone) ---------- */
  .gr-hero { position: relative; padding: 150px 0 80px; text-align: center; overflow: hidden; }
  .gr-hero::before {
    content: ""; position: absolute; top: -10%; left: 50%; transform: translateX(-50%);
    width: 900px; height: 640px; max-width: 100%;
    background: radial-gradient(closest-side, rgba(var(--accent-rgb), 0.14), transparent 70%);
    filter: blur(20px); z-index: -1; pointer-events: none;
  }
  .gr-hero-inner { display: flex; flex-direction: column; align-items: center; }
  .gr-h1 {
    font-size: clamp(3rem, 7.4vw, 6rem);
    font-weight: var(--heading-weight); line-height: 1.04;
    letter-spacing: var(--heading-tracking); margin: 0; max-width: min(100%, 22ch);
    text-wrap: balance;
  }
  .gr-accent {
    background: linear-gradient(120deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  }
  .gr-sub {
    font-size: clamp(1.15rem, 1.8vw, 1.45rem); font-weight: 400; color: var(--ink-soft);
    max-width: 56ch; margin: 28px 0 0; line-height: 1.5; letter-spacing: -0.015em;
  }
  .gr-actions { margin-top: 34px; display: flex; gap: 16px; align-items: center; justify-content: center; flex-wrap: wrap; }
  .gr-ghost {
    border: 1px solid var(--line); border-radius: 980px; color: var(--ink);
    background: var(--paper); padding: 18px 34px; font-size: 16px;
  }
  .gr-ghost:hover { background: var(--paper-2); gap: 6px; }
  .gr-note { margin-top: 18px; font-size: 13px; color: var(--ink-faint); }

  /* ---------- SOCIALS STRIP ---------- */
  .gr-socials { padding: 8px 0 64px; }
  .gr-socials-kicker {
    text-align: center; font-size: 12px; font-weight: 700; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--ink-faint); margin-bottom: 26px;
  }
  .gr-socials-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px 36px; }
  .gr-soc { display: inline-flex; align-items: center; gap: 9px; font-size: 17px; font-weight: 600; color: var(--ink); opacity: 0.82; }
  .gr-soc svg { width: 22px; height: 22px; fill: var(--ink); }

  /* ---------- REAL CONTENT MARQUEES ---------- */
  .gr-real { padding: 80px 0 96px; background: var(--paper-2); overflow: hidden; }
  .gr-marquee { overflow: hidden; padding: 10px 0; -webkit-mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); }
  .gr-track { display: flex; gap: 18px; width: max-content; will-change: transform; animation: gr-scroll 60s linear infinite; }
  .gr-track.rev { animation-direction: reverse; }
  .gr-marquee:hover .gr-track { animation-play-state: paused; }
  @keyframes gr-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  .gr-card {
    flex: 0 0 auto; width: 230px; background: var(--paper); border: 1px solid var(--line);
    border-radius: 18px; overflow: hidden; box-shadow: 0 10px 30px -18px rgba(0,0,0,0.25);
  }
  .gr-card-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; }
  .gr-card-plat svg { width: 16px; height: 16px; fill: var(--ink); display: block; }
  .gr-card-handle { font-size: 13px; font-weight: 600; color: var(--ink-soft); }
  .gr-card img { display: block; width: 100%; aspect-ratio: 4 / 5; object-fit: cover; }

  /* ---------- BEFORE / AFTER ---------- */
  .gr-compare { padding: 96px 0; }
  .gr-cmp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 980px; margin: 0 auto; }
  .gr-cmp { border-radius: 24px; padding: 34px 30px; border: 1px solid var(--line); display: flex; flex-direction: column; }
  .gr-cmp.before { background: var(--paper-2); }
  .gr-cmp.after { background: var(--invert-surface); color: #fff; border-color: transparent; box-shadow: 0 30px 60px -30px rgba(var(--accent-rgb), 0.5); }
  .gr-cmp-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-faint); }
  .gr-cmp.after .gr-cmp-label { color: var(--accent-2); }
  .gr-cmp-tagline { font-family: var(--serif); font-size: 1.5rem; font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin-top: 12px; }
  .gr-cmp-sub { font-size: 0.95rem; color: var(--ink-soft); margin-top: 8px; line-height: 1.45; }
  .gr-cmp.after .gr-cmp-sub { color: rgba(255,255,255,0.6); }
  .gr-cmp ul { list-style: none; margin: 22px 0 0; padding: 0; display: flex; flex-direction: column; gap: 13px; flex: 1; }
  .gr-cmp li { display: flex; align-items: flex-start; gap: 11px; font-size: 0.96rem; line-height: 1.4; }
  .gr-cmp-ic { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; margin-top: 1px; }
  .gr-cmp-ic.x { background: rgba(0,0,0,0.06); color: var(--ink-faint); }
  .gr-cmp-ic.ok { background: rgba(var(--accent-rgb), 0.22); color: var(--accent-2); }
  .gr-cmp-price { margin-top: 28px; padding-top: 22px; border-top: 1px solid var(--line); }
  .gr-cmp.after .gr-cmp-price { border-top-color: rgba(255,255,255,0.14); }
  .gr-cmp-amt { font-family: var(--serif); font-size: 2.4rem; font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); display: inline-flex; align-items: baseline; gap: 10px; }
  .gr-cmp.before .gr-cmp-amt { color: var(--pop); }
  .gr-cmp.after .gr-cmp-amt { color: var(--accent-2); }
  .gr-cmp-pnote { display: block; font-size: 0.85rem; color: var(--ink-soft); margin-top: 4px; }
  .gr-cmp.after .gr-cmp-pnote { color: rgba(255,255,255,0.55); }

  /* ---------- TANGIBLE GOALS ---------- */
  .gr-goals { padding: 96px 0; background: var(--invert-surface); color: #fff; }
  .gr-goals :global(.sec-head h2) { color: #fff; }
  .gr-goals-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
  .gr-goal { padding: 30px 24px; border-radius: 18px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
  .gr-goal-num { display: block; font-family: var(--serif); font-size: clamp(2.2rem, 4vw, 3rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); color: var(--accent-2); }
  .gr-goal-lbl { display: block; font-size: 1rem; font-weight: 700; margin-top: 8px; }
  .gr-goal-desc { font-size: 0.9rem; color: rgba(255,255,255,0.6); margin-top: 8px; line-height: 1.5; }

  /* ---------- PERFECT FOR ---------- */
  .gr-perfect { padding: 96px 0; }
  .gr-perfect-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
  .gr-cat { padding: 26px 22px; border-radius: 18px; border: 1px solid var(--line); background: var(--paper); transition: transform .25s var(--ease), box-shadow .25s var(--ease); }
  .gr-cat:hover { transform: translateY(-3px); box-shadow: 0 16px 34px -22px rgba(var(--accent-rgb), 0.5); }
  .gr-cat h3 { font-family: var(--sans); font-size: 1.05rem; font-weight: 700; margin: 0; }
  .gr-cat p { font-size: 0.9rem; color: var(--ink-soft); margin-top: 8px; line-height: 1.5; }

  /* ---------- HOW IT WORKS ---------- */
  .gr-how { padding: 96px 0; background: var(--paper-2); }
  .gr-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
  .gr-step { padding: 30px 26px; border-radius: 18px; background: var(--paper); border: 1px solid var(--line); }
  .gr-step-n { font-family: var(--serif); font-size: 1.6rem; font-weight: var(--heading-weight); color: var(--accent); letter-spacing: var(--heading-tracking); }
  .gr-step h3 { font-family: var(--sans); font-size: 1.05rem; font-weight: 700; margin: 14px 0 0; }
  .gr-step p { font-size: 0.92rem; color: var(--ink-soft); margin-top: 8px; line-height: 1.5; }

  /* ---------- FINAL CTA ---------- */
  .gr-final { padding: 120px 0; text-align: center; }
  .gr-final-inner { display: flex; flex-direction: column; align-items: center; }
  .gr-final h2 { font-size: clamp(2rem, 4.5vw, 3.2rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; max-width: 26ch; text-wrap: balance; }
  .gr-final p { color: var(--ink-soft); margin: 18px 0 0; font-size: 1.15rem; max-width: 50ch; line-height: 1.55; }
  .gr-final-actions { margin-top: 34px; }

  /* ---------- RESPONSIVE ---------- */
  @media (max-width: 920px) {
    .gr-goals-grid, .gr-perfect-grid, .gr-steps { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 720px) {
    .gr-hero { padding: 116px 0 56px; }
    .gr-compare, .gr-goals, .gr-perfect, .gr-how { padding: 64px 0; }
    .gr-real { padding: 56px 0 64px; }
    .gr-cmp-grid { grid-template-columns: 1fr; }
    .gr-final { padding: 84px 0; }
  }
  @media (max-width: 480px) {
    .gr-goals-grid, .gr-perfect-grid, .gr-steps { grid-template-columns: 1fr; }
  }

  @media (prefers-reduced-motion: reduce) {
    .gr-track { animation: none; }
  }
</style>
