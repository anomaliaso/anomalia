<script lang="ts">
  import { onMount } from 'svelte';
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { siInstagram, siTiktok } from 'simple-icons';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import MarcoWidget from '$lib/components/MarcoWidget.svelte';
  import { BOOKING_URL } from '$lib/links';
  import '$lib/styles/landing.css';

  let { data: _data } = $props();
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const tk = 'landing.agosto';
  const cta = $derived($_(`${tk}.cta`));
  const callHref = BOOKING_URL;

  const SI_LINKEDIN = {
    path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z'
  };
  const PLATFORMS = [
    { name: 'Instagram', ic: siInstagram },
    { name: 'TikTok', ic: siTiktok },
    { name: 'LinkedIn', ic: SI_LINKEDIN }
  ];

  const QUEUE = [
    { when: 'oggi', plat: 'instagram', thumb: '/agosto/hero-beach.webp' },
    { when: 'domani', plat: 'tiktok', thumb: '/agosto/couple-sea.webp' },
    { when: '20lug', plat: 'instagram', thumb: '/agosto/founder-relax.webp' }
  ] as const;

  const PLAT_ICON: Record<string, string> = {
    instagram: siInstagram.path,
    tiktok: siTiktok.path
  };

  const siteUrl = $derived($page.url.origin);
  const jsonLd = $derived(
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Anomalia',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: `${siteUrl}${lp('/agosto')}`,
      description: $_('meta.agosto.description')
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
  <title>{$_('meta.agosto.title')}</title>
  <meta name="description" content={$_('meta.agosto.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('meta.agosto.title')} />
  <meta property="og:description" content={$_('meta.agosto.description')} />
  <meta property="og:image" content={`${siteUrl}/agosto/hero-beach.webp`} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={$_('meta.agosto.title')} />
  <meta name="twitter:description" content={$_('meta.agosto.description')} />
  <meta name="twitter:image" content={`${siteUrl}/agosto/hero-beach.webp`} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={callHref} ctaExternal />

<main id="top">

  <!-- ============ FULL-BLEED HERO ============ -->
  <section class="ag-hero" aria-label={$_(`${tk}.hero.aria`)}>
    <img
      class="ag-hero-bg"
      src="/agosto/hero-beach.webp"
      alt=""
      width="1920"
      height="1080"
      fetchpriority="high"
    />
    <div class="ag-hero-veil" aria-hidden="true"></div>
    <div class="wrap ag-hero-inner">
      <div class="ag-brand reveal">
        <BrandMark size={28} />
        <span>Anomalia</span>
      </div>
      <h1 class="ag-h1 reveal" data-d="1">
        {$_(`${tk}.hero.titleLead`)}<br />
        <span class="ag-h1-em">{$_(`${tk}.hero.titleEm`)}</span>
      </h1>
      <p class="ag-sub reveal" data-d="2">{$_(`${tk}.hero.sub`)}</p>
      <div class="ag-actions reveal" data-d="3">
        <a href={callHref} target="_blank" rel="noopener" class="btn btn-primary btn-hero">{cta} <span class="arr">→</span></a>
      </div>
      <p class="ag-note reveal" data-d="3">{$_(`${tk}.hero.note`)}</p>
    </div>
  </section>

  <!-- ============ PROBLEM ============ -->
  <section class="ag-problem">
    <div class="wrap ag-problem-inner">
      <span class="eyebrow reveal">{$_(`${tk}.problem.eyebrow`)}</span>
      <h2 class="ag-h2 reveal" data-d="1">{$_(`${tk}.problem.title`)}</h2>
      <p class="ag-lead reveal" data-d="2">{$_(`${tk}.problem.lead`)}</p>
      <p class="ag-mantra reveal" data-d="3">{$_(`${tk}.problem.mantra`)}</p>
      <div class="ag-actions reveal" data-d="3">
        <a href={callHref} target="_blank" rel="noopener" class="btn btn-primary btn-hero">{cta} <span class="arr">→</span></a>
      </div>
    </div>
  </section>

  <!-- ============ WHAT IT DOES ============ -->
  <section class="ag-does">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.does.kicker`)}</div>
        <h2>{$_(`${tk}.does.title`)}</h2>
      </div>
      <ul class="ag-does-list">
        {#each ['f1', 'f2', 'f3'] as key, i (key)}
          <li class="ag-does-item reveal" data-d={String(i + 1)}>
            <span class="ag-does-mark" aria-hidden="true"><BrandMark size={18} /></span>
            <p>{$_(`${tk}.does.${key}`)}</p>
          </li>
        {/each}
      </ul>
      <div class="ag-mid-cta reveal">
        <a href={callHref} target="_blank" rel="noopener" class="btn btn-primary btn-hero">{cta} <span class="arr">→</span></a>
      </div>
    </div>
  </section>

  <!-- ============ APPROVE IN A TAP ============ -->
  <section class="ag-tap">
    <div class="wrap ag-tap-grid">
      <div class="ag-tap-copy reveal">
        <div class="kicker">{$_(`${tk}.tap.kicker`)}</div>
        <h2 class="ag-h2">{$_(`${tk}.tap.title`)}</h2>
        <p class="ag-lead">{$_(`${tk}.tap.sub`)}</p>
        <ul class="ag-bullets">
          {#each ['b1', 'b2', 'b3'] as key (key)}
            <li>
              <span class="ag-check" aria-hidden="true">/</span>
              {$_(`${tk}.tap.${key}`)}
            </li>
          {/each}
        </ul>
        <a href={callHref} target="_blank" rel="noopener" class="btn btn-primary btn-hero ag-tap-cta">{cta} <span class="arr">→</span></a>
      </div>

      <div class="ag-phone reveal" data-d="2" aria-hidden="true">
        <div class="ag-phone-shell">
          <div class="ag-phone-bar">
            <BrandMark size={16} />
            <span>Anomalia</span>
          </div>
          <p class="ag-phone-headline">{$_(`${tk}.tap.phoneHeadline`)}</p>
          <div class="ag-queue">
            {#each QUEUE as item (item.when)}
              <div class="ag-q-row">
                <img src={item.thumb} alt="" width="48" height="48" loading="lazy" />
                <div class="ag-q-meta">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={PLAT_ICON[item.plat]} /></svg>
                  <span>{$_(`${tk}.tap.${item.when}`)}</span>
                </div>
                <span class="ag-q-btn">{$_(`${tk}.tap.approve`)}</span>
              </div>
            {/each}
          </div>
          <p class="ag-phone-foot">{$_(`${tk}.tap.phoneFoot`)}</p>
        </div>
        <img class="ag-phone-scene" src="/agosto/phone-tap.webp" alt="" width="720" height="900" loading="lazy" />
      </div>
    </div>
  </section>

  <!-- ============ VACATION STRIP ============ -->
  <section class="ag-vacay">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.vacay.kicker`)}</div>
        <h2>{$_(`${tk}.vacay.title`)}</h2>
        <p>{$_(`${tk}.vacay.sub`)}</p>
      </div>
      <div class="ag-vacay-grid">
        <figure class="ag-vacay-card reveal">
          <img src="/agosto/founder-relax.webp" alt="" width="1600" height="900" loading="lazy" />
          <figcaption>
            <span class="ag-vacay-tag">{$_(`${tk}.vacay.c1.tag`)}</span>
            <strong>{$_(`${tk}.vacay.c1.title`)}</strong>
            <p>{$_(`${tk}.vacay.c1.desc`)}</p>
          </figcaption>
        </figure>
        <figure class="ag-vacay-card reveal" data-d="1">
          <img src="/agosto/couple-sea.webp" alt="" width="928" height="1152" loading="lazy" />
          <figcaption>
            <span class="ag-vacay-tag">{$_(`${tk}.vacay.c2.tag`)}</span>
            <strong>{$_(`${tk}.vacay.c2.title`)}</strong>
            <p>{$_(`${tk}.vacay.c2.desc`)}</p>
          </figcaption>
        </figure>
        <figure class="ag-vacay-card reveal" data-d="2">
          <img src="/agosto/hammock.webp" alt="" width="928" height="1152" loading="lazy" />
          <figcaption>
            <span class="ag-vacay-tag">{$_(`${tk}.vacay.c3.tag`)}</span>
            <strong>{$_(`${tk}.vacay.c3.title`)}</strong>
            <p>{$_(`${tk}.vacay.c3.desc`)}</p>
          </figcaption>
        </figure>
      </div>
      <div class="ag-mid-cta reveal">
        <a href={callHref} target="_blank" rel="noopener" class="btn btn-primary btn-hero">{cta} <span class="arr">→</span></a>
      </div>
    </div>
  </section>

  <!-- ============ PLATFORMS ============ -->
  <section class="ag-plats">
    <div class="wrap">
      <p class="ag-plats-kicker reveal">{$_(`${tk}.plats.kicker`)}</p>
      <div class="ag-plats-row reveal" data-d="1">
        {#each PLATFORMS as p (p.name)}
          <span class="ag-plat">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={p.ic.path} /></svg>
            {p.name}
          </span>
        {/each}
      </div>
      <div class="ag-mid-cta reveal" data-d="2">
        <a href={callHref} target="_blank" rel="noopener" class="btn btn-primary btn-hero">{cta} <span class="arr">→</span></a>
      </div>
    </div>
  </section>

  <!-- ============ FINAL ============ -->
  <section class="ag-final">
    <img class="ag-final-bg" src="/agosto/founder-relax.webp" alt="" width="1600" height="900" loading="lazy" />
    <div class="ag-final-veil" aria-hidden="true"></div>
    <div class="wrap ag-final-inner">
      <div class="ag-brand reveal">
        <BrandMark size={24} />
        <span>Anomalia</span>
      </div>
      <h2 class="reveal" data-d="1">{$_(`${tk}.final.title`)}</h2>
      <p class="reveal" data-d="2">{$_(`${tk}.final.sub`)}</p>
      <div class="ag-actions reveal" data-d="3">
        <a href={callHref} target="_blank" rel="noopener" class="btn btn-primary btn-hero">{cta} <span class="arr">→</span></a>
      </div>
      <p class="ag-note reveal" data-d="3">{$_(`${tk}.final.note`)}</p>
    </div>
  </section>
</main>

<SiteFooter
  ctaHref={callHref}
  ctaLabel={cta}
  ctaHeading={$_(`${tk}.final.title`)}
  ctaExternal
/>
<MarcoWidget />

<style>
  /* ---------- HERO ---------- */
  .ag-hero {
    position: relative;
    min-height: min(100svh, 920px);
    display: flex;
    align-items: flex-end;
    overflow: hidden;
    color: #fff;
    padding: 0 0 72px;
  }
  .ag-hero-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 30%;
    transform: scale(1.04);
    animation: ag-drift 18s var(--ease) infinite alternate;
  }
  .ag-hero-veil {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, rgba(17, 17, 17, 0.18) 0%, rgba(17, 17, 17, 0.22) 35%, rgba(17, 17, 17, 0.72) 100%),
      radial-gradient(120% 80% at 70% 20%, rgba(196, 133, 254, 0.18), transparent 55%);
    pointer-events: none;
  }
  .ag-hero-inner {
    position: relative;
    z-index: 1;
    max-width: 920px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .ag-brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .ag-brand :global(.brandmark path) { fill: #fff; }
  .ag-h1 {
    margin: 18px 0 0;
    font-size: clamp(2.6rem, 7vw, 4.6rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    line-height: 1.02;
    text-wrap: balance;
    max-width: 14ch;
  }
  .ag-h1-em {
    color: var(--accent-2);
  }
  .ag-sub {
    margin: 18px 0 0;
    font-size: clamp(1.05rem, 2vw, 1.25rem);
    line-height: 1.55;
    color: rgba(255, 255, 255, 0.82);
    max-width: 36ch;
  }
  .ag-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 28px;
  }
  .ag-problem-inner .ag-actions {
    justify-content: center;
  }
  .ag-mid-cta {
    display: flex;
    justify-content: center;
    margin-top: 40px;
  }
  .ag-note {
    margin: 14px 0 0;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.62);
  }

  /* ---------- PROBLEM ---------- */
  .ag-problem {
    padding: 96px 0 72px;
    background: var(--paper);
  }
  .ag-problem-inner {
    max-width: 780px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .ag-h2 {
    margin: 14px 0 0;
    font-size: clamp(1.8rem, 4vw, 2.8rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    line-height: 1.1;
    text-wrap: balance;
  }
  .ag-lead {
    margin: 18px 0 0;
    font-size: 1.12rem;
    line-height: 1.6;
    color: var(--ink-soft);
    max-width: 48ch;
  }
  .ag-mantra {
    margin: 28px 0 0;
    font-size: clamp(1.15rem, 2.4vw, 1.45rem);
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--ink);
  }

  /* ---------- DOES ---------- */
  .ag-does {
    padding: 40px 0 96px;
    background: var(--paper);
  }
  .ag-does-list {
    list-style: none;
    margin: 36px auto 0;
    padding: 0;
    max-width: 720px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .ag-does-item {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 22px 22px;
    border-top: 1px solid var(--line);
  }
  .ag-does-item:last-child {
    border-bottom: 1px solid var(--line);
  }
  .ag-does-mark {
    flex: 0 0 auto;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(var(--accent-rgb), 0.12);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-top: 2px;
  }
  .ag-does-mark :global(.brandmark path) { fill: var(--accent); }
  .ag-does-item p {
    margin: 0;
    font-size: 1.05rem;
    line-height: 1.5;
    color: var(--ink);
  }

  /* ---------- TAP ---------- */
  .ag-tap {
    padding: 96px 0;
    background: var(--paper-2);
  }
  .ag-tap-grid {
    display: grid;
    grid-template-columns: 1.05fr 0.95fr;
    gap: 48px;
    align-items: center;
  }
  .ag-tap-copy .ag-h2 { text-align: left; }
  .ag-tap-copy .ag-lead { max-width: 40ch; }
  .ag-bullets {
    list-style: none;
    margin: 28px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .ag-bullets li {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    font-size: 1.02rem;
    line-height: 1.45;
    color: var(--ink);
  }
  .ag-check {
    color: var(--accent);
    font-weight: 700;
    font-size: 1.1rem;
    line-height: 1.3;
  }
  .ag-tap-cta { margin-top: 28px; }

  .ag-phone {
    position: relative;
    min-height: 520px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ag-phone-scene {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 28px;
    filter: saturate(1.05);
  }
  .ag-phone-shell {
    position: relative;
    z-index: 1;
    width: min(100%, 320px);
    background: rgba(255, 255, 255, 0.94);
    backdrop-filter: blur(10px);
    border-radius: 28px;
    padding: 18px 16px 20px;
    box-shadow: 0 24px 60px -28px rgba(0, 0, 0, 0.55);
    color: var(--ink);
    animation: ag-float 5.5s ease-in-out infinite;
  }
  .ag-phone-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.92rem;
    font-weight: 700;
  }
  .ag-phone-bar :global(.brandmark path) { fill: var(--ink); }
  .ag-phone-headline {
    margin: 14px 0 0;
    font-size: 1.35rem;
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    line-height: 1.15;
  }
  .ag-queue {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ag-q-row {
    display: grid;
    grid-template-columns: 44px 1fr auto;
    gap: 10px;
    align-items: center;
    padding: 8px;
    border-radius: 14px;
    background: var(--paper-2);
    border: 1px solid var(--line);
  }
  .ag-q-row img {
    width: 44px;
    height: 44px;
    object-fit: cover;
    border-radius: 10px;
  }
  .ag-q-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-soft);
  }
  .ag-q-meta svg {
    width: 12px;
    height: 12px;
    fill: currentColor;
  }
  .ag-q-btn {
    background: var(--accent);
    color: #fff;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 7px 10px;
    border-radius: 980px;
  }
  .ag-phone-foot {
    margin: 14px 0 0;
    text-align: center;
    font-size: 0.78rem;
    color: var(--ink-soft);
    line-height: 1.4;
  }

  /* ---------- VACAY ---------- */
  .ag-vacay {
    padding: 96px 0;
    background: var(--paper);
  }
  .ag-vacay-grid {
    margin-top: 40px;
    display: grid;
    grid-template-columns: 1.2fr 0.9fr 0.9fr;
    gap: 18px;
  }
  .ag-vacay-card {
    margin: 0;
    position: relative;
    overflow: hidden;
    border-radius: 22px;
    min-height: 420px;
    background: var(--paper-3);
  }
  .ag-vacay-card img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.7s var(--ease);
  }
  .ag-vacay-card:hover img {
    transform: scale(1.04);
  }
  .ag-vacay-card figcaption {
    position: absolute;
    inset: auto 0 0 0;
    padding: 28px 22px 22px;
    background: linear-gradient(180deg, transparent, rgba(17, 17, 17, 0.82));
    color: #fff;
  }
  .ag-vacay-tag {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent-2);
    margin-bottom: 8px;
  }
  .ag-vacay-card strong {
    display: block;
    font-size: 1.25rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }
  .ag-vacay-card p {
    margin: 8px 0 0;
    font-size: 0.92rem;
    line-height: 1.45;
    color: rgba(255, 255, 255, 0.75);
  }

  /* ---------- PLATS ---------- */
  .ag-plats {
    padding: 48px 0 72px;
    border-top: 1px solid var(--line);
  }
  .ag-plats-kicker {
    text-align: center;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-faint);
    margin: 0;
  }
  .ag-plats-row {
    margin-top: 22px;
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 28px;
  }
  .ag-plat {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 0.98rem;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .ag-plat svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }

  /* ---------- FINAL ---------- */
  .ag-final {
    position: relative;
    padding: 120px 0;
    overflow: hidden;
    color: #fff;
    text-align: center;
  }
  .ag-final-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 35%;
  }
  .ag-final-veil {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(17, 17, 17, 0.55), rgba(17, 17, 17, 0.78));
  }
  .ag-final-inner {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .ag-final h2 {
    margin: 18px 0 0;
    font-size: clamp(2rem, 5vw, 3.4rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    line-height: 1.05;
    max-width: 16ch;
    text-wrap: balance;
  }
  .ag-final p {
    margin: 16px 0 0;
    font-size: 1.12rem;
    line-height: 1.55;
    color: rgba(255, 255, 255, 0.78);
    max-width: 40ch;
  }

  @keyframes ag-drift {
    from { transform: scale(1.04) translate3d(0, 0, 0); }
    to { transform: scale(1.08) translate3d(-1.2%, -1%, 0); }
  }
  @keyframes ag-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
  }

  @media (max-width: 920px) {
    .ag-tap-grid { grid-template-columns: 1fr; gap: 36px; }
    .ag-vacay-grid { grid-template-columns: 1fr 1fr; }
    .ag-vacay-card:first-child { grid-column: 1 / -1; min-height: 360px; }
    .ag-phone { min-height: 460px; }
  }
  @media (max-width: 640px) {
    .ag-hero { min-height: 88svh; padding-bottom: 56px; align-items: flex-end; }
    .ag-hero-bg { object-position: 62% 28%; transform: scale(1.08); animation: none; }
    .ag-h1 { max-width: none; font-size: clamp(2.2rem, 11vw, 3rem); }
    .ag-problem, .ag-does, .ag-tap, .ag-vacay { padding-left: 0; padding-right: 0; }
    .ag-problem { padding-top: 64px; padding-bottom: 40px; }
    .ag-does { padding-bottom: 64px; }
    .ag-tap, .ag-vacay { padding-top: 64px; padding-bottom: 64px; }
    .ag-vacay-grid { grid-template-columns: 1fr; }
    .ag-vacay-card, .ag-vacay-card:first-child { min-height: 340px; }
    .ag-final { padding: 88px 0; }
    .ag-actions { width: 100%; }
    .ag-actions .btn { width: 100%; justify-content: center; }
  }

  @media (prefers-reduced-motion: reduce) {
    .ag-hero-bg, .ag-phone-shell { animation: none; }
    .ag-vacay-card:hover img { transform: none; }
  }
</style>
