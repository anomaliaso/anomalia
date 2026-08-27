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
  const tk = 'pain.noResults';
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
        "name": "Why is my social media not getting results?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Common reasons include inconsistent posting, lack of a clear content strategy, not engaging with your audience, posting content that doesn't match platform algorithms (e.g., only static images on a video-first platform), and not analyzing performance data to optimize what works."
        }
      },
      {
        "@type": "Question",
        "name": "How do I fix a failing social media strategy?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Start by auditing your analytics to identify what's underperforming. Focus on 1-2 platforms where your audience actually is, create a content mix of educational and entertaining posts, use data to double down on what works, and implement a consistent posting schedule."
        }
      },
      {
        "@type": "Question",
        "name": "How long does it take to see social media results?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "With a consistent strategy, most accounts see initial traction within 30-60 days and meaningful growth within 3-6 months. The key is consistent execution, data-driven adjustments, and patience — social media is a long-term investment, not a quick fix."
        }
      },
      {
        "@type": "Question",
        "name": "Should I hire someone or use tools for social media?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "For most small businesses, AI-powered automation tools deliver better ROI than hiring. Tools can handle scheduling, caption writing, and analytics for a fraction of the cost of a social media manager, while giving you full control over your brand voice and strategy."
        }
      }
    ]
  }
  </script>
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main class="nr-page">
  <section class="nr-hero">
    <div class="nr-wrap nr-hero-inner">
      <span class="nr-eyebrow">{$_(`${tk}.eyebrow`)}</span>
      <h1 class="nr-h1">{$_(`${tk}.headline`)}</h1>
      <p class="nr-sub">{$_(`${tk}.sub`)}</p>
      <a class="nr-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      <div class="nr-hero-mockup">
        <img src="/hero/post1.png" alt="Social media content planning interface showing strategy optimization" loading="lazy" />
      </div>
    </div>
  </section>

  <section class="nr-pain">
    <div class="nr-wrap">
      <h2 class="nr-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="nr-pain-row">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="nr-pain-card">
            <div class="nr-pain-num">0{i}</div>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="nr-solution">
    <div class="nr-wrap">
      <h2 class="nr-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="nr-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="nr-feat-grid">
        {#each [1, 2, 3] as i (i)}
          <div class="nr-feat">
            <div class="nr-feat-bar"></div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="nr-stats">
    <div class="nr-wrap">
      <div class="nr-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="nr-stat">
            <span class="nr-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="nr-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="nr-how">
    <div class="nr-wrap">
      <h2 class="nr-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="nr-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="nr-step">
            <div class="nr-step-ring">
              <svg viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="20" stroke="var(--line)" stroke-width="2" />
                <circle cx="24" cy="24" r="20" stroke="var(--accent)" stroke-width="2"
                  stroke-dasharray="126" stroke-dashoffset={126 - (126 * i / 3)}
                  stroke-linecap="round" transform="rotate(-90 24 24)" />
                <text x="24" y="28" text-anchor="middle" fill="var(--ink)" font-size="14" font-weight="700">{i}</text>
              </svg>
            </div>
            <div><h3>{$_(`${tk}.how.s${i}.title`)}</h3><p>{$_(`${tk}.how.s${i}.desc`)}</p></div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="nr-seo-ask">
    <div class="nr-wrap">
      <h2 class="nr-h2">What is the number one mistake businesses make on social media?</h2>
      <p>The biggest mistake is posting without a strategy. Random content without clear goals, audience targeting, or performance tracking leads to wasted effort. Successful social media requires a documented content strategy with defined KPIs, a consistent posting schedule, and regular analysis of what resonates with your audience.</p>
    </div>
  </section>

  <section class="nr-seo-related">
    <div class="nr-wrap">
      <p>Related: <a href={lp('/strategy')}>Build a social media strategy</a> · <a href={lp('/engagement')}>Increase social media engagement</a> · <a href={lp('/analytics')}>Social media analytics tools</a></p>
    </div>
  </section>

  <section class="nr-final">
    <div class="nr-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="nr-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .nr-wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }
  .nr-hero { padding: 100px 0 80px; background: var(--paper); border-bottom: 1px solid var(--line); text-align: center; }
  .nr-hero-inner { display: flex; flex-direction: column; align-items: center; }
  .nr-eyebrow {
    display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--accent); background: rgba(var(--accent-rgb), 0.08);
    padding: 5px 14px; border-radius: 999px; margin-bottom: 20px;
  }
  .nr-h1 {
    font-size: clamp(2rem, 4.5vw, 3rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); line-height: 1.08; margin: 0; max-width: 18ch;
  }
  .nr-sub { font-size: 1.1rem; line-height: 1.6; color: var(--ink-soft); margin: 18px 0 0; max-width: 44ch; }
  .nr-cta {
    display: inline-flex; margin-top: 28px; background: var(--invert-surface); color: #fff;
    text-decoration: none; border-radius: 980px; padding: 14px 32px;
    font-size: 15px; font-weight: 700; transition: transform 0.15s, box-shadow 0.15s;
  }
  .nr-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
  .nr-hero-mockup {
    margin-top: 40px; border-radius: 16px; overflow: hidden;
    border: 1px solid var(--line);
    box-shadow: 0 8px 32px rgba(0,0,0,0.08);
    max-width: 360px;
  }
  .nr-hero-mockup img { width: 100%; height: auto; display: block; }
  .nr-pain { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .nr-h2 {
    font-size: clamp(1.5rem, 3.5vw, 2.1rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); margin: 0 0 36px; text-align: center;
  }
  .nr-pain-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  .nr-pain-card {
    padding: 24px 18px; border-radius: 14px; background: var(--paper);
    border: 1px solid var(--line); text-align: center;
  }
  .nr-pain-num { font-size: 2rem; font-weight: 900; color: rgba(var(--accent-rgb), 0.1); margin-bottom: 12px; }
  .nr-pain-card p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.5; margin: 0; }
  .nr-solution { padding: 80px 0; background: var(--paper); }
  .nr-sol-sub {
    text-align: center; color: var(--ink-soft); margin: 0 0 40px;
    font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto;
  }
  .nr-feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .nr-feat {
    padding: 28px 22px; border-radius: 16px; border: 1px solid var(--line);
    background: var(--paper); position: relative; overflow: hidden;
    transition: box-shadow .2s;
  }
  .nr-feat:hover { box-shadow: 0 8px 24px rgba(var(--accent-rgb), 0.08); }
  .nr-feat-bar { position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--accent); }
  .nr-feat h3 { font-size: 1rem; font-weight: 700; margin: 0 0 8px; }
  .nr-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }
  .nr-stats { padding: 64px 0; background: var(--invert-surface); color: #fff; }
  .nr-stats-row { display: flex; justify-content: center; gap: 56px; flex-wrap: wrap; }
  .nr-stat { text-align: center; }
  .nr-stat-num { display: block; font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; color: var(--accent-2, #9d86ff); }
  .nr-stat-lbl { font-size: 0.85rem; color: rgba(255,255,255,0.55); margin-top: 4px; }
  .nr-how { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .nr-steps { display: flex; flex-direction: column; gap: 20px; max-width: 600px; margin: 0 auto; }
  .nr-step {
    display: flex; gap: 18px; align-items: flex-start; padding: 22px;
    border-radius: 14px; background: var(--paper); border: 1px solid var(--line);
  }
  .nr-step-ring { flex: 0 0 auto; width: 48px; height: 48px; }
  .nr-step-ring svg { width: 100%; height: 100%; }
  .nr-step h3 { font-size: 0.95rem; font-weight: 700; margin: 0 0 4px; }
  .nr-step p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.5; margin: 0; }
  .nr-final { padding: 100px 0; text-align: center; background: var(--paper); border-top: 1px solid var(--line); }
  .nr-final h2 { font-size: clamp(1.7rem, 3.5vw, 2.4rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; }
  .nr-final p { color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; }
  .nr-seo-ask { padding: 64px 0; background: var(--paper-2, #f5f5f7); }
  .nr-seo-ask h2 { font-size: clamp(1.3rem, 3vw, 1.8rem); margin: 0 0 16px; }
  .nr-seo-ask p { font-size: 0.95rem; color: var(--ink-soft); line-height: 1.7; max-width: 60ch; margin: 0 auto; text-align: center; }
  .nr-seo-related { padding: 32px 0; background: var(--paper); border-top: 1px solid var(--line); text-align: center; }
  .nr-seo-related p { font-size: 0.88rem; color: var(--ink-soft); margin: 0; }
  .nr-seo-related a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .nr-seo-related a:hover { color: var(--ink); }
  @media (max-width: 720px) {
    .nr-hero { padding: 64px 0 48px; }
    .nr-hero-mockup { max-width: 280px; }
    .nr-pain, .nr-solution, .nr-how { padding: 56px 0; }
    .nr-pain-row { grid-template-columns: 1fr 1fr; }
    .nr-feat-grid { grid-template-columns: 1fr; }
    .nr-stats { padding: 48px 0; }
    .nr-stats-row { gap: 32px; }
    .nr-final { padding: 72px 0; }
  }
</style>
