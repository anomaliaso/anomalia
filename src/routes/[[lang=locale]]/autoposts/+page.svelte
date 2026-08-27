<script lang="ts">
  import { onMount } from 'svelte';
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import MarcoWidget from '$lib/components/MarcoWidget.svelte';
  import { BOOKING_URL } from '$lib/links';
  import { marketingStartHref } from '$lib/start-href';
  import { siInstagram, siTiktok, siFacebook, siX } from 'simple-icons';
  import '$lib/styles/landing.css';

  let { data } = $props();
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const waitlistActive = $derived(data.waitlistActive);
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const loggedIn = $derived(Boolean(data.session));
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));
  const tk = 'landing.autoposts';

  const PLATFORMS = ['instagram', 'tiktok', 'facebook', 'linkedin', 'x'] as const;
  const STEPS = ['s1', 's2', 's3', 's4'] as const;
  const FEATURES = ['weeklyPlan', 'onBrandVisuals', 'captionsWritten', 'optimalTiming', 'autoApprove', 'multiPlatform'] as const;
  const BEFORE_ITEMS = ['i1', 'i2', 'i3', 'i4', 'i5'] as const;
  const AFTER_ITEMS = ['i1', 'i2', 'i3', 'i4', 'i5'] as const;
  const STATS = ['s1', 's2', 's3'] as const;
  const FAQ_ITEMS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] as const;

  const PLAT_ICON: Record<string, { path: string; hex: string }> = {
    instagram: siInstagram,
    tiktok: siTiktok,
    facebook: siFacebook,
    x: siX
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

  const siteUrl = $derived($page.url.origin);
  const jsonLd = $derived(
    JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${siteUrl}/#org`,
          name: 'Anomalia',
          url: `${siteUrl}/`,
          logo: `${siteUrl}/icon-512.png`
        },
        {
          '@type': 'WebPage',
          '@id': `${siteUrl}/autoposts`,
          url: `${siteUrl}/autoposts`,
          name: $_('meta.autoposts.title'),
          description: $_('meta.autoposts.description'),
          publisher: { '@id': `${siteUrl}/#org` },
          inLanguage: $locale ?? 'en'
        },
        {
          '@type': 'SoftwareApplication',
          name: 'Anomalia — Autoposts',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          url: `${siteUrl}/autoposts`,
          description: $_('meta.autoposts.description'),
          publisher: { '@id': `${siteUrl}/#org` }
        },
        {
          '@type': 'FAQPage',
          mainEntity: FAQ_ITEMS.map((k) => ({
            '@type': 'Question',
            name: $_(`${tk}.faq.${k}.q`),
            acceptedAnswer: {
              '@type': 'Answer',
              text: $_(`${tk}.faq.${k}.a`)
            }
          }))
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
            { '@type': 'ListItem', position: 2, name: 'Autoposts', item: `${siteUrl}/autoposts` }
          ]
        }
      ]
    })
  );

  let openFaq = $state<number | null>(null);
  function toggleFaq(i: number) {
    openFaq = openFaq === i ? null : i;
  }

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
  <title>{$_('meta.autoposts.title')}</title>
  <meta name="description" content={$_('meta.autoposts.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('meta.autoposts.title')} />
  <meta property="og:description" content={$_('meta.autoposts.description')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:title" content={$_('meta.autoposts.title')} />
  <meta name="twitter:description" content={$_('meta.autoposts.description')} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">

  <!-- ============ HERO ============ -->
  <section class="gr-hero">
    <div class="wrap gr-hero-inner">
      <span class="eyebrow reveal">{$_(`${tk}.hero.eyebrow`)}</span>
      <h1 class="ap-h1 reveal" data-d="1">
        {$_(`${tk}.hero.titleLead`)}<br /><span class="gr-accent">{$_(`${tk}.hero.titleEm`)}</span>
      </h1>
      <p class="gr-sub reveal" data-d="2">{$_(`${tk}.hero.desc`)}</p>
      <div class="gr-actions reveal" data-d="3">
        <a href={startHref} class="btn btn-primary btn-hero">{$_(`${tk}.hero.ctaPrimary`)} <span class="arr">→</span></a>
        <a href={BOOKING_URL} target="_blank" rel="noopener" class="btn btn-ghost gr-ghost">{$_(`${tk}.hero.ctaSecondary`)}</a>
      </div>
      <p class="gr-note reveal" data-d="3">{$_(`${tk}.hero.note`)}</p>
    </div>
  </section>

  <!-- ============ PLATFORMS STRIP ============ -->
  <section class="ap-platforms">
    <div class="wrap">
      <div class="ap-plat-row reveal">
        {#each PLATFORMS as k (k)}
          <span class="ap-plat">
            {#if PLAT_ICON[k]}
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={PLAT_ICON[k].path} /></svg>
            {:else}
              <span class="ap-plat-glyph">in</span>
            {/if}
            <span>{$_(`${tk}.platforms.${k}`)}</span>
          </span>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ SHOWCASE (two marquees) ============ -->
  <section class="ap-showcase">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.showcase.kicker`)}</div>
        <h2>{$_(`${tk}.showcase.title`)}</h2>
        <p>{$_(`${tk}.showcase.sub`)}</p>
      </div>
    </div>
    <div class="ap-marquee reveal" data-d="1">
      <div class="ap-track">
        {#each SHOWCASE as item, i (item.image + '-a' + i)}
          <div class="ap-card">
            <div class="ap-card-head">
              <span class="ap-card-plat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={PLAT_ICON[item.platform]?.path} /></svg></span>
              <span class="ap-card-handle">{item.handle}</span>
            </div>
            <img src={item.image} alt="" loading="lazy" />
          </div>
        {/each}
      </div>
    </div>
    <div class="ap-marquee">
      <div class="ap-track rev">
        {#each [...SHOWCASE].reverse() as item, i (item.image + '-b' + i)}
          <div class="ap-card">
            <div class="ap-card-head">
              <span class="ap-card-plat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={PLAT_ICON[item.platform]?.path} /></svg></span>
              <span class="ap-card-handle">{item.handle}</span>
            </div>
            <img src={item.image} alt="" loading="lazy" />
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ HOW IT WORKS ============ -->
  <section class="ap-how">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.how.kicker`)}</div>
        <h2>{$_(`${tk}.how.title`)}</h2>
        <p>{$_(`${tk}.how.sub`)}</p>
      </div>
      <div class="ap-steps">
        {#each STEPS as k, i (k)}
          <div class="ap-step reveal" data-d={(i % 3) + 1}>
            <span class="ap-step-n">{String(i + 1).padStart(2, '0')}</span>
            <h3>{$_(`${tk}.how.${k}.title`)}</h3>
            <p>{$_(`${tk}.how.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ FEATURES ============ -->
  <section class="ap-features">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.features.kicker`)}</div>
        <h2>{$_(`${tk}.features.title`)}</h2>
      </div>
      <div class="ap-feat-grid">
        {#each FEATURES as k, i (k)}
          <div class="ap-feat reveal" data-d={(i % 3) + 1}>
            <div class="ap-feat-icon" aria-hidden="true">
              {#if k === 'weeklyPlan'}📅{:else if k === 'onBrandVisuals'}🎨{:else if k === 'captionsWritten'}✍️{:else if k === 'optimalTiming'}⏰{:else if k === 'autoApprove'}✅{:else}📱{/if}
            </div>
            <h3>{$_(`${tk}.features.${k}.title`)}</h3>
            <p>{$_(`${tk}.features.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ STATS ============ -->
  <section class="ap-stats">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker on-dark">{$_(`${tk}.stats.kicker`)}</div>
        <h2>{$_(`${tk}.stats.title`)}</h2>
      </div>
      <div class="ap-stats-grid">
        {#each STATS as k, i (k)}
          <div class="ap-stat reveal" data-d={i + 1}>
            <span class="ap-stat-num">{$_(`${tk}.stats.${k}.num`)}</span>
            <span class="ap-stat-lbl">{$_(`${tk}.stats.${k}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ BEFORE / AFTER ============ -->
  <section class="ap-compare">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.compare.kicker`)}</div>
        <h2>{$_(`${tk}.compare.title`)}</h2>
      </div>
      <div class="ap-cmp-grid">
        <div class="ap-cmp before reveal" data-d="1">
          <div class="ap-cmp-label">{$_(`${tk}.compare.before.label`)}</div>
          <ul>
            {#each BEFORE_ITEMS as k (k)}
              <li><span class="ap-cmp-ic x" aria-hidden="true">✕</span>{$_(`${tk}.compare.before.${k}`)}</li>
            {/each}
          </ul>
        </div>
        <div class="ap-cmp after reveal" data-d="2">
          <div class="ap-cmp-label">{$_(`${tk}.compare.after.label`)}</div>
          <ul>
            {#each AFTER_ITEMS as k (k)}
              <li><span class="ap-cmp-ic ok" aria-hidden="true">✓</span>{$_(`${tk}.compare.after.${k}`)}</li>
            {/each}
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ FAQ ============ -->
  <section class="ap-faq">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.faq.kicker`)}</div>
        <h2>{$_(`${tk}.faq.title`)}</h2>
      </div>
      <div class="ap-faq-list">
        {#each FAQ_ITEMS as k, i (k)}
          <div class="ap-faq-item reveal" data-d={(i % 3) + 1}>
            <button class="ap-faq-q" onclick={() => toggleFaq(i)} aria-expanded={openFaq === i}>
              <span>{$_(`${tk}.faq.${k}.q`)}</span>
              <span class="ap-faq-arrow" class:open={openFaq === i}>→</span>
            </button>
            {#if openFaq === i}
              <div class="ap-faq-a">
                <p>{$_(`${tk}.faq.${k}.a`)}</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ FINAL CTA ============ -->
  <section class="ap-final">
    <div class="wrap ap-final-inner reveal">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <div class="gr-actions ap-final-actions">
        <a href={startHref} class="btn btn-primary btn-hero">{$_(`${tk}.final.ctaPrimary`)} <span class="arr">→</span></a>
        <a href={BOOKING_URL} target="_blank" rel="noopener" class="btn btn-ghost gr-ghost">{$_(`${tk}.final.ctaSecondary`)}</a>
      </div>
    </div>
  </section>

</main>

<SiteFooter />
<MarcoWidget />

<style>
  /* ---------- HERO ---------- */
  .ap-h1 {
    font-size: clamp(2.6rem, 6.5vw, 5.2rem);
    font-weight: var(--heading-weight); line-height: 1.04;
    letter-spacing: var(--heading-tracking); margin: 0; max-width: min(100%, 22ch);
    text-wrap: balance;
  }

  /* ---------- PLATFORMS STRIP ---------- */
  .ap-platforms { padding: 48px 0; background: var(--paper-2); }
  .ap-plat-row { display: flex; align-items: center; justify-content: center; gap: 32px; flex-wrap: wrap; }
  .ap-plat { display: flex; align-items: center; gap: 8px; font-size: 0.95rem; font-weight: 600; color: var(--ink-soft); }
  .ap-plat svg { width: 24px; height: 24px; fill: var(--ink-soft); }
  .ap-plat-glyph { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #fff; background: #0a66c2; border-radius: 4px; }

  /* ---------- SHOWCASE MARQUEE ---------- */
  .ap-showcase { padding: 80px 0 96px; overflow: hidden; }
  .ap-marquee { overflow: hidden; padding: 8px 0; }
  .ap-marquee + .ap-marquee { margin-top: 16px; }
  .ap-track { display: flex; gap: 20px; width: max-content; animation: ap-scroll 40s linear infinite; }
  .ap-track.rev { animation-direction: reverse; }
  .ap-track:hover { animation-play-state: paused; }
  @keyframes ap-scroll { to { transform: translateX(-50%); } }

  .ap-card { flex: 0 0 auto; width: 260px; border-radius: 16px; overflow: hidden; background: var(--paper); border: 1px solid var(--line); box-shadow: 0 8px 24px -12px rgba(0,0,0,0.1); transition: transform .25s var(--ease); }
  .ap-card:hover { transform: translateY(-4px); }
  .ap-card-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; }
  .ap-card-plat { width: 18px; height: 18px; display: flex; }
  .ap-card-plat svg { width: 18px; height: 18px; fill: var(--ink-soft); }
  .ap-card-handle { font-size: 13px; font-weight: 600; color: var(--ink); }
  .ap-card img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }

  /* ---------- HOW IT WORKS ---------- */
  .ap-how { padding: 96px 0; background: var(--paper-2); }
  .ap-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
  .ap-step { padding: 30px 26px; border-radius: 18px; background: var(--paper); border: 1px solid var(--line); }
  .ap-step-n { font-family: var(--serif); font-size: 1.6rem; font-weight: var(--heading-weight); color: var(--accent); letter-spacing: var(--heading-tracking); display: block; }
  .ap-step h3 { font-family: var(--sans); font-size: 1.1rem; font-weight: 700; margin: 14px 0 0; }
  .ap-step p { font-size: 0.92rem; color: var(--ink-soft); margin-top: 8px; line-height: 1.5; }

  /* ---------- FEATURES ---------- */
  .ap-features { padding: 96px 0; }
  .ap-feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .ap-feat { padding: 30px 26px; border-radius: 18px; border: 1px solid var(--line); background: var(--paper); transition: transform .25s var(--ease), box-shadow .25s var(--ease); }
  .ap-feat:hover { transform: translateY(-3px); box-shadow: 0 16px 34px -22px rgba(var(--accent-rgb), 0.5); }
  .ap-feat-icon { font-size: 1.8rem; margin-bottom: 16px; }
  .ap-feat h3 { font-family: var(--sans); font-size: 1.15rem; font-weight: 700; margin: 0; }
  .ap-feat p { font-size: 0.92rem; color: var(--ink-soft); margin-top: 10px; line-height: 1.5; }

  /* ---------- STATS ---------- */
  .ap-stats { padding: 96px 0; background: var(--invert-surface); color: #fff; }
  .ap-stats :global(.sec-head h2) { color: #fff; }
  .ap-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .ap-stat { padding: 30px 24px; border-radius: 18px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); text-align: center; }
  .ap-stat-num { display: block; font-family: var(--serif); font-size: clamp(2.2rem, 4vw, 3rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); color: var(--accent-2); }
  .ap-stat-lbl { display: block; font-size: 1rem; font-weight: 600; margin-top: 8px; color: rgba(255,255,255,0.8); }

  /* ---------- BEFORE / AFTER ---------- */
  .ap-compare { padding: 96px 0; background: var(--paper-2); }
  .ap-cmp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 980px; margin: 0 auto; }
  .ap-cmp { border-radius: 24px; padding: 34px 30px; border: 1px solid var(--line); }
  .ap-cmp.before { background: var(--paper); }
  .ap-cmp.after { background: var(--invert-surface); color: #fff; border-color: transparent; box-shadow: 0 30px 60px -30px rgba(var(--accent-rgb), 0.5); }
  .ap-cmp-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 22px; }
  .ap-cmp.before .ap-cmp-label { color: var(--ink-faint); }
  .ap-cmp.after .ap-cmp-label { color: var(--accent-2); }
  .ap-cmp ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 13px; }
  .ap-cmp li { display: flex; align-items: flex-start; gap: 11px; font-size: 0.96rem; line-height: 1.4; }
  .ap-cmp-ic { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; margin-top: 1px; }
  .ap-cmp-ic.x { background: rgba(0,0,0,0.06); color: var(--ink-faint); }
  .ap-cmp-ic.ok { background: rgba(var(--accent-rgb), 0.22); color: var(--accent-2); }

  /* ---------- FAQ ---------- */
  .ap-faq { padding: 96px 0; }
  .ap-faq-list { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 0; }
  .ap-faq-item { border-bottom: 1px solid var(--line); }
  .ap-faq-q { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 0; background: none; border: none; cursor: pointer; font-family: var(--sans); font-size: 1.05rem; font-weight: 600; color: var(--ink); text-align: left; }
  .ap-faq-arrow { font-size: 18px; color: var(--ink-faint); transition: transform .25s var(--ease), color .25s var(--ease); flex-shrink: 0; }
  .ap-faq-arrow.open { color: var(--accent); transform: rotate(90deg); }
  .ap-faq-a { padding: 0 0 22px; animation: faqIn .3s var(--ease); }
  .ap-faq-a p { font-size: 0.96rem; color: var(--ink-soft); line-height: 1.6; }
  @keyframes faqIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

  /* ---------- FINAL CTA ---------- */
  .ap-final { padding: 120px 0; text-align: center; }
  .ap-final-inner { display: flex; flex-direction: column; align-items: center; }
  .ap-final h2 { font-size: clamp(2rem, 4.5vw, 3.2rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; max-width: 26ch; text-wrap: balance; }
  .ap-final p { color: var(--ink-soft); margin: 18px 0 0; font-size: 1.15rem; max-width: 50ch; line-height: 1.55; }
  .ap-final-actions { margin-top: 34px; }

  /* ---------- RESPONSIVE ---------- */
  @media (max-width: 920px) {
    .ap-steps { grid-template-columns: repeat(2, 1fr); }
    .ap-feat-grid { grid-template-columns: repeat(2, 1fr); }
    .ap-stats-grid { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 720px) {
    .ap-how, .ap-features, .ap-stats, .ap-compare, .ap-faq { padding: 64px 0; }
    .ap-showcase { padding: 48px 0 64px; }
    .ap-cmp-grid { grid-template-columns: 1fr; }
    .ap-card { width: 200px; }
    .ap-final { padding: 84px 0; }
  }
  @media (max-width: 480px) {
    .ap-steps, .ap-feat-grid, .ap-stats-grid { grid-template-columns: 1fr; }
    .ap-plat-row { gap: 20px; }
  }
</style>
