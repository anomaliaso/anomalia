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
  const tk = 'pain.roi';
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
        "name": "How do you measure social media ROI?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Social media ROI is measured by comparing the revenue generated from social media activities against the total cost (time, tools, ad spend). Track metrics like click-through rates, conversion rates, and customer acquisition cost to calculate your return accurately."
        }
      },
      {
        "@type": "Question",
        "name": "What metrics matter most for social media ROI?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "The most important ROI metrics are conversion rate, cost per click, customer lifetime value, and revenue attributed to social channels. Vanity metrics like follower count matter less than actionable metrics that connect directly to business outcomes."
        }
      },
      {
        "@type": "Question",
        "name": "Is social media worth the investment for small businesses?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Yes. When managed efficiently with the right tools, social media delivers an average ROI of $2.80 for every $1 spent. The key is using automation to reduce time investment while maintaining quality content that drives real business results."
        }
      },
      {
        "@type": "Question",
        "name": "How long before social media shows ROI?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Most businesses see initial ROI indicators within 3-6 months of consistent social media activity. Direct revenue attribution typically becomes clear after 6-12 months. Using analytics tools to track the full customer journey accelerates this timeline significantly."
        }
      }
    ]
  }
  </script>
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main class="ro-page">
  <section class="ro-hero">
    <div class="ro-wrap ro-hero-grid">
      <div class="ro-hero-copy">
        <span class="ro-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="ro-h1">{$_(`${tk}.headline`)}</h1>
        <p class="ro-sub">{$_(`${tk}.sub`)}</p>
        <a class="ro-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      </div>
      <div class="ro-hero-mockup">
        <img src="/showcase/monitor.jpg" alt="Social media analytics dashboard displaying ROI metrics and conversion data" loading="lazy" />
      </div>
    </div>
  </section>

  <section class="ro-pain">
    <div class="ro-wrap">
      <h2 class="ro-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="ro-pain-list">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="ro-pain-item">
            <span class="ro-pain-x">?</span>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ro-solution">
    <div class="ro-wrap">
      <h2 class="ro-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="ro-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="ro-feat-row">
        {#each [1, 2, 3] as i (i)}
          <div class="ro-feat">
            <div class="ro-feat-top">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M11 2v18M2 11h18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
              </svg>
            </div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ro-stats">
    <div class="ro-wrap">
      <div class="ro-stats-grid">
        {#each [1, 2, 3] as i (i)}
          <div class="ro-stat-card">
            <span class="ro-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="ro-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ro-how">
    <div class="ro-wrap">
      <h2 class="ro-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="ro-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="ro-step">
            <div class="ro-step-n">{i}</div>
            <div><h3>{$_(`${tk}.how.s${i}.title`)}</h3><p>{$_(`${tk}.how.s${i}.desc`)}</p></div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="ro-seo-ask">
    <div class="ro-wrap">
      <h2 class="ro-h2">Can you track social media sales without expensive tools?</h2>
      <p>Yes. Most social platforms offer built-in analytics that show click-through rates and conversions. Combined with UTM parameters in your links and a simple spreadsheet to track customer sources, you can accurately measure which social media activities generate revenue without investing in enterprise analytics software.</p>
    </div>
  </section>

  <section class="ro-seo-related">
    <div class="ro-wrap">
      <p>Related: <a href={lp('/analytics')}>Social media analytics tools</a> · <a href={lp('/strategy')}>Build a social media strategy</a> · <a href={lp('/no-results')}>Why social media isn't working</a></p>
    </div>
  </section>

  <section class="ro-final">
    <div class="ro-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="ro-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .ro-wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }
  .ro-hero { padding: 100px 0 80px; background: var(--paper); border-bottom: 1px solid var(--line); }
  .ro-hero-grid { display: grid; grid-template-columns: 1fr 360px; gap: 48px; align-items: center; }
  .ro-eyebrow {
    display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--accent); background: rgba(var(--accent-rgb), 0.08);
    padding: 5px 14px; border-radius: 999px; margin-bottom: 20px;
  }
  .ro-h1 {
    font-size: clamp(2rem, 4.5vw, 3rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); line-height: 1.08; margin: 0;
  }
  .ro-sub { font-size: 1.1rem; line-height: 1.6; color: var(--ink-soft); margin: 18px 0 0; max-width: 42ch; }
  .ro-cta {
    display: inline-flex; margin-top: 28px; background: var(--invert-surface); color: #fff;
    text-decoration: none; border-radius: 980px; padding: 14px 32px;
    font-size: 15px; font-weight: 700; transition: transform 0.15s, box-shadow 0.15s;
  }
  .ro-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
  .ro-hero-mockup {
    border-radius: 16px; overflow: hidden;
    border: 1px solid var(--line);
    box-shadow: 0 8px 32px rgba(0,0,0,0.08);
    max-width: 360px;
  }
  .ro-hero-mockup img { width: 100%; height: auto; display: block; }
  .ro-pain { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .ro-h2 {
    font-size: clamp(1.5rem, 3.5vw, 2.1rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); margin: 0 0 36px; text-align: center;
  }
  .ro-pain-list { display: flex; flex-direction: column; gap: 12px; max-width: 560px; margin: 0 auto; }
  .ro-pain-item {
    display: flex; align-items: center; gap: 16px; padding: 18px 22px;
    border-radius: 12px; background: var(--paper); border: 1px solid var(--line);
  }
  .ro-pain-x {
    flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%;
    background: rgba(var(--accent-rgb), 0.08); color: var(--accent);
    display: flex; align-items: center; justify-content: center;
    font-size: 16px; font-weight: 800;
  }
  .ro-pain-item p { font-size: 0.92rem; color: var(--ink); line-height: 1.5; margin: 0; }
  .ro-solution { padding: 80px 0; background: var(--paper); }
  .ro-sol-sub {
    text-align: center; color: var(--ink-soft); margin: 0 0 40px;
    font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto;
  }
  .ro-feat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .ro-feat {
    padding: 28px 22px; border-radius: 16px; border: 1px solid var(--line);
    background: var(--paper); transition: border-color .2s, box-shadow .2s;
  }
  .ro-feat:hover { border-color: rgba(var(--accent-rgb), 0.3); box-shadow: 0 8px 24px rgba(var(--accent-rgb), 0.06); }
  .ro-feat-top {
    width: 44px; height: 44px; border-radius: 12px;
    background: rgba(var(--accent-rgb), 0.1); color: var(--accent);
    display: flex; align-items: center; justify-content: center; margin-bottom: 16px;
  }
  .ro-feat h3 { font-size: 1rem; font-weight: 700; margin: 0 0 8px; }
  .ro-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }
  .ro-stats { padding: 64px 0; background: var(--invert-surface); color: #fff; }
  .ro-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .ro-stat-card {
    text-align: center; padding: 32px 20px; border-radius: 16px;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08);
  }
  .ro-stat-num { display: block; font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; color: var(--accent-2, #9d86ff); }
  .ro-stat-lbl { font-size: 0.85rem; color: rgba(255,255,255,0.55); margin-top: 6px; display: block; }
  .ro-how { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .ro-steps { display: flex; flex-direction: column; gap: 20px; max-width: 600px; margin: 0 auto; }
  .ro-step {
    display: flex; gap: 18px; align-items: flex-start; padding: 22px;
    border-radius: 14px; background: var(--paper); border: 1px solid var(--line);
  }
  .ro-step-n {
    flex: 0 0 auto; width: 36px; height: 36px; border-radius: 50%;
    background: var(--accent); color: #fff; display: flex; align-items: center;
    justify-content: center; font-size: 15px; font-weight: 700;
  }
  .ro-step h3 { font-size: 0.95rem; font-weight: 700; margin: 0 0 4px; }
  .ro-step p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.5; margin: 0; }
  .ro-final { padding: 100px 0; text-align: center; background: var(--paper); border-top: 1px solid var(--line); }
  .ro-final h2 { font-size: clamp(1.7rem, 3.5vw, 2.4rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; }
  .ro-final p { color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; }
  .ro-seo-ask { padding: 64px 0; background: var(--paper-2, #f5f5f7); }
  .ro-seo-ask h2 { font-size: clamp(1.3rem, 3vw, 1.8rem); margin: 0 0 16px; }
  .ro-seo-ask p { font-size: 0.95rem; color: var(--ink-soft); line-height: 1.7; max-width: 60ch; margin: 0 auto; text-align: center; }
  .ro-seo-related { padding: 32px 0; background: var(--paper); border-top: 1px solid var(--line); text-align: center; }
  .ro-seo-related p { font-size: 0.88rem; color: var(--ink-soft); margin: 0; }
  .ro-seo-related a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .ro-seo-related a:hover { color: var(--ink); }
  @media (max-width: 720px) {
    .ro-hero { padding: 64px 0 48px; }
    .ro-hero-grid { grid-template-columns: 1fr; text-align: center; }
    .ro-hero-copy { display: flex; flex-direction: column; align-items: center; }
    .ro-hero-mockup { max-width: 280px; margin: 0 auto; }
    .ro-pain, .ro-solution, .ro-how { padding: 56px 0; }
    .ro-feat-row { grid-template-columns: 1fr; }
    .ro-stats { padding: 48px 0; }
    .ro-stats-grid { grid-template-columns: 1fr; }
    .ro-final { padding: 72px 0; }
  }
</style>
