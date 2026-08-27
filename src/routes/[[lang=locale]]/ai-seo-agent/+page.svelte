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
  const tk = 'landing.aiSeoAgent';

  const FEATURES = ['geoAudit', 'blogSeo', 'llmVisibility', 'autoPublish', 'contentPlan', 'technicalSeo'] as const;
  const STEPS = ['s1', 's2', 's3', 's4'] as const;
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
          '@id': `${siteUrl}/ai-seo-agent`,
          url: `${siteUrl}/ai-seo-agent`,
          name: $_('meta.aiSeoAgent.title'),
          description: $_('meta.aiSeoAgent.description'),
          publisher: { '@id': `${siteUrl}/#org` },
          inLanguage: $locale ?? 'en'
        },
        {
          '@type': 'SoftwareApplication',
          name: 'Anomalia — AI SEO Agent',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          url: `${siteUrl}/ai-seo-agent`,
          description: $_('meta.aiSeoAgent.description'),
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
            { '@type': 'ListItem', position: 2, name: 'AI SEO Agent', item: `${siteUrl}/ai-seo-agent` }
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
  <title>{$_('meta.aiSeoAgent.title')}</title>
  <meta name="description" content={$_('meta.aiSeoAgent.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('meta.aiSeoAgent.title')} />
  <meta property="og:description" content={$_('meta.aiSeoAgent.description')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:title" content={$_('meta.aiSeoAgent.title')} />
  <meta name="twitter:description" content={$_('meta.aiSeoAgent.description')} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">

  <!-- ============ HERO ============ -->
  <section class="gr-hero">
    <div class="wrap gr-hero-inner">
      <span class="eyebrow reveal">{$_(`${tk}.hero.eyebrow`)}</span>
      <h1 class="ase-h1 reveal" data-d="1">
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
  <section class="ase-how">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.how.kicker`)}</div>
        <h2>{$_(`${tk}.how.title`)}</h2>
        <p>{$_(`${tk}.how.sub`)}</p>
      </div>
      <div class="ase-steps">
        {#each STEPS as k, i (k)}
          <div class="ase-step reveal" data-d={(i % 3) + 1}>
            <span class="ase-step-n">{String(i + 1).padStart(2, '0')}</span>
            <h3>{$_(`${tk}.how.${k}.title`)}</h3>
            <p>{$_(`${tk}.how.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ FEATURES GRID ============ -->
  <section class="ase-features">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.features.kicker`)}</div>
        <h2>{$_(`${tk}.features.title`)}</h2>
      </div>
      <div class="ase-feat-grid">
        {#each FEATURES as k, i (k)}
          <div class="ase-feat reveal" data-d={(i % 3) + 1}>
            <div class="ase-feat-icon" aria-hidden="true">
              {#if k === 'geoAudit'}🔍{:else if k === 'blogSeo'}📝{:else if k === 'llmVisibility'}🤖{:else if k === 'autoPublish'}🚀{:else if k === 'contentPlan'}📅{:else}⚙️{/if}
            </div>
            <h3>{$_(`${tk}.features.${k}.title`)}</h3>
            <p>{$_(`${tk}.features.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ STATS ============ -->
  <section class="ase-stats">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker on-dark">{$_(`${tk}.stats.kicker`)}</div>
        <h2>{$_(`${tk}.stats.title`)}</h2>
      </div>
      <div class="ase-stats-grid">
        {#each STATS as k, i (k)}
          <div class="ase-stat reveal" data-d={i + 1}>
            <span class="ase-stat-num">{$_(`${tk}.stats.${k}.num`)}</span>
            <span class="ase-stat-lbl">{$_(`${tk}.stats.${k}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ BEFORE / AFTER ============ -->
  <section class="ase-compare">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.compare.kicker`)}</div>
        <h2>{$_(`${tk}.compare.title`)}</h2>
      </div>
      <div class="ase-cmp-grid">
        <div class="ase-cmp before reveal" data-d="1">
          <div class="ase-cmp-label">{$_(`${tk}.compare.before.label`)}</div>
          <ul>
            {#each BEFORE_ITEMS as k (k)}
              <li><span class="ase-cmp-ic x" aria-hidden="true">✕</span>{$_(`${tk}.compare.before.${k}`)}</li>
            {/each}
          </ul>
        </div>
        <div class="ase-cmp after reveal" data-d="2">
          <div class="ase-cmp-label">{$_(`${tk}.compare.after.label`)}</div>
          <ul>
            {#each AFTER_ITEMS as k (k)}
              <li><span class="ase-cmp-ic ok" aria-hidden="true">✓</span>{$_(`${tk}.compare.after.${k}`)}</li>
            {/each}
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ CONTENT EXAMPLE ============ -->
  <section class="ase-example">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.example.kicker`)}</div>
        <h2>{$_(`${tk}.example.title`)}</h2>
        <p>{$_(`${tk}.example.sub`)}</p>
      </div>
      <div class="ase-example-grid">
        <div class="ase-example-card reveal" data-d="1">
          <div class="ase-example-tag">{$_(`${tk}.example.tag1`)}</div>
          <div class="ase-example-title">{$_(`${tk}.example.cardTitle`)}</div>
          <div class="ase-example-meta">{$_(`${tk}.example.meta`)}</div>
          <div class="ase-example-body">
            <span class="ase-ex-line" style="width:100%"></span>
            <span class="ase-ex-line" style="width:92%"></span>
            <span class="ase-ex-line" style="width:97%"></span>
            <span class="ase-ex-line" style="width:78%"></span>
            <span class="ase-ex-line" style="width:85%"></span>
            <span class="ase-ex-line" style="width:60%"></span>
          </div>
          <div class="ase-example-footer">
            <span class="ase-example-score">SEO: 96/100</span>
            <span class="ase-example-links">8 internal links</span>
          </div>
        </div>
        <div class="ase-example-info reveal" data-d="2">
          <ul class="ase-example-points">
            {#each ['p1', 'p2', 'p3', 'p4'] as k (k)}
              <li>
                <span class="ase-check" aria-hidden="true">✓</span>
                <span>{$_(`${tk}.example.${k}`)}</span>
              </li>
            {/each}
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ FAQ ============ -->
  <section class="ase-faq">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.faq.kicker`)}</div>
        <h2>{$_(`${tk}.faq.title`)}</h2>
      </div>
      <div class="ase-faq-list">
        {#each FAQ_ITEMS as k, i (k)}
          <div class="ase-faq-item reveal" data-d={(i % 3) + 1}>
            <button class="ase-faq-q" onclick={() => toggleFaq(i)} aria-expanded={openFaq === i}>
              <span>{$_(`${tk}.faq.${k}.q`)}</span>
              <span class="ase-faq-arrow" class:open={openFaq === i}>→</span>
            </button>
            {#if openFaq === i}
              <div class="ase-faq-a">
                <p>{$_(`${tk}.faq.${k}.a`)}</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ FINAL CTA ============ -->
  <section class="ase-final">
    <div class="wrap ase-final-inner reveal">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <div class="gr-actions ase-final-actions">
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
  .ase-h1 {
    font-size: clamp(2.6rem, 6.5vw, 5.2rem);
    font-weight: var(--heading-weight); line-height: 1.04;
    letter-spacing: var(--heading-tracking); margin: 0; max-width: min(100%, 20ch);
    text-wrap: balance;
  }

  /* ---------- HOW IT WORKS ---------- */
  .ase-how { padding: 96px 0; background: var(--paper-2); }
  .ase-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
  .ase-step { padding: 30px 26px; border-radius: 18px; background: var(--paper); border: 1px solid var(--line); }
  .ase-step-n { font-family: var(--serif); font-size: 1.6rem; font-weight: var(--heading-weight); color: var(--accent); letter-spacing: var(--heading-tracking); display: block; }
  .ase-step h3 { font-family: var(--sans); font-size: 1.1rem; font-weight: 700; margin: 14px 0 0; }
  .ase-step p { font-size: 0.92rem; color: var(--ink-soft); margin-top: 8px; line-height: 1.5; }

  /* ---------- FEATURES ---------- */
  .ase-features { padding: 96px 0; }
  .ase-feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .ase-feat { padding: 30px 26px; border-radius: 18px; border: 1px solid var(--line); background: var(--paper); transition: transform .25s var(--ease), box-shadow .25s var(--ease); }
  .ase-feat:hover { transform: translateY(-3px); box-shadow: 0 16px 34px -22px rgba(var(--accent-rgb), 0.5); }
  .ase-feat-icon { font-size: 1.8rem; margin-bottom: 16px; }
  .ase-feat h3 { font-family: var(--sans); font-size: 1.15rem; font-weight: 700; margin: 0; }
  .ase-feat p { font-size: 0.92rem; color: var(--ink-soft); margin-top: 10px; line-height: 1.5; }

  /* ---------- STATS ---------- */
  .ase-stats { padding: 96px 0; background: var(--invert-surface); color: #fff; }
  .ase-stats :global(.sec-head h2) { color: #fff; }
  .ase-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .ase-stat { padding: 30px 24px; border-radius: 18px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); text-align: center; }
  .ase-stat-num { display: block; font-family: var(--serif); font-size: clamp(2.2rem, 4vw, 3rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); color: var(--accent-2); }
  .ase-stat-lbl { display: block; font-size: 1rem; font-weight: 600; margin-top: 8px; color: rgba(255,255,255,0.8); }

  /* ---------- BEFORE / AFTER ---------- */
  .ase-compare { padding: 96px 0; }
  .ase-cmp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 980px; margin: 0 auto; }
  .ase-cmp { border-radius: 24px; padding: 34px 30px; border: 1px solid var(--line); }
  .ase-cmp.before { background: var(--paper-2); }
  .ase-cmp.after { background: var(--invert-surface); color: #fff; border-color: transparent; box-shadow: 0 30px 60px -30px rgba(var(--accent-rgb), 0.5); }
  .ase-cmp-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 22px; }
  .ase-cmp.before .ase-cmp-label { color: var(--ink-faint); }
  .ase-cmp.after .ase-cmp-label { color: var(--accent-2); }
  .ase-cmp ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 13px; }
  .ase-cmp li { display: flex; align-items: flex-start; gap: 11px; font-size: 0.96rem; line-height: 1.4; }
  .ase-cmp-ic { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; margin-top: 1px; }
  .ase-cmp-ic.x { background: rgba(0,0,0,0.06); color: var(--ink-faint); }
  .ase-cmp-ic.ok { background: rgba(var(--accent-rgb), 0.22); color: var(--accent-2); }

  /* ---------- CONTENT EXAMPLE ---------- */
  .ase-example { padding: 96px 0; background: var(--paper-2); }
  .ase-example-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 40px; align-items: center; max-width: 1000px; margin: 0 auto; }
  .ase-example-card { background: var(--paper); border: 1px solid var(--line); border-radius: 20px; padding: 28px; box-shadow: 0 24px 50px -30px rgba(0,0,0,0.15); }
  .ase-example-tag { display: inline-block; font-size: 11px; font-weight: 700; color: var(--accent); background: rgba(var(--accent-rgb), 0.1); padding: 3px 10px; border-radius: 999px; margin-bottom: 14px; }
  .ase-example-title { font-family: var(--serif); font-size: 1.35rem; font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); line-height: 1.2; }
  .ase-example-meta { font-size: 12px; color: var(--ink-faint); margin-top: 8px; font-weight: 500; }
  .ase-example-body { display: flex; flex-direction: column; gap: 8px; margin-top: 18px; }
  .ase-ex-line { display: block; height: 8px; border-radius: 4px; background: var(--paper-2); }
  .ase-example-footer { display: flex; gap: 16px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
  .ase-example-score { font-size: 12px; font-weight: 700; color: var(--accent); }
  .ase-example-links { font-size: 12px; color: var(--ink-faint); font-weight: 500; }
  .ase-example-points { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 16px; }
  .ase-example-points li { display: flex; gap: 12px; font-size: 1.02rem; line-height: 1.5; color: var(--ink-soft); }
  .ase-check { flex: none; width: 22px; height: 22px; border-radius: 50%; background: rgba(var(--accent-rgb), 0.12); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; margin-top: 2px; }

  /* ---------- FAQ ---------- */
  .ase-faq { padding: 96px 0; }
  .ase-faq-list { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 0; }
  .ase-faq-item { border-bottom: 1px solid var(--line); }
  .ase-faq-q { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 0; background: none; border: none; cursor: pointer; font-family: var(--sans); font-size: 1.05rem; font-weight: 600; color: var(--ink); text-align: left; }
  .ase-faq-arrow { font-size: 18px; color: var(--ink-faint); transition: transform .25s var(--ease), color .25s var(--ease); flex-shrink: 0; }
  .ase-faq-arrow.open { color: var(--accent); transform: rotate(90deg); }
  .ase-faq-a { padding: 0 0 22px; animation: faqIn .3s var(--ease); }
  .ase-faq-a p { font-size: 0.96rem; color: var(--ink-soft); line-height: 1.6; }
  @keyframes faqIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

  /* ---------- FINAL CTA ---------- */
  .ase-final { padding: 120px 0; text-align: center; }
  .ase-final-inner { display: flex; flex-direction: column; align-items: center; }
  .ase-final h2 { font-size: clamp(2rem, 4.5vw, 3.2rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; max-width: 26ch; text-wrap: balance; }
  .ase-final p { color: var(--ink-soft); margin: 18px 0 0; font-size: 1.15rem; max-width: 50ch; line-height: 1.55; }
  .ase-final-actions { margin-top: 34px; }

  /* ---------- RESPONSIVE ---------- */
  @media (max-width: 920px) {
    .ase-steps, .ase-feat-grid { grid-template-columns: repeat(2, 1fr); }
    .ase-stats-grid { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 720px) {
    .ase-how, .ase-features, .ase-stats, .ase-compare, .ase-example, .ase-faq { padding: 64px 0; }
    .ase-cmp-grid { grid-template-columns: 1fr; }
    .ase-example-grid { grid-template-columns: 1fr; }
    .ase-final { padding: 84px 0; }
  }
  @media (max-width: 480px) {
    .ase-steps, .ase-feat-grid, .ase-stats-grid { grid-template-columns: 1fr; }
  }
</style>
