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
  const tk = 'pain.engagement';
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
        "name": "What is a good engagement rate on social media?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "A good engagement rate varies by platform: 1-3% on Instagram, 0.5-1% on TikTok, and 0.5-1.5% on LinkedIn. However, rates above 3% on any platform indicate a highly engaged audience. Quality of engagement (meaningful comments, saves, shares) matters more than raw numbers."
        }
      },
      {
        "@type": "Question",
        "name": "How do you increase social media engagement?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Increase engagement by asking questions in captions, using strong calls-to-action, posting when your audience is most active, creating carousel and video content, and responding to every comment within the first hour of posting."
        }
      },
      {
        "@type": "Question",
        "name": "What type of content gets the most engagement?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Short-form video (Reels, TikToks) and carousel posts consistently outperform static images. Educational content that teaches something actionable and behind-the-scenes content that humanizes your brand tend to generate the highest engagement rates across all platforms."
        }
      },
      {
        "@type": "Question",
        "name": "Why is engagement more important than follower count?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Engagement measures how actively your audience interacts with your content, which directly impacts algorithm reach. An account with 1,000 engaged followers will outperform one with 10,000 passive followers in terms of sales, brand awareness, and organic growth."
        }
      }
    ]
  }
  </script>
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main class="en-page">
  <section class="en-hero">
    <div class="en-wrap en-hero-grid">
      <div class="en-hero-copy">
        <span class="en-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="en-h1">{$_(`${tk}.headline`)}</h1>
        <p class="en-sub">{$_(`${tk}.sub`)}</p>
        <a class="en-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      </div>
      <div class="en-hero-mockup">
        <img src="/hero/post2.png" alt="Social media analytics dashboard showing engagement metrics and growth trends" loading="lazy" />
      </div>
    </div>
  </section>

  <section class="en-pain">
    <div class="en-wrap">
      <h2 class="en-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="en-pain-compare">
        <div class="en-pain-side">
          <div class="en-pain-tag">Before</div>
          {#each [1, 2] as i (i)}
            <div class="en-pain-row">
              <div class="en-pain-bar en-pain-bar-low" style={`width: ${15 + i * 8}%`}></div>
              <p>{$_(`${tk}.problem.b${i}`)}</p>
            </div>
          {/each}
        </div>
        <div class="en-pain-divider"></div>
        <div class="en-pain-side">
          <div class="en-pain-tag en-pain-tag-ok">After</div>
          {#each [3, 4] as i (i)}
            <div class="en-pain-row">
              <div class="en-pain-bar en-pain-bar-high" style={`width: ${40 + i * 12}%`}></div>
              <p>{$_(`${tk}.problem.b${i}`)}</p>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </section>

  <section class="en-solution">
    <div class="en-wrap">
      <h2 class="en-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="en-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="en-feat-grid">
        {#each [1, 2, 3] as i (i)}
          <div class="en-feat">
            <div class="en-feat-badge">{i}</div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="en-stats">
    <div class="en-wrap">
      <div class="en-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="en-stat">
            <span class="en-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="en-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="en-how">
    <div class="en-wrap">
      <h2 class="en-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="en-how-grid">
        {#each [1, 2, 3] as i (i)}
          <div class="en-how-card">
            <span class="en-how-num">{i}</span>
            <h3>{$_(`${tk}.how.s${i}.title`)}</h3>
            <p>{$_(`${tk}.how.s${i}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="en-seo-ask">
    <div class="en-wrap">
      <h2 class="en-h2">How long does it take to see engagement improvements?</h2>
      <p>Most accounts see measurable engagement improvements within 2-4 weeks of implementing a consistent content strategy. By optimizing caption hooks, posting at peak times, and using AI to write more compelling copy, engagement rates typically increase by 20-40% in the first month.</p>
    </div>
  </section>

  <section class="en-seo-related">
    <div class="en-wrap">
      <p>Related: <a href={lp('/analytics')}>Social media analytics tracking</a> · <a href={lp('/roi')}>Measure social media ROI</a> · <a href={lp('/autoposts')}>Captions written for you</a></p>
    </div>
  </section>

  <section class="en-final">
    <div class="en-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="en-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .en-wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }
  .en-hero { padding: 100px 0 80px; background: var(--paper); border-bottom: 1px solid var(--line); }
  .en-hero-grid { display: grid; grid-template-columns: 1fr 320px; gap: 48px; align-items: center; }
  .en-eyebrow {
    display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--accent); background: rgba(var(--accent-rgb), 0.08);
    padding: 5px 14px; border-radius: 999px; margin-bottom: 20px;
  }
  .en-h1 {
    font-size: clamp(2rem, 4.5vw, 3rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); line-height: 1.08; margin: 0;
  }
  .en-sub { font-size: 1.1rem; line-height: 1.6; color: var(--ink-soft); margin: 18px 0 0; max-width: 42ch; }
  .en-cta {
    display: inline-flex; margin-top: 28px; background: var(--invert-surface); color: #fff;
    text-decoration: none; border-radius: 980px; padding: 14px 32px;
    font-size: 15px; font-weight: 700; transition: transform 0.15s, box-shadow 0.15s;
  }
  .en-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
  .en-hero-mockup {
    border-radius: 16px; overflow: hidden;
    border: 1px solid var(--line);
    box-shadow: 0 8px 32px rgba(0,0,0,0.08);
    max-width: 360px;
  }
  .en-hero-mockup img { width: 100%; height: auto; display: block; }
  .en-pain { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .en-h2 {
    font-size: clamp(1.5rem, 3.5vw, 2.1rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); margin: 0 0 36px; text-align: center;
  }
  .en-pain-compare { display: grid; grid-template-columns: 1fr auto 1fr; gap: 24px; max-width: 720px; margin: 0 auto; }
  .en-pain-divider { width: 1px; background: var(--line); }
  .en-pain-side { display: flex; flex-direction: column; gap: 16px; }
  .en-pain-tag {
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
    color: rgba(var(--accent-rgb), 0.6); margin-bottom: 4px;
  }
  .en-pain-tag-ok { color: var(--accent); }
  .en-pain-row { display: flex; flex-direction: column; gap: 6px; }
  .en-pain-bar { height: 8px; border-radius: 4px; transition: width 1s ease; }
  .en-pain-bar-low { background: rgba(var(--accent-rgb), 0.08); }
  .en-pain-bar-high { background: rgba(var(--accent-rgb), 0.25); }
  .en-pain-row p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.45; margin: 0; }
  .en-solution { padding: 80px 0; background: var(--paper); }
  .en-sol-sub {
    text-align: center; color: var(--ink-soft); margin: 0 0 40px;
    font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto;
  }
  .en-feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .en-feat {
    padding: 32px 24px; border-radius: 16px; border: 1px solid var(--line);
    background: var(--paper); text-align: center; transition: box-shadow .2s;
  }
  .en-feat:hover { box-shadow: 0 8px 24px rgba(var(--accent-rgb), 0.08); }
  .en-feat-badge {
    width: 36px; height: 36px; border-radius: 50%; background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 14px;
    font-weight: 800; margin: 0 auto 16px;
  }
  .en-feat h3 { font-size: 1rem; font-weight: 700; margin: 0 0 8px; }
  .en-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }
  .en-stats { padding: 64px 0; background: var(--invert-surface); color: #fff; }
  .en-stats-row { display: flex; justify-content: center; gap: 56px; flex-wrap: wrap; }
  .en-stat { text-align: center; }
  .en-stat-num { display: block; font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; color: var(--accent-2, #9d86ff); }
  .en-stat-lbl { font-size: 0.85rem; color: rgba(255,255,255,0.55); margin-top: 4px; }
  .en-how { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .en-how-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .en-how-card {
    padding: 28px 22px; border-radius: 16px; background: var(--paper);
    border: 1px solid var(--line); position: relative; overflow: hidden;
  }
  .en-how-num {
    position: absolute; top: 12px; right: 16px; font-size: 3rem; font-weight: 900;
    color: rgba(var(--accent-rgb), 0.06); line-height: 1;
  }
  .en-how-card h3 { font-size: 0.95rem; font-weight: 700; margin: 0 0 6px; position: relative; }
  .en-how-card p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.5; margin: 0; position: relative; }
  .en-final { padding: 100px 0; text-align: center; background: var(--paper); border-top: 1px solid var(--line); }
  .en-final h2 { font-size: clamp(1.7rem, 3.5vw, 2.4rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; }
  .en-final p { color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; }
  .en-seo-ask { padding: 64px 0; background: var(--paper-2, #f5f5f7); }
  .en-seo-ask h2 { font-size: clamp(1.3rem, 3vw, 1.8rem); margin: 0 0 16px; }
  .en-seo-ask p { font-size: 0.95rem; color: var(--ink-soft); line-height: 1.7; max-width: 60ch; margin: 0 auto; text-align: center; }
  .en-seo-related { padding: 32px 0; background: var(--paper); border-top: 1px solid var(--line); text-align: center; }
  .en-seo-related p { font-size: 0.88rem; color: var(--ink-soft); margin: 0; }
  .en-seo-related a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .en-seo-related a:hover { color: var(--ink); }
  @media (max-width: 720px) {
    .en-hero { padding: 64px 0 48px; }
    .en-hero-grid { grid-template-columns: 1fr; text-align: center; }
    .en-hero-copy { display: flex; flex-direction: column; align-items: center; }
    .en-hero-mockup { max-width: 280px; margin: 0 auto; }
    .en-pain { padding: 56px 0; }
    .en-pain-compare { grid-template-columns: 1fr; gap: 32px; }
    .en-pain-divider { width: 100%; height: 1px; }
    .en-solution, .en-how { padding: 56px 0; }
    .en-feat-grid, .en-how-grid { grid-template-columns: 1fr; }
    .en-stats { padding: 48px 0; }
    .en-stats-row { gap: 32px; }
    .en-final { padding: 72px 0; }
  }
</style>
