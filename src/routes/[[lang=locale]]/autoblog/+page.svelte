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
  const tk = 'landing.autoblog';

  const STEPS = ['s1', 's2', 's3'] as const;
  const FEATURES = ['fullyManaged', 'brandVoice', 'multiBrand', 'seoBuiltIn', 'autoPublish', 'backlinks'] as const;
  const WHO = ['founders', 'agencies', 'ecommerce', 'local'] as const;
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
          '@id': `${siteUrl}/autoblog`,
          url: `${siteUrl}/autoblog`,
          name: $_('meta.autoblog.title'),
          description: $_('meta.autoblog.description'),
          publisher: { '@id': `${siteUrl}/#org` },
          inLanguage: $locale ?? 'en'
        },
        {
          '@type': 'SoftwareApplication',
          name: 'Anomalia — Autoblog',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          url: `${siteUrl}/autoblog`,
          description: $_('meta.autoblog.description'),
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
            { '@type': 'ListItem', position: 2, name: 'Autoblog', item: `${siteUrl}/autoblog` }
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
  <title>{$_('meta.autoblog.title')}</title>
  <meta name="description" content={$_('meta.autoblog.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('meta.autoblog.title')} />
  <meta property="og:description" content={$_('meta.autoblog.description')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:title" content={$_('meta.autoblog.title')} />
  <meta name="twitter:description" content={$_('meta.autoblog.description')} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">

  <!-- ============ HERO ============ -->
  <section class="gr-hero">
    <div class="wrap gr-hero-inner">
      <span class="eyebrow reveal">{$_(`${tk}.hero.eyebrow`)}</span>
      <h1 class="ab-h1 reveal" data-d="1">
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
  <section class="ab-how">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.how.kicker`)}</div>
        <h2>{$_(`${tk}.how.title`)}</h2>
        <p>{$_(`${tk}.how.sub`)}</p>
      </div>
      <div class="ab-steps">
        {#each STEPS as k, i (k)}
          <div class="ab-step reveal" data-d={i + 1}>
            <span class="ab-step-n">{String(i + 1).padStart(2, '0')}</span>
            <h3>{$_(`${tk}.how.${k}.title`)}</h3>
            <p>{$_(`${tk}.how.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ FEATURES ============ -->
  <section class="ab-features">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.features.kicker`)}</div>
        <h2>{$_(`${tk}.features.title`)}</h2>
      </div>
      <div class="ab-feat-grid">
        {#each FEATURES as k, i (k)}
          <div class="ab-feat reveal" data-d={(i % 3) + 1}>
            <div class="ab-feat-icon" aria-hidden="true">
              {#if k === 'fullyManaged'}🤖{:else if k === 'brandVoice'}🎨{:else if k === 'multiBrand'}🏢{:else if k === 'seoBuiltIn'}📈{:else if k === 'autoPublish'}🚀{:else}🔗{/if}
            </div>
            <h3>{$_(`${tk}.features.${k}.title`)}</h3>
            <p>{$_(`${tk}.features.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ WHO IS IT FOR ============ -->
  <section class="ab-who">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.who.kicker`)}</div>
        <h2>{$_(`${tk}.who.title`)}</h2>
        <p>{$_(`${tk}.who.sub`)}</p>
      </div>
      <div class="ab-who-grid">
        {#each WHO as k, i (k)}
          <div class="ab-who-card reveal" data-d={i + 1}>
            <h3>{$_(`${tk}.who.${k}.title`)}</h3>
            <p>{$_(`${tk}.who.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ STATS ============ -->
  <section class="ab-stats">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker on-dark">{$_(`${tk}.stats.kicker`)}</div>
        <h2>{$_(`${tk}.stats.title`)}</h2>
      </div>
      <div class="ab-stats-grid">
        {#each STATS as k, i (k)}
          <div class="ab-stat reveal" data-d={i + 1}>
            <span class="ab-stat-num">{$_(`${tk}.stats.${k}.num`)}</span>
            <span class="ab-stat-lbl">{$_(`${tk}.stats.${k}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ BEFORE / AFTER ============ -->
  <section class="ab-compare">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.compare.kicker`)}</div>
        <h2>{$_(`${tk}.compare.title`)}</h2>
      </div>
      <div class="ab-cmp-grid">
        <div class="ab-cmp before reveal" data-d="1">
          <div class="ab-cmp-label">{$_(`${tk}.compare.before.label`)}</div>
          <ul>
            {#each BEFORE_ITEMS as k (k)}
              <li><span class="ab-cmp-ic x" aria-hidden="true">✕</span>{$_(`${tk}.compare.before.${k}`)}</li>
            {/each}
          </ul>
        </div>
        <div class="ab-cmp after reveal" data-d="2">
          <div class="ab-cmp-label">{$_(`${tk}.compare.after.label`)}</div>
          <ul>
            {#each AFTER_ITEMS as k (k)}
              <li><span class="ab-cmp-ic ok" aria-hidden="true">✓</span>{$_(`${tk}.compare.after.${k}`)}</li>
            {/each}
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ FAQ ============ -->
  <section class="ab-faq">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.faq.kicker`)}</div>
        <h2>{$_(`${tk}.faq.title`)}</h2>
      </div>
      <div class="ab-faq-list">
        {#each FAQ_ITEMS as k, i (k)}
          <div class="ab-faq-item reveal" data-d={(i % 3) + 1}>
            <button class="ab-faq-q" onclick={() => toggleFaq(i)} aria-expanded={openFaq === i}>
              <span>{$_(`${tk}.faq.${k}.q`)}</span>
              <span class="ab-faq-arrow" class:open={openFaq === i}>→</span>
            </button>
            {#if openFaq === i}
              <div class="ab-faq-a">
                <p>{$_(`${tk}.faq.${k}.a`)}</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ FINAL CTA ============ -->
  <section class="ab-final">
    <div class="wrap ab-final-inner reveal">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <div class="gr-actions ab-final-actions">
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
  .ab-h1 {
    font-size: clamp(2.6rem, 6.5vw, 5.2rem);
    font-weight: var(--heading-weight); line-height: 1.04;
    letter-spacing: var(--heading-tracking); margin: 0; max-width: min(100%, 22ch);
    text-wrap: balance;
  }

  /* ---------- HOW IT WORKS ---------- */
  .ab-how { padding: 96px 0; background: var(--paper-2); }
  .ab-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .ab-step { padding: 30px 26px; border-radius: 18px; background: var(--paper); border: 1px solid var(--line); }
  .ab-step-n { font-family: var(--serif); font-size: 1.6rem; font-weight: var(--heading-weight); color: var(--accent); letter-spacing: var(--heading-tracking); display: block; }
  .ab-step h3 { font-family: var(--sans); font-size: 1.1rem; font-weight: 700; margin: 14px 0 0; }
  .ab-step p { font-size: 0.92rem; color: var(--ink-soft); margin-top: 8px; line-height: 1.5; }

  /* ---------- FEATURES ---------- */
  .ab-features { padding: 96px 0; }
  .ab-feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .ab-feat { padding: 30px 26px; border-radius: 18px; border: 1px solid var(--line); background: var(--paper); transition: transform .25s var(--ease), box-shadow .25s var(--ease); }
  .ab-feat:hover { transform: translateY(-3px); box-shadow: 0 16px 34px -22px rgba(var(--accent-rgb), 0.5); }
  .ab-feat-icon { font-size: 1.8rem; margin-bottom: 16px; }
  .ab-feat h3 { font-family: var(--sans); font-size: 1.15rem; font-weight: 700; margin: 0; }
  .ab-feat p { font-size: 0.92rem; color: var(--ink-soft); margin-top: 10px; line-height: 1.5; }

  /* ---------- WHO IS IT FOR ---------- */
  .ab-who { padding: 96px 0; background: var(--paper-2); }
  .ab-who-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; max-width: 800px; margin: 0 auto; }
  .ab-who-card { padding: 28px 24px; border-radius: 18px; background: var(--paper); border: 1px solid var(--line); transition: transform .25s var(--ease), box-shadow .25s var(--ease); }
  .ab-who-card:hover { transform: translateY(-3px); box-shadow: 0 16px 34px -22px rgba(var(--accent-rgb), 0.5); }
  .ab-who-card h3 { font-family: var(--sans); font-size: 1.1rem; font-weight: 700; margin: 0 0 8px; }
  .ab-who-card p { font-size: 0.92rem; color: var(--ink-soft); line-height: 1.5; margin: 0; }

  /* ---------- STATS ---------- */
  .ab-stats { padding: 96px 0; background: var(--invert-surface); color: #fff; }
  .ab-stats :global(.sec-head h2) { color: #fff; }
  .ab-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .ab-stat { padding: 30px 24px; border-radius: 18px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); text-align: center; }
  .ab-stat-num { display: block; font-family: var(--serif); font-size: clamp(2.2rem, 4vw, 3rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); color: var(--accent-2); }
  .ab-stat-lbl { display: block; font-size: 1rem; font-weight: 600; margin-top: 8px; color: rgba(255,255,255,0.8); }

  /* ---------- BEFORE / AFTER ---------- */
  .ab-compare { padding: 96px 0; background: var(--paper-2); }
  .ab-cmp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 980px; margin: 0 auto; }
  .ab-cmp { border-radius: 24px; padding: 34px 30px; border: 1px solid var(--line); }
  .ab-cmp.before { background: var(--paper); }
  .ab-cmp.after { background: var(--invert-surface); color: #fff; border-color: transparent; box-shadow: 0 30px 60px -30px rgba(var(--accent-rgb), 0.5); }
  .ab-cmp-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 22px; }
  .ab-cmp.before .ab-cmp-label { color: var(--ink-faint); }
  .ab-cmp.after .ab-cmp-label { color: var(--accent-2); }
  .ab-cmp ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 13px; }
  .ab-cmp li { display: flex; align-items: flex-start; gap: 11px; font-size: 0.96rem; line-height: 1.4; }
  .ab-cmp-ic { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; margin-top: 1px; }
  .ab-cmp-ic.x { background: rgba(0,0,0,0.06); color: var(--ink-faint); }
  .ab-cmp-ic.ok { background: rgba(var(--accent-rgb), 0.22); color: var(--accent-2); }

  /* ---------- FAQ ---------- */
  .ab-faq { padding: 96px 0; }
  .ab-faq-list { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 0; }
  .ab-faq-item { border-bottom: 1px solid var(--line); }
  .ab-faq-q { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 0; background: none; border: none; cursor: pointer; font-family: var(--sans); font-size: 1.05rem; font-weight: 600; color: var(--ink); text-align: left; }
  .ab-faq-arrow { font-size: 18px; color: var(--ink-faint); transition: transform .25s var(--ease), color .25s var(--ease); flex-shrink: 0; }
  .ab-faq-arrow.open { color: var(--accent); transform: rotate(90deg); }
  .ab-faq-a { padding: 0 0 22px; animation: faqIn .3s var(--ease); }
  .ab-faq-a p { font-size: 0.96rem; color: var(--ink-soft); line-height: 1.6; }
  @keyframes faqIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

  /* ---------- FINAL CTA ---------- */
  .ab-final { padding: 120px 0; text-align: center; }
  .ab-final-inner { display: flex; flex-direction: column; align-items: center; }
  .ab-final h2 { font-size: clamp(2rem, 4.5vw, 3.2rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; max-width: 26ch; text-wrap: balance; }
  .ab-final p { color: var(--ink-soft); margin: 18px 0 0; font-size: 1.15rem; max-width: 50ch; line-height: 1.55; }
  .ab-final-actions { margin-top: 34px; }

  /* ---------- RESPONSIVE ---------- */
  @media (max-width: 920px) {
    .ab-steps, .ab-feat-grid { grid-template-columns: repeat(2, 1fr); }
    .ab-who-grid { grid-template-columns: repeat(2, 1fr); }
    .ab-stats-grid { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 720px) {
    .ab-how, .ab-features, .ab-who, .ab-stats, .ab-compare, .ab-faq { padding: 64px 0; }
    .ab-cmp-grid { grid-template-columns: 1fr; }
    .ab-final { padding: 84px 0; }
  }
  @media (max-width: 480px) {
    .ab-steps, .ab-feat-grid, .ab-who-grid, .ab-stats-grid { grid-template-columns: 1fr; }
  }
</style>
