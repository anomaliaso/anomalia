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
  import { siGooglenews, siRss, siReddit, siX, siThreads } from 'simple-icons';
  import '$lib/styles/landing.css';

  let { data } = $props();
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const waitlistActive = $derived(data.waitlistActive);
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const loggedIn = $derived(Boolean(data.session));
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));
  const tk = 'landing.newsRadar';

  const SOURCES = ['googleNews', 'rss', 'reddit', 'x', 'threads'] as const;
  const STEPS = ['s1', 's2', 's3', 's4'] as const;
  const FEATURES = ['newsToPost', 'newsToArticle', 'customSources', 'replySuggestions', 'trendDetection', 'oneTapApprove'] as const;
  const BEFORE_ITEMS = ['i1', 'i2', 'i3', 'i4', 'i5'] as const;
  const AFTER_ITEMS = ['i1', 'i2', 'i3', 'i4', 'i5'] as const;
  const STATS = ['s1', 's2', 's3'] as const;
  const FAQ_ITEMS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] as const;

  const SOURCE_ICONS: Record<string, { path: string; hex: string }> = {
    googleNews: siGooglenews,
    rss: siRss,
    reddit: siReddit,
    x: siX,
    threads: siThreads
  };

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
          '@id': `${siteUrl}/news-radar`,
          url: `${siteUrl}/news-radar`,
          name: $_('meta.newsRadar.title'),
          description: $_('meta.newsRadar.description'),
          publisher: { '@id': `${siteUrl}/#org` },
          inLanguage: $locale ?? 'en'
        },
        {
          '@type': 'SoftwareApplication',
          name: 'Anomalia — News Radar',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          url: `${siteUrl}/news-radar`,
          description: $_('meta.newsRadar.description'),
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
            { '@type': 'ListItem', position: 2, name: 'News Radar', item: `${siteUrl}/news-radar` }
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
  <title>{$_('meta.newsRadar.title')}</title>
  <meta name="description" content={$_('meta.newsRadar.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('meta.newsRadar.title')} />
  <meta property="og:description" content={$_('meta.newsRadar.description')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:title" content={$_('meta.newsRadar.title')} />
  <meta name="twitter:description" content={$_('meta.newsRadar.description')} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">

  <!-- ============ HERO ============ -->
  <section class="gr-hero">
    <div class="wrap gr-hero-inner">
      <span class="eyebrow reveal">{$_(`${tk}.hero.eyebrow`)}</span>
      <h1 class="nr-h1 reveal" data-d="1">
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

  <!-- ============ SOURCES ============ -->
  <section class="nr-sources">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.sources.kicker`)}</div>
        <h2>{$_(`${tk}.sources.title`)}</h2>
        <p>{$_(`${tk}.sources.sub`)}</p>
      </div>
      <div class="nr-src-grid">
        {#each SOURCES as k, i (k)}
          <div class="nr-src reveal" data-d={i + 1}>
            <div class="nr-src-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28" fill={k === 'reddit' ? '#FF4500' : '#000'}><path d={SOURCE_ICONS[k].path} /></svg>
            </div>
            <h3>{$_(`${tk}.sources.${k}.title`)}</h3>
            <p>{$_(`${tk}.sources.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ HOW IT WORKS ============ -->
  <section class="nr-how">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.how.kicker`)}</div>
        <h2>{$_(`${tk}.how.title`)}</h2>
        <p>{$_(`${tk}.how.sub`)}</p>
      </div>
      <div class="nr-steps">
        {#each STEPS as k, i (k)}
          <div class="nr-step reveal" data-d={(i % 3) + 1}>
            <span class="nr-step-n">{String(i + 1).padStart(2, '0')}</span>
            <h3>{$_(`${tk}.how.${k}.title`)}</h3>
            <p>{$_(`${tk}.how.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ FEATURES ============ -->
  <section class="nr-features">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.features.kicker`)}</div>
        <h2>{$_(`${tk}.features.title`)}</h2>
      </div>
      <div class="nr-feat-grid">
        {#each FEATURES as k, i (k)}
          <div class="nr-feat reveal" data-d={(i % 3) + 1}>
            <div class="nr-feat-icon" aria-hidden="true">
              {#if k === 'newsToPost'}📱{:else if k === 'newsToArticle'}📝{:else if k === 'customSources'}📡{:else if k === 'replySuggestions'}💬{:else if k === 'trendDetection'}📈{:else}✅{/if}
            </div>
            <h3>{$_(`${tk}.features.${k}.title`)}</h3>
            <p>{$_(`${tk}.features.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ EXAMPLE ============ -->
  <section class="nr-example">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.example.kicker`)}</div>
        <h2>{$_(`${tk}.example.title`)}</h2>
        <p>{$_(`${tk}.example.sub`)}</p>
      </div>
      <div class="nr-example-grid">
        <div class="nr-example-card reveal" data-d="1">
          <div class="nr-example-header">
            <div class="nr-example-source">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="#FF4500"><path d={siReddit.path} /></svg>
              <span>{$_(`${tk}.example.source`)}</span>
            </div>
            <div class="nr-example-time">{$_(`${tk}.example.time`)}</div>
          </div>
          <div class="nr-example-news">{$_(`${tk}.example.newsItem`)}</div>
          <div class="nr-example-divider">
            <span>{$_(`${tk}.example.generatedPost`)}</span>
          </div>
          <div class="nr-example-post">{$_(`${tk}.example.postContent`)}</div>
          <div class="nr-example-footer">
            <span class="nr-example-badge">{$_(`${tk}.example.badge`)}</span>
            <span class="nr-example-note">{$_(`${tk}.example.note`)}</span>
          </div>
        </div>
        <div class="nr-example-info reveal" data-d="2">
          <ul class="nr-example-points">
            {#each ['p1', 'p2', 'p3', 'p4'] as k (k)}
              <li>
                <span class="nr-check" aria-hidden="true">✓</span>
                <span>{$_(`${tk}.example.${k}`)}</span>
              </li>
            {/each}
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ STATS ============ -->
  <section class="nr-stats">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker on-dark">{$_(`${tk}.stats.kicker`)}</div>
        <h2>{$_(`${tk}.stats.title`)}</h2>
      </div>
      <div class="nr-stats-grid">
        {#each STATS as k, i (k)}
          <div class="nr-stat reveal" data-d={i + 1}>
            <span class="nr-stat-num">{$_(`${tk}.stats.${k}.num`)}</span>
            <span class="nr-stat-lbl">{$_(`${tk}.stats.${k}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ BEFORE / AFTER ============ -->
  <section class="nr-compare">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.compare.kicker`)}</div>
        <h2>{$_(`${tk}.compare.title`)}</h2>
      </div>
      <div class="nr-cmp-grid">
        <div class="nr-cmp before reveal" data-d="1">
          <div class="nr-cmp-label">{$_(`${tk}.compare.before.label`)}</div>
          <ul>
            {#each BEFORE_ITEMS as k (k)}
              <li><span class="nr-cmp-ic x" aria-hidden="true">✕</span>{$_(`${tk}.compare.before.${k}`)}</li>
            {/each}
          </ul>
        </div>
        <div class="nr-cmp after reveal" data-d="2">
          <div class="nr-cmp-label">{$_(`${tk}.compare.after.label`)}</div>
          <ul>
            {#each AFTER_ITEMS as k (k)}
              <li><span class="nr-cmp-ic ok" aria-hidden="true">✓</span>{$_(`${tk}.compare.after.${k}`)}</li>
            {/each}
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ FAQ ============ -->
  <section class="nr-faq">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.faq.kicker`)}</div>
        <h2>{$_(`${tk}.faq.title`)}</h2>
      </div>
      <div class="nr-faq-list">
        {#each FAQ_ITEMS as k, i (k)}
          <div class="nr-faq-item reveal" data-d={(i % 3) + 1}>
            <button class="nr-faq-q" onclick={() => toggleFaq(i)} aria-expanded={openFaq === i}>
              <span>{$_(`${tk}.faq.${k}.q`)}</span>
              <span class="nr-faq-arrow" class:open={openFaq === i}>→</span>
            </button>
            {#if openFaq === i}
              <div class="nr-faq-a">
                <p>{$_(`${tk}.faq.${k}.a`)}</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ FINAL CTA ============ -->
  <section class="nr-final">
    <div class="wrap nr-final-inner reveal">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <div class="gr-actions nr-final-actions">
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
  .nr-h1 {
    font-size: clamp(2.6rem, 6.5vw, 5.2rem);
    font-weight: var(--heading-weight); line-height: 1.04;
    letter-spacing: var(--heading-tracking); margin: 0; max-width: min(100%, 22ch);
    text-wrap: balance;
  }

  /* ---------- SOURCES ---------- */
  .nr-sources { padding: 96px 0; background: var(--paper-2); }
  .nr-src-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; }
  .nr-src { padding: 28px 20px; border-radius: 18px; background: var(--paper); border: 1px solid var(--line); text-align: center; transition: transform .25s var(--ease), box-shadow .25s var(--ease); }
  .nr-src:hover { transform: translateY(-3px); box-shadow: 0 16px 34px -22px rgba(var(--accent-rgb), 0.5); }
  .nr-src-icon { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; margin: 0 auto 14px; }
  .nr-src h3 { font-family: var(--sans); font-size: 1rem; font-weight: 700; margin: 0; }
  .nr-src p { font-size: 0.85rem; color: var(--ink-soft); margin-top: 8px; line-height: 1.45; }

  /* ---------- HOW IT WORKS ---------- */
  .nr-how { padding: 96px 0; }
  .nr-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
  .nr-step { padding: 30px 26px; border-radius: 18px; background: var(--paper); border: 1px solid var(--line); }
  .nr-step-n { font-family: var(--serif); font-size: 1.6rem; font-weight: var(--heading-weight); color: var(--accent); letter-spacing: var(--heading-tracking); display: block; }
  .nr-step h3 { font-family: var(--sans); font-size: 1.1rem; font-weight: 700; margin: 14px 0 0; }
  .nr-step p { font-size: 0.92rem; color: var(--ink-soft); margin-top: 8px; line-height: 1.5; }

  /* ---------- FEATURES ---------- */
  .nr-features { padding: 96px 0; background: var(--paper-2); }
  .nr-feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .nr-feat { padding: 30px 26px; border-radius: 18px; border: 1px solid var(--line); background: var(--paper); transition: transform .25s var(--ease), box-shadow .25s var(--ease); }
  .nr-feat:hover { transform: translateY(-3px); box-shadow: 0 16px 34px -22px rgba(var(--accent-rgb), 0.5); }
  .nr-feat-icon { font-size: 1.8rem; margin-bottom: 16px; }
  .nr-feat h3 { font-family: var(--sans); font-size: 1.15rem; font-weight: 700; margin: 0; }
  .nr-feat p { font-size: 0.92rem; color: var(--ink-soft); margin-top: 10px; line-height: 1.5; }

  /* ---------- EXAMPLE ---------- */
  .nr-example { padding: 96px 0; }
  .nr-example-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 40px; align-items: center; max-width: 1000px; margin: 0 auto; }
  .nr-example-card { background: var(--paper); border: 1px solid var(--line); border-radius: 20px; padding: 28px; box-shadow: 0 24px 50px -30px rgba(0,0,0,0.15); }
  .nr-example-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
  .nr-example-source { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--ink-soft); }
  .nr-example-time { font-size: 11px; color: var(--ink-faint); font-weight: 500; }
  .nr-example-news { font-size: 0.95rem; line-height: 1.5; color: var(--ink-soft); padding: 16px; background: var(--paper-2); border-radius: 12px; border-left: 3px solid var(--accent); font-style: italic; }
  .nr-example-divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; }
  .nr-example-divider::before, .nr-example-divider::after { content: ''; flex: 1; height: 1px; background: var(--line); }
  .nr-example-divider span { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); white-space: nowrap; }
  .nr-example-post { font-size: 0.95rem; line-height: 1.6; color: var(--ink); padding: 16px; background: rgba(var(--accent-rgb), 0.06); border-radius: 12px; border: 1px solid rgba(var(--accent-rgb), 0.15); }
  .nr-example-footer { display: flex; align-items: center; gap: 12px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
  .nr-example-badge { font-size: 11px; font-weight: 700; color: var(--accent); background: rgba(var(--accent-rgb), 0.1); padding: 3px 10px; border-radius: 999px; }
  .nr-example-note { font-size: 12px; color: var(--ink-faint); font-weight: 500; }
  .nr-example-points { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 16px; }
  .nr-example-points li { display: flex; gap: 12px; font-size: 1.02rem; line-height: 1.5; color: var(--ink-soft); }
  .nr-check { flex: none; width: 22px; height: 22px; border-radius: 50%; background: rgba(var(--accent-rgb), 0.12); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; margin-top: 2px; }

  /* ---------- STATS ---------- */
  .nr-stats { padding: 96px 0; background: var(--invert-surface); color: #fff; }
  .nr-stats :global(.sec-head h2) { color: #fff; }
  .nr-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .nr-stat { padding: 30px 24px; border-radius: 18px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); text-align: center; }
  .nr-stat-num { display: block; font-family: var(--serif); font-size: clamp(2.2rem, 4vw, 3rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); color: var(--accent-2); }
  .nr-stat-lbl { display: block; font-size: 1rem; font-weight: 600; margin-top: 8px; color: rgba(255,255,255,0.8); }

  /* ---------- BEFORE / AFTER ---------- */
  .nr-compare { padding: 96px 0; background: var(--paper-2); }
  .nr-cmp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 980px; margin: 0 auto; }
  .nr-cmp { border-radius: 24px; padding: 34px 30px; border: 1px solid var(--line); }
  .nr-cmp.before { background: var(--paper); }
  .nr-cmp.after { background: var(--invert-surface); color: #fff; border-color: transparent; box-shadow: 0 30px 60px -30px rgba(var(--accent-rgb), 0.5); }
  .nr-cmp-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 22px; }
  .nr-cmp.before .nr-cmp-label { color: var(--ink-faint); }
  .nr-cmp.after .nr-cmp-label { color: var(--accent-2); }
  .nr-cmp ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 13px; }
  .nr-cmp li { display: flex; align-items: flex-start; gap: 11px; font-size: 0.96rem; line-height: 1.4; }
  .nr-cmp-ic { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; margin-top: 1px; }
  .nr-cmp-ic.x { background: rgba(0,0,0,0.06); color: var(--ink-faint); }
  .nr-cmp-ic.ok { background: rgba(var(--accent-rgb), 0.22); color: var(--accent-2); }

  /* ---------- FAQ ---------- */
  .nr-faq { padding: 96px 0; }
  .nr-faq-list { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 0; }
  .nr-faq-item { border-bottom: 1px solid var(--line); }
  .nr-faq-q { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 0; background: none; border: none; cursor: pointer; font-family: var(--sans); font-size: 1.05rem; font-weight: 600; color: var(--ink); text-align: left; }
  .nr-faq-arrow { font-size: 18px; color: var(--ink-faint); transition: transform .25s var(--ease), color .25s var(--ease); flex-shrink: 0; }
  .nr-faq-arrow.open { color: var(--accent); transform: rotate(90deg); }
  .nr-faq-a { padding: 0 0 22px; animation: faqIn .3s var(--ease); }
  .nr-faq-a p { font-size: 0.96rem; color: var(--ink-soft); line-height: 1.6; }
  @keyframes faqIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

  /* ---------- FINAL CTA ---------- */
  .nr-final { padding: 120px 0; text-align: center; }
  .nr-final-inner { display: flex; flex-direction: column; align-items: center; }
  .nr-final h2 { font-size: clamp(2rem, 4.5vw, 3.2rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; max-width: 26ch; text-wrap: balance; }
  .nr-final p { color: var(--ink-soft); margin: 18px 0 0; font-size: 1.15rem; max-width: 50ch; line-height: 1.55; }
  .nr-final-actions { margin-top: 34px; }

  /* ---------- RESPONSIVE ---------- */
  @media (max-width: 920px) {
    .nr-src-grid { grid-template-columns: repeat(3, 1fr); }
    .nr-steps { grid-template-columns: repeat(2, 1fr); }
    .nr-feat-grid { grid-template-columns: repeat(2, 1fr); }
    .nr-stats-grid { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 720px) {
    .nr-sources, .nr-how, .nr-features, .nr-example, .nr-stats, .nr-compare, .nr-faq { padding: 64px 0; }
    .nr-src-grid { grid-template-columns: repeat(3, 1fr); }
    .nr-cmp-grid { grid-template-columns: 1fr; }
    .nr-example-grid { grid-template-columns: 1fr; }
    .nr-final { padding: 84px 0; }
  }
  @media (max-width: 480px) {
    .nr-src-grid, .nr-steps, .nr-feat-grid, .nr-stats-grid { grid-template-columns: 1fr; }
  }
</style>
