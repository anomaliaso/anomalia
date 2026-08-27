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
  const tk = 'pain.consistency';
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
        "name": "How often should you post on social media?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "For most platforms, posting 3-5 times per week is optimal. Consistency matters more than volume — it's better to post 3 times every week than 7 times one week and nothing the next. A steady schedule builds audience trust and algorithm favor."
        }
      },
      {
        "@type": "Question",
        "name": "Why is consistency important for social media growth?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Consistency signals to both your audience and platform algorithms that your account is active and reliable. Accounts that post regularly see up to 2x more engagement than those with irregular schedules, because algorithms favor predictable content patterns."
        }
      },
      {
        "@type": "Question",
        "name": "What are the best times to post on social media?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Best posting times vary by platform and audience. Generally, weekdays between 9-11 AM and 1-3 PM perform well. However, the most important factor is consistency — picking set times and sticking to them matters more than chasing the 'perfect' hour."
        }
      },
      {
        "@type": "Question",
        "name": "How do I maintain a consistent posting schedule?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Use a content calendar to plan posts in advance, batch-create content weekly, and leverage scheduling tools to auto-publish. Setting up a repeatable workflow removes the guesswork and ensures you never miss a posting day."
        }
      }
    ]
  }
  </script>
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main class="co-page">
  <section class="co-hero">
    <div class="co-wrap co-hero-grid">
      <div class="co-hero-copy">
        <span class="co-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="co-h1">{$_(`${tk}.headline`)}</h1>
        <p class="co-sub">{$_(`${tk}.sub`)}</p>
        <a class="co-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      </div>
      <div class="co-hero-cal" aria-hidden="true">
        <div class="co-cal-grid">
          {#each Array.from({length: 28}) as _, d}
            <div class="co-cal-day" class:co-cal-gap={d === 3 || d === 7 || d === 12 || d === 18 || d === 23}
                 class:co-cal-hit={d !== 3 && d !== 7 && d !== 12 && d !== 18 && d !== 23 && d % 2 === 0}
                 class:co-cal-miss={d !== 3 && d !== 7 && d !== 12 && d !== 18 && d !== 23 && d % 2 !== 0}>
              {#if d === 3 || d === 7 || d === 12 || d === 18 || d === 23}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/></svg>
              {:else}
                <span class="co-cal-dot"></span>
              {/if}
            </div>
          {/each}
        </div>
        <div class="co-cal-label">4 weeks · 5 gaps</div>
      </div>
    </div>
  </section>

  <section class="co-pain">
    <div class="co-wrap">
      <h2 class="co-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="co-pain-bars">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="co-bar">
            <div class="co-bar-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="2" width="16" height="16" rx="4" stroke="var(--accent)" stroke-width="1.5" />
                <path d="M6 10h8" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="2 3" />
              </svg>
            </div>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="co-solution">
    <div class="co-wrap">
      <h2 class="co-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="co-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="co-feat-grid">
        {#each [1, 2, 3] as i (i)}
          <div class="co-feat">
            <div class="co-feat-badge">{i}</div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="co-stats">
    <div class="co-wrap">
      <div class="co-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="co-stat">
            <span class="co-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="co-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="co-how">
    <div class="co-wrap">
      <h2 class="co-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="co-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="co-step">
            <div class="co-step-n">{i}</div>
            <div><h3>{$_(`${tk}.how.s${i}.title`)}</h3><p>{$_(`${tk}.how.s${i}.desc`)}</p></div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="co-seo-ask">
    <div class="co-wrap">
      <h2 class="co-h2">What happens when you post consistently on social media?</h2>
      <p>Consistent posting trains the algorithm to show your content to more people. Over 4-8 weeks of regular posting, accounts typically see a 30-50% increase in reach and follower growth. Your audience learns when to expect content, which builds loyalty and improves engagement rates over time.</p>
    </div>
  </section>

  <section class="co-seo-related">
    <div class="co-wrap">
      <p>Related: <a href={lp('/scheduling')}>Social media scheduling tools</a> · <a href={lp('/posting-schedule')}>Best times to post on social media</a> · <a href={lp('/content-calendar')}>Content calendar planning</a></p>
    </div>
  </section>

  <section class="co-final">
    <div class="co-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="co-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .co-wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }

  .co-hero {
    padding: 100px 0 80px; background: var(--paper);
    border-bottom: 1px solid var(--line);
  }
  .co-hero-grid { display: grid; grid-template-columns: 1fr 320px; gap: 48px; align-items: center; }
  .co-eyebrow {
    display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--accent); background: rgba(var(--accent-rgb), 0.08);
    padding: 5px 14px; border-radius: 999px; margin-bottom: 20px;
  }
  .co-h1 {
    font-size: clamp(2rem, 4.5vw, 3rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); line-height: 1.08; margin: 0;
  }
  .co-sub { font-size: 1.1rem; line-height: 1.6; color: var(--ink-soft); margin: 18px 0 0; max-width: 42ch; }
  .co-cta {
    display: inline-flex; margin-top: 28px; background: var(--invert-surface); color: #fff;
    text-decoration: none; border-radius: 980px; padding: 14px 32px;
    font-size: 15px; font-weight: 700; transition: transform 0.15s, box-shadow 0.15s;
  }
  .co-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }

  .co-hero-cal { background: var(--paper-2, #f5f5f7); border-radius: 20px; padding: 28px; border: 1px solid var(--line); }
  .co-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
  .co-cal-day {
    width: 100%; aspect-ratio: 1; border-radius: 8px; display: flex;
    align-items: center; justify-content: center; transition: all .3s;
  }
  .co-cal-hit { background: rgba(var(--accent-rgb), 0.15); }
  .co-cal-miss { background: rgba(var(--accent-rgb), 0.04); }
  .co-cal-gap { background: rgba(var(--accent-rgb), 0.06); border: 1px dashed rgba(var(--accent-rgb), 0.2); }
  .co-cal-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  .co-cal-label { margin-top: 16px; text-align: center; font-size: 12px; color: var(--ink-soft); font-weight: 600; }

  .co-pain { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .co-h2 {
    font-size: clamp(1.5rem, 3.5vw, 2.1rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); margin: 0 0 36px; text-align: center;
  }
  .co-pain-bars { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; max-width: 640px; margin: 0 auto; }
  .co-bar {
    display: flex; align-items: flex-start; gap: 14px; padding: 20px;
    border-radius: 14px; background: var(--paper); border: 1px solid var(--line);
  }
  .co-bar-icon { flex: 0 0 auto; margin-top: 2px; }
  .co-bar p { font-size: 0.92rem; line-height: 1.5; color: var(--ink); margin: 0; }

  .co-solution { padding: 80px 0; background: var(--paper); }
  .co-sol-sub {
    text-align: center; color: var(--ink-soft); margin: 0 0 40px;
    font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto;
  }
  .co-feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .co-feat {
    padding: 32px 24px; border-radius: 16px; border: 1px solid var(--line);
    background: var(--paper); text-align: center; transition: box-shadow .2s;
  }
  .co-feat:hover { box-shadow: 0 8px 24px rgba(var(--accent-rgb), 0.08); }
  .co-feat-badge {
    width: 36px; height: 36px; border-radius: 50%; background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 14px;
    font-weight: 800; margin: 0 auto 16px;
  }
  .co-feat h3 { font-size: 1rem; font-weight: 700; margin: 0 0 8px; }
  .co-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }

  .co-stats { padding: 64px 0; background: var(--invert-surface); color: #fff; }
  .co-stats-row { display: flex; justify-content: center; gap: 56px; flex-wrap: wrap; }
  .co-stat { text-align: center; }
  .co-stat-num { display: block; font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; color: var(--accent-2, #9d86ff); }
  .co-stat-lbl { font-size: 0.85rem; color: rgba(255,255,255,0.55); margin-top: 4px; }

  .co-how { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .co-steps { display: flex; flex-direction: column; gap: 20px; max-width: 600px; margin: 0 auto; }
  .co-step {
    display: flex; gap: 18px; align-items: flex-start; padding: 22px;
    border-radius: 14px; background: var(--paper); border: 1px solid var(--line);
  }
  .co-step-n {
    flex: 0 0 auto; width: 36px; height: 36px; border-radius: 50%;
    background: var(--accent); color: #fff; display: flex; align-items: center;
    justify-content: center; font-size: 15px; font-weight: 700;
  }
  .co-step h3 { font-size: 0.95rem; font-weight: 700; margin: 0 0 4px; }
  .co-step p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.5; margin: 0; }

  .co-final { padding: 100px 0; text-align: center; background: var(--paper); border-top: 1px solid var(--line); }
  .co-final h2 { font-size: clamp(1.7rem, 3.5vw, 2.4rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; }
  .co-final p { color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; }

  .co-seo-ask { padding: 64px 0; background: var(--paper-2, #f5f5f7); }
  .co-seo-ask h2 { font-size: clamp(1.3rem, 3vw, 1.8rem); margin: 0 0 16px; }
  .co-seo-ask p { font-size: 0.95rem; color: var(--ink-soft); line-height: 1.7; max-width: 60ch; margin: 0 auto; text-align: center; }
  .co-seo-related { padding: 32px 0; background: var(--paper); border-top: 1px solid var(--line); text-align: center; }
  .co-seo-related p { font-size: 0.88rem; color: var(--ink-soft); margin: 0; }
  .co-seo-related a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .co-seo-related a:hover { color: var(--ink); }

  @media (max-width: 720px) {
    .co-hero { padding: 64px 0 48px; }
    .co-hero-grid { grid-template-columns: 1fr; text-align: center; }
    .co-hero-copy { display: flex; flex-direction: column; align-items: center; }
    .co-hero-cal { max-width: 280px; margin: 0 auto; }
    .co-pain, .co-solution, .co-how { padding: 56px 0; }
    .co-pain-bars { grid-template-columns: 1fr; }
    .co-feat-grid { grid-template-columns: 1fr; }
    .co-stats { padding: 48px 0; }
    .co-stats-row { gap: 32px; }
    .co-final { padding: 72px 0; }
  }
</style>
