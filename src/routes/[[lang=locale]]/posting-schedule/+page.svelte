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
  const tk = 'pain.postingSchedule';
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
        "name": "What are the best times to post on social media in 2025?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Best posting times vary by platform: Instagram performs best Tuesday-Thursday 9-11 AM, TikTok peaks in the evening 7-9 PM, LinkedIn works best Tuesday-Wednesday 8-10 AM, and X (Twitter) sees highest engagement weekdays 12-3 PM. Always check your own analytics for audience-specific data."
        }
      },
      {
        "@type": "Question",
        "name": "How do I create a posting schedule?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Start by auditing your analytics to find when your audience is most active. Then assign content types to specific days (e.g., educational on Mondays, behind-the-scenes on Wednesdays). Use a scheduling tool to batch-schedule a week of content in one session."
        }
      },
      {
        "@type": "Question",
        "name": "Should I post the same content on all platforms?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "No. Each platform has different content formats, audience expectations, and algorithm preferences. Adapt your core message to each platform's style: short-form video for TikTok, carousels for Instagram, professional insights for LinkedIn, and concise text for X."
        }
      },
      {
        "@type": "Question",
        "name": "How far in advance should I schedule social media posts?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Schedule posts 1-2 weeks in advance for maximum flexibility. This gives you time to adjust for trending topics while maintaining consistency. Leave room for spontaneous content — a 70/30 split between planned and reactive content works well."
        }
      }
    ]
  }
  </script>
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main class="ps-page">
  <section class="ps-hero">
    <div class="ps-wrap ps-hero-grid">
      <div class="ps-hero-mockup">
        <img src="/hero/post3.png" alt="Weekly social media posting schedule showing optimized content slots" loading="lazy" />
      </div>
      <div class="ps-hero-copy">
        <span class="ps-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="ps-h1">{$_(`${tk}.headline`)}</h1>
        <p class="ps-sub">{$_(`${tk}.sub`)}</p>
        <a class="ps-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      </div>
    </div>
  </section>

  <section class="ps-pain">
    <div class="ps-wrap">
      <h2 class="ps-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="ps-pain-grid">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="ps-pain-card">
            <div class="ps-pain-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5" />
                <path d="M10 6v4l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </div>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ps-solution">
    <div class="ps-wrap">
      <h2 class="ps-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="ps-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="ps-feat-stack">
        {#each [1, 2, 3] as i (i)}
          <div class="ps-feat">
            <div class="ps-feat-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" stroke-width="1.5" />
                <path d="M7 8h6M7 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </div>
            <div>
              <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
              <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ps-stats">
    <div class="ps-wrap">
      <div class="ps-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="ps-stat">
            <span class="ps-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="ps-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ps-how">
    <div class="ps-wrap">
      <h2 class="ps-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="ps-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="ps-step">
            <div class="ps-step-n">0{i}</div>
            <div><h3>{$_(`${tk}.how.s${i}.title`)}</h3><p>{$_(`${tk}.how.s${i}.desc`)}</p></div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ps-seo-ask">
    <div class="ps-wrap">
      <h2 class="ps-h2">Does posting time really affect social media reach?</h2>
      <p>Yes. Posting when your audience is most active gives your content an initial engagement boost that signals the algorithm to show it to more people. Posts published during peak hours typically receive 20-30% more impressions than those posted at random times, making strategic scheduling a simple but effective growth lever.</p>
    </div>
  </section>

  <section class="ps-seo-related">
    <div class="ps-wrap">
      <p>Related: <a href={lp('/scheduling')}>Social media scheduling tools</a> · <a href={lp('/consistency')}>Post consistently on social media</a> · <a href={lp('/automation')}>Social media automation</a></p>
    </div>
  </section>

  <section class="ps-final">
    <div class="ps-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="ps-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .ps-wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }
  .ps-hero { padding: 100px 0 80px; background: var(--paper); border-bottom: 1px solid var(--line); }
  .ps-hero-grid { display: grid; grid-template-columns: 320px 1fr; gap: 48px; align-items: center; }
  .ps-eyebrow {
    display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--accent); background: rgba(var(--accent-rgb), 0.08);
    padding: 5px 14px; border-radius: 999px; margin-bottom: 20px;
  }
  .ps-h1 {
    font-size: clamp(2rem, 4.5vw, 3rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); line-height: 1.08; margin: 0;
  }
  .ps-sub { font-size: 1.1rem; line-height: 1.6; color: var(--ink-soft); margin: 18px 0 0; max-width: 42ch; }
  .ps-cta {
    display: inline-flex; margin-top: 28px; background: var(--invert-surface); color: #fff;
    text-decoration: none; border-radius: 980px; padding: 14px 32px;
    font-size: 15px; font-weight: 700; transition: transform 0.15s, box-shadow 0.15s;
  }
  .ps-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
  .ps-hero-mockup {
    border-radius: 16px; overflow: hidden;
    border: 1px solid var(--line);
    box-shadow: 0 8px 32px rgba(0,0,0,0.08);
    max-width: 360px;
  }
  .ps-hero-mockup img { width: 100%; height: auto; display: block; }
  .ps-pain { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .ps-h2 {
    font-size: clamp(1.5rem, 3.5vw, 2.1rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); margin: 0 0 36px; text-align: center;
  }
  .ps-pain-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; max-width: 640px; margin: 0 auto; }
  .ps-pain-card {
    display: flex; align-items: flex-start; gap: 14px; padding: 20px;
    border-radius: 14px; background: var(--paper); border: 1px solid var(--line);
  }
  .ps-pain-icon {
    flex: 0 0 auto; width: 32px; height: 32px; border-radius: 8px;
    background: rgba(var(--accent-rgb), 0.08); color: var(--accent);
    display: flex; align-items: center; justify-content: center;
  }
  .ps-pain-card p { font-size: 0.92rem; line-height: 1.5; color: var(--ink); margin: 0; }
  .ps-solution { padding: 80px 0; background: var(--paper); }
  .ps-sol-sub {
    text-align: center; color: var(--ink-soft); margin: 0 0 40px;
    font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto;
  }
  .ps-feat-stack { display: flex; flex-direction: column; gap: 16px; max-width: 640px; margin: 0 auto; }
  .ps-feat {
    display: flex; gap: 18px; align-items: flex-start; padding: 24px;
    border-radius: 16px; background: var(--paper-2, #f5f5f7); border: 1px solid var(--line);
    transition: border-color .2s;
  }
  .ps-feat:hover { border-color: rgba(var(--accent-rgb), 0.3); }
  .ps-feat-icon {
    flex: 0 0 auto; width: 44px; height: 44px; border-radius: 12px;
    background: rgba(var(--accent-rgb), 0.1); color: var(--accent);
    display: flex; align-items: center; justify-content: center;
  }
  .ps-feat h3 { font-size: 1rem; font-weight: 700; margin: 0 0 6px; }
  .ps-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }
  .ps-stats { padding: 64px 0; background: var(--invert-surface); color: #fff; }
  .ps-stats-row { display: flex; justify-content: center; gap: 56px; flex-wrap: wrap; }
  .ps-stat { text-align: center; }
  .ps-stat-num { display: block; font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; color: var(--accent-2, #9d86ff); }
  .ps-stat-lbl { font-size: 0.85rem; color: rgba(255,255,255,0.55); margin-top: 4px; }
  .ps-how { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .ps-steps { display: flex; flex-direction: column; gap: 20px; max-width: 600px; margin: 0 auto; }
  .ps-step {
    display: flex; gap: 18px; align-items: flex-start; padding: 22px;
    border-radius: 14px; background: var(--paper); border: 1px solid var(--line);
  }
  .ps-step-n { flex: 0 0 auto; font-size: 1.1rem; font-weight: 800; color: var(--accent); opacity: 0.4; min-width: 28px; }
  .ps-step h3 { font-size: 0.95rem; font-weight: 700; margin: 0 0 4px; }
  .ps-step p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.5; margin: 0; }
  .ps-final { padding: 100px 0; text-align: center; background: var(--paper); border-top: 1px solid var(--line); }
  .ps-final h2 { font-size: clamp(1.7rem, 3.5vw, 2.4rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; }
  .ps-final p { color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; }
  .ps-seo-ask { padding: 64px 0; background: var(--paper-2, #f5f5f7); }
  .ps-seo-ask h2 { font-size: clamp(1.3rem, 3vw, 1.8rem); margin: 0 0 16px; }
  .ps-seo-ask p { font-size: 0.95rem; color: var(--ink-soft); line-height: 1.7; max-width: 60ch; margin: 0 auto; text-align: center; }
  .ps-seo-related { padding: 32px 0; background: var(--paper); border-top: 1px solid var(--line); text-align: center; }
  .ps-seo-related p { font-size: 0.88rem; color: var(--ink-soft); margin: 0; }
  .ps-seo-related a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .ps-seo-related a:hover { color: var(--ink); }
  @media (max-width: 720px) {
    .ps-hero { padding: 64px 0 48px; }
    .ps-hero-grid { grid-template-columns: 1fr; text-align: center; }
    .ps-hero-copy { display: flex; flex-direction: column; align-items: center; order: -1; }
    .ps-hero-mockup { max-width: 280px; margin: 0 auto; }
    .ps-pain, .ps-solution, .ps-how { padding: 56px 0; }
    .ps-pain-grid { grid-template-columns: 1fr; }
    .ps-feat-stack { gap: 12px; }
    .ps-stats { padding: 48px 0; }
    .ps-stats-row { gap: 32px; }
    .ps-final { padding: 72px 0; }
  }
</style>
