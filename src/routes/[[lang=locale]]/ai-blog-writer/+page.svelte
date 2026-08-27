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
  import '$lib/styles/landing.css';

  let { data } = $props();
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const waitlistActive = $derived(data.waitlistActive);
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const loggedIn = $derived(Boolean(data.session));
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));
  const tk = 'landing.aiBlogWriter';

  const FEATURES = ['dailyArticles', 'contentPlan', 'autoPublish', 'backlinks', 'llmTracking', 'geoAudit'] as const;
  const STEPS = ['s1', 's2', 's3'] as const;
  const BEFORE_ITEMS = ['i1', 'i2', 'i3', 'i4', 'i5'] as const;
  const AFTER_ITEMS = ['i1', 'i2', 'i3', 'i4', 'i5'] as const;
  const STATS = ['s1', 's2', 's3'] as const;
  const FAQ_ITEMS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] as const;

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
          '@id': `${siteUrl}/ai-blog-writer`,
          url: `${siteUrl}/ai-blog-writer`,
          name: $_('meta.aiBlogWriter.title'),
          description: $_('meta.aiBlogWriter.description'),
          publisher: { '@id': `${siteUrl}/#org` },
          inLanguage: $locale ?? 'en'
        },
        {
          '@type': 'SoftwareApplication',
          name: 'Anomalia — AI Blog Writer',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          url: `${siteUrl}/ai-blog-writer`,
          description: $_('meta.aiBlogWriter.description'),
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
            { '@type': 'ListItem', position: 2, name: 'AI Blog Writer', item: `${siteUrl}/ai-blog-writer` }
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
  <title>{$_('meta.aiBlogWriter.title')}</title>
  <meta name="description" content={$_('meta.aiBlogWriter.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('meta.aiBlogWriter.title')} />
  <meta property="og:description" content={$_('meta.aiBlogWriter.description')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:title" content={$_('meta.aiBlogWriter.title')} />
  <meta name="twitter:description" content={$_('meta.aiBlogWriter.description')} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">

  <!-- ============ HERO ============ -->
  <section class="gr-hero">
    <div class="wrap gr-hero-inner">
      <span class="eyebrow reveal">{$_(`${tk}.hero.eyebrow`)}</span>
      <h1 class="abw-h1 reveal" data-d="1">
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

  <!-- ============ HOW IT WORKS ============ -->
  <section class="abw-how">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.how.kicker`)}</div>
        <h2>{$_(`${tk}.how.title`)}</h2>
        <p>{$_(`${tk}.how.sub`)}</p>
      </div>
      <div class="abw-steps">
        {#each STEPS as k, i (k)}
          <div class="abw-step reveal" data-d={i + 1}>
            <span class="abw-step-n">{String(i + 1).padStart(2, '0')}</span>
            <h3>{$_(`${tk}.how.${k}.title`)}</h3>
            <p>{$_(`${tk}.how.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ FEATURES GRID ============ -->
  <section class="abw-features">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.features.kicker`)}</div>
        <h2>{$_(`${tk}.features.title`)}</h2>
      </div>
      <div class="abw-feat-grid">
        {#each FEATURES as k, i (k)}
          <div class="abw-feat reveal" data-d={(i % 3) + 1}>
            <div class="abw-feat-icon" aria-hidden="true">
              {#if k === 'dailyArticles'}📝{:else if k === 'contentPlan'}📅{:else if k === 'autoPublish'}🚀{:else if k === 'backlinks'}🔗{:else if k === 'llmTracking'}🤖{:else}⚙️{/if}
            </div>
            <h3>{$_(`${tk}.features.${k}.title`)}</h3>
            <p>{$_(`${tk}.features.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ STATS ============ -->
  <section class="abw-stats">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker on-dark">{$_(`${tk}.stats.kicker`)}</div>
        <h2>{$_(`${tk}.stats.title`)}</h2>
      </div>
      <div class="abw-stats-grid">
        {#each STATS as k, i (k)}
          <div class="abw-stat reveal" data-d={i + 1}>
            <span class="abw-stat-num">{$_(`${tk}.stats.${k}.num`)}</span>
            <span class="abw-stat-lbl">{$_(`${tk}.stats.${k}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ BEFORE / AFTER ============ -->
  <section class="abw-compare">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.compare.kicker`)}</div>
        <h2>{$_(`${tk}.compare.title`)}</h2>
      </div>
      <div class="abw-cmp-grid">
        <div class="abw-cmp before reveal" data-d="1">
          <div class="abw-cmp-label">{$_(`${tk}.compare.before.label`)}</div>
          <ul>
            {#each BEFORE_ITEMS as k (k)}
              <li><span class="abw-cmp-ic x" aria-hidden="true">✕</span>{$_(`${tk}.compare.before.${k}`)}</li>
            {/each}
          </ul>
        </div>
        <div class="abw-cmp after reveal" data-d="2">
          <div class="abw-cmp-label">{$_(`${tk}.compare.after.label`)}</div>
          <ul>
            {#each AFTER_ITEMS as k (k)}
              <li><span class="abw-cmp-ic ok" aria-hidden="true">✓</span>{$_(`${tk}.compare.after.${k}`)}</li>
            {/each}
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ CONTENT EXAMPLE ============ -->
  <section class="abw-example">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.example.kicker`)}</div>
        <h2>{$_(`${tk}.example.title`)}</h2>
        <p>{$_(`${tk}.example.sub`)}</p>
      </div>
      <div class="abw-example-grid">
        <div class="abw-example-card reveal" data-d="1">
          <div class="abw-example-tag">{$_(`${tk}.example.tag1`)}</div>
          <div class="abw-example-title">{$_(`${tk}.example.cardTitle`)}</div>
          <div class="abw-example-meta">{$_(`${tk}.example.meta`)}</div>
          <div class="abw-example-body">
            <span class="abw-ex-line" style="width:100%"></span>
            <span class="abw-ex-line" style="width:92%"></span>
            <span class="abw-ex-line" style="width:97%"></span>
            <span class="abw-ex-line" style="width:78%"></span>
            <span class="abw-ex-line" style="width:85%"></span>
            <span class="abw-ex-line" style="width:60%"></span>
          </div>
          <div class="abw-example-footer">
            <span class="abw-example-score">SEO: 96/100</span>
            <span class="abw-example-links">8 internal links</span>
          </div>
        </div>
        <div class="abw-example-info reveal" data-d="2">
          <ul class="abw-example-points">
            {#each ['p1', 'p2', 'p3', 'p4'] as k (k)}
              <li>
                <span class="abw-check" aria-hidden="true">✓</span>
                <span>{$_(`${tk}.example.${k}`)}</span>
              </li>
            {/each}
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ FAQ ============ -->
  <section class="abw-faq">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.faq.kicker`)}</div>
        <h2>{$_(`${tk}.faq.title`)}</h2>
      </div>
      <div class="abw-faq-list">
        {#each FAQ_ITEMS as k, i (k)}
          <div class="abw-faq-item reveal" data-d={(i % 3) + 1}>
            <button class="abw-faq-q" onclick={() => toggleFaq(i)} aria-expanded={openFaq === i}>
              <span>{$_(`${tk}.faq.${k}.q`)}</span>
              <span class="abw-faq-arrow" class:open={openFaq === i}>→</span>
            </button>
            {#if openFaq === i}
              <div class="abw-faq-a">
                <p>{$_(`${tk}.faq.${k}.a`)}</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ FINAL CTA ============ -->
  <section class="abw-final">
    <div class="wrap abw-final-inner reveal">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <div class="gr-actions abw-final-actions">
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
  .abw-h1 {
    font-size: clamp(2.6rem, 6.5vw, 5.2rem);
    font-weight: var(--heading-weight); line-height: 1.04;
    letter-spacing: var(--heading-tracking); margin: 0; max-width: min(100%, 20ch);
    text-wrap: balance;
  }

  /* ---------- HOW IT WORKS ---------- */
  .abw-how { padding: 96px 0; background: var(--paper-2); }
  .abw-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .abw-step { padding: 30px 26px; border-radius: 18px; background: var(--paper); border: 1px solid var(--line); }
  .abw-step-n { font-family: var(--serif); font-size: 1.6rem; font-weight: var(--heading-weight); color: var(--accent); letter-spacing: var(--heading-tracking); display: block; }
  .abw-step h3 { font-family: var(--sans); font-size: 1.1rem; font-weight: 700; margin: 14px 0 0; }
  .abw-step p { font-size: 0.92rem; color: var(--ink-soft); margin-top: 8px; line-height: 1.5; }

  /* ---------- FEATURES ---------- */
  .abw-features { padding: 96px 0; }
  .abw-feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .abw-feat { padding: 30px 26px; border-radius: 18px; border: 1px solid var(--line); background: var(--paper); transition: transform .25s var(--ease), box-shadow .25s var(--ease); }
  .abw-feat:hover { transform: translateY(-3px); box-shadow: 0 16px 34px -22px rgba(var(--accent-rgb), 0.5); }
  .abw-feat-icon { font-size: 1.8rem; margin-bottom: 16px; }
  .abw-feat h3 { font-family: var(--sans); font-size: 1.15rem; font-weight: 700; margin: 0; }
  .abw-feat p { font-size: 0.92rem; color: var(--ink-soft); margin-top: 10px; line-height: 1.5; }

  /* ---------- STATS ---------- */
  .abw-stats { padding: 96px 0; background: var(--invert-surface); color: #fff; }
  .abw-stats :global(.sec-head h2) { color: #fff; }
  .abw-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .abw-stat { padding: 30px 24px; border-radius: 18px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); text-align: center; }
  .abw-stat-num { display: block; font-family: var(--serif); font-size: clamp(2.2rem, 4vw, 3rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); color: var(--accent-2); }
  .abw-stat-lbl { display: block; font-size: 1rem; font-weight: 600; margin-top: 8px; color: rgba(255,255,255,0.8); }

  /* ---------- BEFORE / AFTER ---------- */
  .abw-compare { padding: 96px 0; }
  .abw-cmp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 980px; margin: 0 auto; }
  .abw-cmp { border-radius: 24px; padding: 34px 30px; border: 1px solid var(--line); }
  .abw-cmp.before { background: var(--paper-2); }
  .abw-cmp.after { background: var(--invert-surface); color: #fff; border-color: transparent; box-shadow: 0 30px 60px -30px rgba(var(--accent-rgb), 0.5); }
  .abw-cmp-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 22px; }
  .abw-cmp.before .abw-cmp-label { color: var(--ink-faint); }
  .abw-cmp.after .abw-cmp-label { color: var(--accent-2); }
  .abw-cmp ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 13px; }
  .abw-cmp li { display: flex; align-items: flex-start; gap: 11px; font-size: 0.96rem; line-height: 1.4; }
  .abw-cmp-ic { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; margin-top: 1px; }
  .abw-cmp-ic.x { background: rgba(0,0,0,0.06); color: var(--ink-faint); }
  .abw-cmp-ic.ok { background: rgba(var(--accent-rgb), 0.22); color: var(--accent-2); }

  /* ---------- CONTENT EXAMPLE ---------- */
  .abw-example { padding: 96px 0; background: var(--paper-2); }
  .abw-example-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 40px; align-items: center; max-width: 1000px; margin: 0 auto; }
  .abw-example-card { background: var(--paper); border: 1px solid var(--line); border-radius: 20px; padding: 28px; box-shadow: 0 24px 50px -30px rgba(0,0,0,0.15); }
  .abw-example-tag { display: inline-block; font-size: 11px; font-weight: 700; color: var(--accent); background: rgba(var(--accent-rgb), 0.1); padding: 3px 10px; border-radius: 999px; margin-bottom: 14px; }
  .abw-example-title { font-family: var(--serif); font-size: 1.35rem; font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); line-height: 1.2; }
  .abw-example-meta { font-size: 12px; color: var(--ink-faint); margin-top: 8px; font-weight: 500; }
  .abw-example-body { display: flex; flex-direction: column; gap: 8px; margin-top: 18px; }
  .abw-ex-line { display: block; height: 8px; border-radius: 4px; background: var(--paper-2); }
  .abw-example-footer { display: flex; gap: 16px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
  .abw-example-score { font-size: 12px; font-weight: 700; color: var(--accent); }
  .abw-example-links { font-size: 12px; color: var(--ink-faint); font-weight: 500; }
  .abw-example-points { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 16px; }
  .abw-example-points li { display: flex; gap: 12px; font-size: 1.02rem; line-height: 1.5; color: var(--ink-soft); }
  .abw-check { flex: none; width: 22px; height: 22px; border-radius: 50%; background: rgba(var(--accent-rgb), 0.12); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; margin-top: 2px; }

  /* ---------- FAQ ---------- */
  .abw-faq { padding: 96px 0; }
  .abw-faq-list { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 0; }
  .abw-faq-item { border-bottom: 1px solid var(--line); }
  .abw-faq-q { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 0; background: none; border: none; cursor: pointer; font-family: var(--sans); font-size: 1.05rem; font-weight: 600; color: var(--ink); text-align: left; }
  .abw-faq-arrow { font-size: 18px; color: var(--ink-faint); transition: transform .25s var(--ease), color .25s var(--ease); flex-shrink: 0; }
  .abw-faq-arrow.open { color: var(--accent); transform: rotate(90deg); }
  .abw-faq-a { padding: 0 0 22px; animation: faqIn .3s var(--ease); }
  .abw-faq-a p { font-size: 0.96rem; color: var(--ink-soft); line-height: 1.6; }
  @keyframes faqIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

  /* ---------- FINAL CTA ---------- */
  .abw-final { padding: 120px 0; text-align: center; }
  .abw-final-inner { display: flex; flex-direction: column; align-items: center; }
  .abw-final h2 { font-size: clamp(2rem, 4.5vw, 3.2rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; max-width: 26ch; text-wrap: balance; }
  .abw-final p { color: var(--ink-soft); margin: 18px 0 0; font-size: 1.15rem; max-width: 50ch; line-height: 1.55; }
  .abw-final-actions { margin-top: 34px; }

  /* ---------- RESPONSIVE ---------- */
  @media (max-width: 920px) {
    .abw-steps, .abw-feat-grid { grid-template-columns: repeat(2, 1fr); }
    .abw-stats-grid { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 720px) {
    .abw-how, .abw-features, .abw-stats, .abw-compare, .abw-example, .abw-faq { padding: 64px 0; }
    .abw-cmp-grid { grid-template-columns: 1fr; }
    .abw-example-grid { grid-template-columns: 1fr; }
    .abw-final { padding: 84px 0; }
  }
  @media (max-width: 480px) {
    .abw-steps, .abw-feat-grid, .abw-stats-grid { grid-template-columns: 1fr; }
  }
</style>
