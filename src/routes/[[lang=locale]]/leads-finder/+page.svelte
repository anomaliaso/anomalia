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
  import { siReddit, siX, siThreads } from 'simple-icons';
  import '$lib/styles/landing.css';

  let { data } = $props();
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const waitlistActive = $derived(data.waitlistActive);
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const loggedIn = $derived(Boolean(data.session));
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));
  const tk = 'landing.leadsFinder';

  const PLATFORMS = ['reddit', 'x', 'threads'] as const;
  const STEPS = ['s1', 's2', 's3', 's4'] as const;
  const FEATURES = ['smartScanning', 'intentDetection', 'readyDms', 'readyComments', 'leadDashboard', 'crmTracking'] as const;
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
          '@id': `${siteUrl}/leads-finder`,
          url: `${siteUrl}/leads-finder`,
          name: $_('meta.leadsFinder.title'),
          description: $_('meta.leadsFinder.description'),
          publisher: { '@id': `${siteUrl}/#org` },
          inLanguage: $locale ?? 'en'
        },
        {
          '@type': 'SoftwareApplication',
          name: 'Anomalia — Leads Finder',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          url: `${siteUrl}/leads-finder`,
          description: $_('meta.leadsFinder.description'),
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
            { '@type': 'ListItem', position: 2, name: 'Leads Finder', item: `${siteUrl}/leads-finder` }
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
  <title>{$_('meta.leadsFinder.title')}</title>
  <meta name="description" content={$_('meta.leadsFinder.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('meta.leadsFinder.title')} />
  <meta property="og:description" content={$_('meta.leadsFinder.description')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:title" content={$_('meta.leadsFinder.title')} />
  <meta name="twitter:description" content={$_('meta.leadsFinder.description')} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">

  <!-- ============ HERO ============ -->
  <section class="gr-hero">
    <div class="wrap gr-hero-inner">
      <span class="eyebrow reveal">{$_(`${tk}.hero.eyebrow`)}</span>
      <h1 class="lf-h1 reveal" data-d="1">
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

  <!-- ============ PLATFORMS ============ -->
  <section class="lf-platforms">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.platforms.kicker`)}</div>
        <h2>{$_(`${tk}.platforms.title`)}</h2>
        <p>{$_(`${tk}.platforms.sub`)}</p>
      </div>
      <div class="lf-plat-grid">
        {#each PLATFORMS as k, i (k)}
          <div class="lf-plat reveal" data-d={i + 1}>
            <div class="lf-plat-icon" aria-hidden="true">
              {#if k === 'reddit'}<svg viewBox="0 0 24 24" width="32" height="32" fill="#FF4500"><path d={siReddit.path} /></svg>{:else if k === 'x'}<svg viewBox="0 0 24 24" width="32" height="32" fill="#000"><path d={siX.path} /></svg>{:else}<svg viewBox="0 0 24 24" width="32" height="32" fill="#000"><path d={siThreads.path} /></svg>{/if}
            </div>
            <h3>{$_(`${tk}.platforms.${k}.title`)}</h3>
            <p>{$_(`${tk}.platforms.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ HOW IT WORKS ============ -->
  <section class="lf-how">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.how.kicker`)}</div>
        <h2>{$_(`${tk}.how.title`)}</h2>
        <p>{$_(`${tk}.how.sub`)}</p>
      </div>
      <div class="lf-steps">
        {#each STEPS as k, i (k)}
          <div class="lf-step reveal" data-d={(i % 3) + 1}>
            <span class="lf-step-n">{String(i + 1).padStart(2, '0')}</span>
            <h3>{$_(`${tk}.how.${k}.title`)}</h3>
            <p>{$_(`${tk}.how.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ FEATURES ============ -->
  <section class="lf-features">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.features.kicker`)}</div>
        <h2>{$_(`${tk}.features.title`)}</h2>
      </div>
      <div class="lf-feat-grid">
        {#each FEATURES as k, i (k)}
          <div class="lf-feat reveal" data-d={(i % 3) + 1}>
            <div class="lf-feat-icon" aria-hidden="true">
              {#if k === 'smartScanning'}🔍{:else if k === 'intentDetection'}🎯{:else if k === 'readyDms'}✉️{:else if k === 'readyComments'}💬{:else if k === 'leadDashboard'}📊{:else}📋{/if}
            </div>
            <h3>{$_(`${tk}.features.${k}.title`)}</h3>
            <p>{$_(`${tk}.features.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ EXAMPLE DM ============ -->
  <section class="lf-example">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.example.kicker`)}</div>
        <h2>{$_(`${tk}.example.title`)}</h2>
        <p>{$_(`${tk}.example.sub`)}</p>
      </div>
      <div class="lf-example-grid">
        <div class="lf-example-card reveal" data-d="1">
          <div class="lf-example-header">
            <div class="lf-example-platform">{$_(`${tk}.example.platform`)}</div>
            <div class="lf-example-context">{$_(`${tk}.example.context`)}</div>
          </div>
          <div class="lf-example-post">{$_(`${tk}.example.originalPost`)}</div>
          <div class="lf-example-divider">
            <span>{$_(`${tk}.example.suggestedReply`)}</span>
          </div>
          <div class="lf-example-reply">{$_(`${tk}.example.generatedReply`)}</div>
          <div class="lf-example-footer">
            <span class="lf-example-badge">{$_(`${tk}.example.badge`)}</span>
            <span class="lf-example-note">{$_(`${tk}.example.note`)}</span>
          </div>
        </div>
        <div class="lf-example-info reveal" data-d="2">
          <ul class="lf-example-points">
            {#each ['p1', 'p2', 'p3', 'p4'] as k (k)}
              <li>
                <span class="lf-check" aria-hidden="true">✓</span>
                <span>{$_(`${tk}.example.${k}`)}</span>
              </li>
            {/each}
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ STATS ============ -->
  <section class="lf-stats">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker on-dark">{$_(`${tk}.stats.kicker`)}</div>
        <h2>{$_(`${tk}.stats.title`)}</h2>
      </div>
      <div class="lf-stats-grid">
        {#each STATS as k, i (k)}
          <div class="lf-stat reveal" data-d={i + 1}>
            <span class="lf-stat-num">{$_(`${tk}.stats.${k}.num`)}</span>
            <span class="lf-stat-lbl">{$_(`${tk}.stats.${k}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ BEFORE / AFTER ============ -->
  <section class="lf-compare">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.compare.kicker`)}</div>
        <h2>{$_(`${tk}.compare.title`)}</h2>
      </div>
      <div class="lf-cmp-grid">
        <div class="lf-cmp before reveal" data-d="1">
          <div class="lf-cmp-label">{$_(`${tk}.compare.before.label`)}</div>
          <ul>
            {#each BEFORE_ITEMS as k (k)}
              <li><span class="lf-cmp-ic x" aria-hidden="true">✕</span>{$_(`${tk}.compare.before.${k}`)}</li>
            {/each}
          </ul>
        </div>
        <div class="lf-cmp after reveal" data-d="2">
          <div class="lf-cmp-label">{$_(`${tk}.compare.after.label`)}</div>
          <ul>
            {#each AFTER_ITEMS as k (k)}
              <li><span class="lf-cmp-ic ok" aria-hidden="true">✓</span>{$_(`${tk}.compare.after.${k}`)}</li>
            {/each}
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ FAQ ============ -->
  <section class="lf-faq">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.faq.kicker`)}</div>
        <h2>{$_(`${tk}.faq.title`)}</h2>
      </div>
      <div class="lf-faq-list">
        {#each FAQ_ITEMS as k, i (k)}
          <div class="lf-faq-item reveal" data-d={(i % 3) + 1}>
            <button class="lf-faq-q" onclick={() => toggleFaq(i)} aria-expanded={openFaq === i}>
              <span>{$_(`${tk}.faq.${k}.q`)}</span>
              <span class="lf-faq-arrow" class:open={openFaq === i}>→</span>
            </button>
            {#if openFaq === i}
              <div class="lf-faq-a">
                <p>{$_(`${tk}.faq.${k}.a`)}</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ FINAL CTA ============ -->
  <section class="lf-final">
    <div class="wrap lf-final-inner reveal">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <div class="gr-actions lf-final-actions">
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
  .lf-h1 {
    font-size: clamp(2.6rem, 6.5vw, 5.2rem);
    font-weight: var(--heading-weight); line-height: 1.04;
    letter-spacing: var(--heading-tracking); margin: 0; max-width: min(100%, 22ch);
    text-wrap: balance;
  }

  /* ---------- PLATFORMS ---------- */
  .lf-platforms { padding: 96px 0; background: var(--paper-2); }
  .lf-plat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .lf-plat { padding: 30px 26px; border-radius: 18px; background: var(--paper); border: 1px solid var(--line); text-align: center; transition: transform .25s var(--ease), box-shadow .25s var(--ease); }
  .lf-plat:hover { transform: translateY(-3px); box-shadow: 0 16px 34px -22px rgba(var(--accent-rgb), 0.5); }
  .lf-plat-icon { display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; margin: 0 auto 16px; }
  .lf-plat h3 { font-family: var(--sans); font-size: 1.15rem; font-weight: 700; margin: 0; }
  .lf-plat p { font-size: 0.92rem; color: var(--ink-soft); margin-top: 10px; line-height: 1.5; }

  /* ---------- HOW IT WORKS ---------- */
  .lf-how { padding: 96px 0; }
  .lf-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
  .lf-step { padding: 30px 26px; border-radius: 18px; background: var(--paper); border: 1px solid var(--line); }
  .lf-step-n { font-family: var(--serif); font-size: 1.6rem; font-weight: var(--heading-weight); color: var(--accent); letter-spacing: var(--heading-tracking); display: block; }
  .lf-step h3 { font-family: var(--sans); font-size: 1.1rem; font-weight: 700; margin: 14px 0 0; }
  .lf-step p { font-size: 0.92rem; color: var(--ink-soft); margin-top: 8px; line-height: 1.5; }

  /* ---------- FEATURES ---------- */
  .lf-features { padding: 96px 0; background: var(--paper-2); }
  .lf-feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .lf-feat { padding: 30px 26px; border-radius: 18px; border: 1px solid var(--line); background: var(--paper); transition: transform .25s var(--ease), box-shadow .25s var(--ease); }
  .lf-feat:hover { transform: translateY(-3px); box-shadow: 0 16px 34px -22px rgba(var(--accent-rgb), 0.5); }
  .lf-feat-icon { font-size: 1.8rem; margin-bottom: 16px; }
  .lf-feat h3 { font-family: var(--sans); font-size: 1.15rem; font-weight: 700; margin: 0; }
  .lf-feat p { font-size: 0.92rem; color: var(--ink-soft); margin-top: 10px; line-height: 1.5; }

  /* ---------- EXAMPLE DM ---------- */
  .lf-example { padding: 96px 0; }
  .lf-example-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 40px; align-items: center; max-width: 1000px; margin: 0 auto; }
  .lf-example-card { background: var(--paper); border: 1px solid var(--line); border-radius: 20px; padding: 28px; box-shadow: 0 24px 50px -30px rgba(0,0,0,0.15); }
  .lf-example-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .lf-example-platform { font-size: 11px; font-weight: 700; color: var(--accent); background: rgba(var(--accent-rgb), 0.1); padding: 3px 10px; border-radius: 999px; }
  .lf-example-context { font-size: 12px; color: var(--ink-faint); font-weight: 500; }
  .lf-example-post { font-size: 0.95rem; line-height: 1.5; color: var(--ink-soft); padding: 16px; background: var(--paper-2); border-radius: 12px; border-left: 3px solid var(--line); }
  .lf-example-divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; }
  .lf-example-divider::before, .lf-example-divider::after { content: ''; flex: 1; height: 1px; background: var(--line); }
  .lf-example-divider span { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); white-space: nowrap; }
  .lf-example-reply { font-size: 0.95rem; line-height: 1.5; color: var(--ink); padding: 16px; background: rgba(var(--accent-rgb), 0.06); border-radius: 12px; border: 1px solid rgba(var(--accent-rgb), 0.15); }
  .lf-example-footer { display: flex; align-items: center; gap: 12px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
  .lf-example-badge { font-size: 11px; font-weight: 700; color: #10b981; background: rgba(16,185,129,0.1); padding: 3px 10px; border-radius: 999px; }
  .lf-example-note { font-size: 12px; color: var(--ink-faint); font-weight: 500; }
  .lf-example-points { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 16px; }
  .lf-example-points li { display: flex; gap: 12px; font-size: 1.02rem; line-height: 1.5; color: var(--ink-soft); }
  .lf-check { flex: none; width: 22px; height: 22px; border-radius: 50%; background: rgba(var(--accent-rgb), 0.12); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; margin-top: 2px; }

  /* ---------- STATS ---------- */
  .lf-stats { padding: 96px 0; background: var(--invert-surface); color: #fff; }
  .lf-stats :global(.sec-head h2) { color: #fff; }
  .lf-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .lf-stat { padding: 30px 24px; border-radius: 18px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); text-align: center; }
  .lf-stat-num { display: block; font-family: var(--serif); font-size: clamp(2.2rem, 4vw, 3rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); color: var(--accent-2); }
  .lf-stat-lbl { display: block; font-size: 1rem; font-weight: 600; margin-top: 8px; color: rgba(255,255,255,0.8); }

  /* ---------- BEFORE / AFTER ---------- */
  .lf-compare { padding: 96px 0; background: var(--paper-2); }
  .lf-cmp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 980px; margin: 0 auto; }
  .lf-cmp { border-radius: 24px; padding: 34px 30px; border: 1px solid var(--line); }
  .lf-cmp.before { background: var(--paper); }
  .lf-cmp.after { background: var(--invert-surface); color: #fff; border-color: transparent; box-shadow: 0 30px 60px -30px rgba(var(--accent-rgb), 0.5); }
  .lf-cmp-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 22px; }
  .lf-cmp.before .lf-cmp-label { color: var(--ink-faint); }
  .lf-cmp.after .lf-cmp-label { color: var(--accent-2); }
  .lf-cmp ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 13px; }
  .lf-cmp li { display: flex; align-items: flex-start; gap: 11px; font-size: 0.96rem; line-height: 1.4; }
  .lf-cmp-ic { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; margin-top: 1px; }
  .lf-cmp-ic.x { background: rgba(0,0,0,0.06); color: var(--ink-faint); }
  .lf-cmp-ic.ok { background: rgba(var(--accent-rgb), 0.22); color: var(--accent-2); }

  /* ---------- FAQ ---------- */
  .lf-faq { padding: 96px 0; }
  .lf-faq-list { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 0; }
  .lf-faq-item { border-bottom: 1px solid var(--line); }
  .lf-faq-q { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 0; background: none; border: none; cursor: pointer; font-family: var(--sans); font-size: 1.05rem; font-weight: 600; color: var(--ink); text-align: left; }
  .lf-faq-arrow { font-size: 18px; color: var(--ink-faint); transition: transform .25s var(--ease), color .25s var(--ease); flex-shrink: 0; }
  .lf-faq-arrow.open { color: var(--accent); transform: rotate(90deg); }
  .lf-faq-a { padding: 0 0 22px; animation: faqIn .3s var(--ease); }
  .lf-faq-a p { font-size: 0.96rem; color: var(--ink-soft); line-height: 1.6; }
  @keyframes faqIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

  /* ---------- FINAL CTA ---------- */
  .lf-final { padding: 120px 0; text-align: center; }
  .lf-final-inner { display: flex; flex-direction: column; align-items: center; }
  .lf-final h2 { font-size: clamp(2rem, 4.5vw, 3.2rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; max-width: 26ch; text-wrap: balance; }
  .lf-final p { color: var(--ink-soft); margin: 18px 0 0; font-size: 1.15rem; max-width: 50ch; line-height: 1.55; }
  .lf-final-actions { margin-top: 34px; }

  /* ---------- RESPONSIVE ---------- */
  @media (max-width: 920px) {
    .lf-steps { grid-template-columns: repeat(2, 1fr); }
    .lf-plat-grid, .lf-feat-grid { grid-template-columns: repeat(2, 1fr); }
    .lf-stats-grid { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 720px) {
    .lf-platforms, .lf-how, .lf-features, .lf-example, .lf-stats, .lf-compare, .lf-faq { padding: 64px 0; }
    .lf-cmp-grid { grid-template-columns: 1fr; }
    .lf-example-grid { grid-template-columns: 1fr; }
    .lf-final { padding: 84px 0; }
  }
  @media (max-width: 480px) {
    .lf-steps, .lf-plat-grid, .lf-feat-grid, .lf-stats-grid { grid-template-columns: 1fr; }
  }
</style>
