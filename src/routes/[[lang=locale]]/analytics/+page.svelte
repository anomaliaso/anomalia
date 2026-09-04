<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
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
  const tk = 'pain.analytics';
</script>

<svelte:head>
  <title>{$_(`meta.${tk}.title`)}</title>
  <meta name="description" content={$_(`meta.${tk}.description`)} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_(`meta.${tk}.title`)} />
  <meta property="og:description" content={$_(`meta.${tk}.description`)} />
  <meta name="twitter:title" content={$_(`meta.${tk}.title`)} />
  <meta name="twitter:description" content={$_(`meta.${tk}.description`)} />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "What social media metrics should I track?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Track metrics that connect to business goals: engagement rate, reach, click-through rate, conversion rate, and audience growth rate. Avoid focusing solely on vanity metrics like follower count. The most valuable metrics are those that indicate audience intent and content effectiveness."
        }
      },
      {
        "@type": "Question",
        "name": "How do I track social media analytics across platforms?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Use a unified analytics dashboard that pulls data from all your connected platforms. This gives you a single view of performance across Instagram, TikTok, LinkedIn, X, and Facebook without switching between native analytics tools. Cross-platform reporting reveals which channels drive the best results."
        }
      },
      {
        "@type": "Question",
        "name": "How often should I check my social media analytics?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Check analytics weekly for tactical adjustments (what to post more of, timing optimization) and monthly for strategic reviews (audience growth trends, platform ROI comparisons). Daily checking leads to reactive decisions — weekly reviews give you enough data to make informed changes."
        }
      },
      {
        "@type": "Question",
        "name": "What is the difference between reach and impressions?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Reach is the number of unique people who saw your content, while impressions are the total number of times your content was displayed (including multiple views by the same person). If impressions are much higher than reach, your content is being viewed multiple times — a strong engagement signal."
        }
      }
    ]
  }
  </script>
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main class="an-page">
  <section class="an-hero">
    <div class="an-wrap an-hero-grid">
      <div class="an-hero-mockup">
        <div class="an-dash">
          <div class="an-dash-header">
            <span>Analytics</span>
            <span class="an-dash-period">Last 30 days</span>
          </div>
          <div class="an-dash-row">
            <div class="an-dash-card">
              <span class="an-dash-val">+24%</span>
              <span class="an-dash-label">Engagement</span>
            </div>
            <div class="an-dash-card">
              <span class="an-dash-val">12.4k</span>
              <span class="an-dash-label">Reach</span>
            </div>
            <div class="an-dash-card">
              <span class="an-dash-val">847</span>
              <span class="an-dash-label">Clicks</span>
            </div>
          </div>
          <div class="an-dash-chart">
            <svg viewBox="0 0 280 60" fill="none" preserveAspectRatio="none">
              <path d="M0 50 L40 35 L80 40 L120 20 L160 25 L200 10 L240 15 L280 5" stroke="var(--accent)" stroke-width="2" fill="none"/>
              <path d="M0 50 L40 35 L80 40 L120 20 L160 25 L200 10 L240 15 L280 5 L280 60 L0 60 Z" fill="rgba(var(--accent-rgb), 0.08)"/>
            </svg>
          </div>
          <div class="an-dash-platforms">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="var(--accent)" stroke="none"/></svg>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M4 4l11.733 16H20L8.267 4H4zm0 16l6.5-6.5M20 4l-6.5 6.5"/></svg>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
          </div>
        </div>
      </div>
      <div class="an-hero-copy">
        <span class="an-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="an-h1">{$_(`${tk}.headline`)}</h1>
        <p class="an-sub">{$_(`${tk}.sub`)}</p>
        <a class="an-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      </div>
    </div>
  </section>

  <section class="an-pain">
    <div class="an-wrap">
      <h2 class="an-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="an-pain-grid">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="an-pain-card">
            <span class="an-pain-icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="8" stroke="currentColor" stroke-width="2"/><path d="M9 5v4l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </span>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="an-solution">
    <div class="an-wrap">
      <h2 class="an-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="an-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="an-feat-stack">
        {#each [1, 2, 3] as i (i)}
          <div class="an-feat">
            <div class="an-feat-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 3v18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 16l4-6 4 4 5-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div>
              <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
              <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
            </div>
            <div class="an-feat-mini-chart">
              <svg viewBox="0 0 60 24" fill="none">
                <path d="M0 20 L10 14 L20 16 L30 8 L40 10 L50 4 L60 2" stroke="var(--accent)" stroke-width="1.5"/>
              </svg>
            </div>
          </div>
        {/each}
      </div>
      <div class="an-platforms">
        <div class="an-plat-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>
          <span>Instagram</span>
        </div>
        <div class="an-plat-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>
          <span>TikTok</span>
        </div>
        <div class="an-plat-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>
          <span>LinkedIn</span>
        </div>
        <div class="an-plat-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l11.733 16H20L8.267 4H4zm0 16l6.5-6.5M20 4l-6.5 6.5"/></svg>
          <span>X</span>
        </div>
        <div class="an-plat-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
          <span>Facebook</span>
        </div>
      </div>
    </div>
  </section>

  <section class="an-stats">
    <div class="an-wrap">
      <div class="an-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="an-stat">
            <span class="an-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="an-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="an-how">
    <div class="an-wrap">
      <h2 class="an-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="an-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="an-step">
            <div class="an-step-n">{i}</div>
            <div><h3>{$_(`${tk}.how.s${i}.title`)}</h3><p>{$_(`${tk}.how.s${i}.desc`)}</p></div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="an-seo-ask">
    <div class="an-wrap">
      <h2 class="an-h2">Can I see all my social media analytics in one place?</h2>
      <p>Yes. Cross-platform analytics dashboards consolidate data from Instagram, TikTok, LinkedIn, X, and Facebook into a single view. This eliminates the need to check five different apps and makes it easy to compare performance, identify top-performing content, and allocate resources to the platforms that deliver the highest ROI.</p>
    </div>
  </section>

  <section class="an-seo-related">
    <div class="an-wrap">
      <p>Related: <a href={lp('/roi')}>Measure social media ROI</a> · <a href={lp('/engagement')}>Increase social media engagement</a> · <a href={lp('/not-working')}>Why social media isn't working</a></p>
    </div>
  </section>

  <section class="an-final">
    <div class="an-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="an-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .an-wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }
  .an-hero { padding: 100px 0 80px; background: var(--paper); border-bottom: 1px solid var(--line); }
  .an-hero-grid { display: grid; grid-template-columns: 360px 1fr; gap: 48px; align-items: center; }
  .an-eyebrow {
    display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--accent); background: rgba(var(--accent-rgb), 0.08);
    padding: 5px 14px; border-radius: 999px; margin-bottom: 20px;
  }
  .an-h1 {
    font-size: clamp(2rem, 4.5vw, 3rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); line-height: 1.08; margin: 0;
  }
  .an-sub { font-size: 1.1rem; line-height: 1.6; color: var(--ink-soft); margin: 18px 0 0; max-width: 42ch; }
  .an-cta {
    display: inline-flex; margin-top: 28px; background: var(--invert-surface); color: #fff;
    text-decoration: none; border-radius: 980px; padding: 14px 32px;
    font-size: 15px; font-weight: 700; transition: transform 0.15s, box-shadow 0.15s;
  }
  .an-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
  .an-hero-mockup {
    border-radius: 16px; overflow: hidden;
    border: 1px solid var(--line);
    box-shadow: 0 12px 40px rgba(0,0,0,0.1);
    background: var(--paper); padding: 20px;
  }
  .an-dash-header {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 14px; font-weight: 700; color: var(--ink); margin-bottom: 16px;
  }
  .an-dash-period { font-size: 11px; font-weight: 500; color: var(--ink-soft); }
  .an-dash-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
  .an-dash-card {
    padding: 12px; border-radius: 10px; background: var(--paper-2, #f5f5f7);
    border: 1px solid var(--line); text-align: center;
  }
  .an-dash-val { display: block; font-size: 18px; font-weight: 800; color: var(--accent); }
  .an-dash-label { font-size: 10px; color: var(--ink-soft); }
  .an-dash-chart { height: 60px; margin-bottom: 12px; }
  .an-dash-chart svg { width: 100%; height: 100%; }
  .an-dash-platforms { display: flex; gap: 10px; justify-content: center; }
  .an-pain { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .an-h2 {
    font-size: clamp(1.5rem, 3.5vw, 2.1rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); margin: 0 0 36px; text-align: center;
  }
  .an-pain-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; max-width: 720px; margin: 0 auto; }
  .an-pain-card {
    display: flex; align-items: flex-start; gap: 14px; padding: 22px 24px;
    border-radius: 14px; background: var(--paper); border: 1px solid var(--line);
  }
  .an-pain-icon {
    flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%;
    background: rgba(var(--accent-rgb), 0.1); color: var(--accent);
    display: flex; align-items: center; justify-content: center;
  }
  .an-pain-card p { font-size: 0.93rem; line-height: 1.5; color: var(--ink); margin: 0; }
  .an-solution { padding: 80px 0; background: var(--paper); }
  .an-sol-sub {
    text-align: center; color: var(--ink-soft); margin: 0 0 40px;
    font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto;
  }
  .an-feat-stack { display: flex; flex-direction: column; gap: 16px; max-width: 640px; margin: 0 auto; }
  .an-feat {
    display: flex; gap: 20px; align-items: flex-start; padding: 24px;
    border-radius: 14px; background: var(--paper-2, #f5f5f7); border: 1px solid var(--line);
    transition: border-color .2s;
  }
  .an-feat:hover { border-color: rgba(var(--accent-rgb), 0.3); }
  .an-feat-icon {
    flex: 0 0 auto; width: 44px; height: 44px; border-radius: 12px;
    background: rgba(var(--accent-rgb), 0.1); color: var(--accent);
    display: flex; align-items: center; justify-content: center;
  }
  .an-feat h3 { font-size: 1rem; font-weight: 700; margin: 0 0 6px; }
  .an-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }
  .an-feat-mini-chart { flex: 0 0 auto; width: 60px; height: 24px; margin-left: auto; }
  .an-feat-mini-chart svg { width: 100%; height: 100%; }
  .an-platforms {
    display: flex; justify-content: center; gap: 16px; margin-top: 36px; flex-wrap: wrap;
  }
  .an-plat-icon {
    display: flex; align-items: center; gap: 6px; padding: 8px 16px;
    border-radius: 999px; border: 1px solid var(--line); background: var(--paper);
    font-size: 13px; font-weight: 600; color: var(--ink);
    transition: border-color .2s, box-shadow .2s;
  }
  .an-plat-icon:hover { border-color: rgba(var(--accent-rgb), 0.3); box-shadow: 0 4px 12px rgba(var(--accent-rgb), 0.08); }
  .an-plat-icon svg { color: var(--accent); }
  .an-stats { padding: 64px 0; background: var(--invert-surface); color: #fff; }
  .an-stats-row { display: flex; justify-content: center; gap: 56px; flex-wrap: wrap; }
  .an-stat { text-align: center; }
  .an-stat-num { display: block; font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; color: var(--accent-2, #9d86ff); }
  .an-stat-lbl { font-size: 0.85rem; color: rgba(255,255,255,0.55); margin-top: 4px; }
  .an-how { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .an-steps { display: flex; flex-direction: column; gap: 20px; max-width: 600px; margin: 0 auto; }
  .an-step {
    display: flex; gap: 18px; align-items: flex-start; padding: 22px;
    border-radius: 14px; background: var(--paper); border: 1px solid var(--line);
  }
  .an-step-n {
    flex: 0 0 auto; width: 36px; height: 36px; border-radius: 50%;
    background: var(--accent); color: #fff; display: flex; align-items: center;
    justify-content: center; font-size: 15px; font-weight: 700;
  }
  .an-step h3 { font-size: 0.95rem; font-weight: 700; margin: 0 0 4px; }
  .an-step p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.5; margin: 0; }
  .an-final { padding: 100px 0; text-align: center; background: var(--paper); border-top: 1px solid var(--line); }
  .an-final h2 { font-size: clamp(1.7rem, 3.5vw, 2.4rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; }
  .an-final p { color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; }
  .an-seo-ask { padding: 64px 0; background: var(--paper-2, #f5f5f7); }
  .an-seo-ask h2 { font-size: clamp(1.3rem, 3vw, 1.8rem); margin: 0 0 16px; }
  .an-seo-ask p { font-size: 0.95rem; color: var(--ink-soft); line-height: 1.7; max-width: 60ch; margin: 0 auto; text-align: center; }
  .an-seo-related { padding: 32px 0; background: var(--paper); border-top: 1px solid var(--line); text-align: center; }
  .an-seo-related p { font-size: 0.88rem; color: var(--ink-soft); margin: 0; }
  .an-seo-related a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .an-seo-related a:hover { color: var(--ink); }
  @media (max-width: 720px) {
    .an-hero { padding: 64px 0 48px; }
    .an-hero-grid { grid-template-columns: 1fr; text-align: center; }
    .an-hero-copy { display: flex; flex-direction: column; align-items: center; order: -1; }
    .an-hero-mockup { max-width: 280px; margin: 0 auto; }
    .an-pain, .an-solution, .an-how { padding: 56px 0; }
    .an-pain-grid { grid-template-columns: 1fr; }
    .an-feat-stack { gap: 12px; }
    .an-feat { flex-direction: column; }
    .an-feat-mini-chart { margin-left: 0; }
    .an-stats { padding: 48px 0; }
    .an-stats-row { gap: 32px; }
    .an-final { padding: 72px 0; }
  }
</style>
