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
  const tk = 'pain.burnout';
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
        "name": "What is social media burnout?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Social media burnout is a state of mental, emotional, and physical exhaustion caused by the constant demands of creating content, engaging with followers, and maintaining a consistent posting schedule across multiple platforms."
        }
      },
      {
        "@type": "Question",
        "name": "How can I recover from social media burnout?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Recovery starts with automating repetitive tasks like scheduling and caption writing. Tools that handle content planning and auto-publishing can save 5-10 hours per week, giving you space to focus on creative work without the daily pressure."
        }
      },
      {
        "@type": "Question",
        "name": "How much time does social media automation save?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Most creators and small businesses save between 5 and 10 hours per week by automating content scheduling, caption writing, and performance tracking. Over a month, that's 20-40 hours redirected to higher-value tasks."
        }
      },
      {
        "@type": "Question",
        "name": "Can automation prevent social media burnout?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Yes. Automation removes the daily decision fatigue of what to post, when to post, and what to write. By batching content creation and letting tools handle publishing, you maintain consistency without the burnout cycle."
        }
      }
    ]
  }
  </script>
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main class="bo-page">
  <section class="bo-hero">
    <div class="bo-wrap bo-hero-grid">
      <div class="bo-hero-copy">
        <span class="bo-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="bo-h1">{$_(`${tk}.headline`)}</h1>
        <p class="bo-sub">{$_(`${tk}.sub`)}</p>
        <a class="bo-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      </div>
      <div class="bo-hero-mockup">
        <img src="/hero/post1.png" alt="Social media scheduling interface showing automated post planning" loading="lazy" />
      </div>
    </div>
  </section>

  <section class="bo-pain">
    <div class="bo-wrap">
      <h2 class="bo-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="bo-pain-grid">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="bo-pain-card">
            <div class="bo-pain-ring">
              <svg viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="20" stroke="var(--line)" stroke-width="3" />
                <circle cx="24" cy="24" r="20" stroke="var(--accent)" stroke-width="3"
                  stroke-dasharray="126" stroke-dashoffset={126 - (126 * (20 + i * 18) / 100)}
                  stroke-linecap="round" transform="rotate(-90 24 24)" />
              </svg>
            </div>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="bo-solution">
    <div class="bo-wrap">
      <h2 class="bo-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="bo-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="bo-feat-stack">
        {#each [1, 2, 3] as i (i)}
          <div class="bo-feat">
            <span class="bo-feat-num">0{i}</span>
            <div>
              <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
              <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="bo-stats">
    <div class="bo-wrap">
      <div class="bo-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="bo-stat">
            <span class="bo-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="bo-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="bo-how">
    <div class="bo-wrap">
      <h2 class="bo-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="bo-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="bo-step">
            <div class="bo-step-n">{i}</div>
            <div><h3>{$_(`${tk}.how.s${i}.title`)}</h3><p>{$_(`${tk}.how.s${i}.desc`)}</p></div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="bo-seo-ask">
    <div class="bo-wrap">
      <h2 class="bo-h2">How do you stop social media from being overwhelming?</h2>
      <p>The key is to systematize your workflow. Instead of creating content reactively every day, batch your work into one or two sessions per week, use AI-assisted caption writing, and let automation tools handle the publishing. This shifts social media from a daily stressor to a manageable weekly task.</p>
    </div>
  </section>

  <section class="bo-seo-related">
    <div class="bo-wrap">
      <p>Related: <a href={lp('/consistency')}>How to post consistently</a> · <a href={lp('/not-working')}>Why social media isn't working</a> · <a href={lp('/posting-schedule')}>Best times to post on social media</a></p>
    </div>
  </section>

  <section class="bo-final">
    <div class="bo-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="bo-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .bo-wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }
  .bo-hero { padding: 100px 0 80px; background: var(--paper); border-bottom: 1px solid var(--line); }
  .bo-hero-grid { display: grid; grid-template-columns: 1fr 320px; gap: 48px; align-items: center; }
  .bo-eyebrow {
    display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--accent); background: rgba(var(--accent-rgb), 0.08);
    padding: 5px 14px; border-radius: 999px; margin-bottom: 20px;
  }
  .bo-h1 {
    font-size: clamp(2rem, 4.5vw, 3rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); line-height: 1.08; margin: 0;
  }
  .bo-sub { font-size: 1.1rem; line-height: 1.6; color: var(--ink-soft); margin: 18px 0 0; max-width: 42ch; }
  .bo-cta {
    display: inline-flex; margin-top: 28px; background: var(--invert-surface); color: #fff;
    text-decoration: none; border-radius: 980px; padding: 14px 32px;
    font-size: 15px; font-weight: 700; transition: transform 0.15s, box-shadow 0.15s;
  }
  .bo-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
  .bo-hero-mockup {
    border-radius: 16px; overflow: hidden;
    border: 1px solid var(--line);
    box-shadow: 0 8px 32px rgba(0,0,0,0.08);
    max-width: 360px;
  }
  .bo-hero-mockup img { width: 100%; height: auto; display: block; }
  .bo-pain { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .bo-h2 {
    font-size: clamp(1.5rem, 3.5vw, 2.1rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); margin: 0 0 36px; text-align: center;
  }
  .bo-pain-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .bo-pain-card {
    display: flex; flex-direction: column; align-items: center; gap: 14px;
    padding: 28px 16px; border-radius: 16px; background: var(--paper);
    border: 1px solid var(--line); text-align: center;
  }
  .bo-pain-ring { width: 48px; height: 48px; }
  .bo-pain-ring svg { width: 100%; height: 100%; }
  .bo-pain-card p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.5; margin: 0; }
  .bo-solution { padding: 80px 0; background: var(--paper); }
  .bo-sol-sub {
    text-align: center; color: var(--ink-soft); margin: 0 0 40px;
    font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto;
  }
  .bo-feat-stack { display: flex; flex-direction: column; gap: 16px; max-width: 640px; margin: 0 auto; }
  .bo-feat {
    display: flex; gap: 20px; align-items: flex-start; padding: 24px;
    border-radius: 14px; background: var(--paper-2, #f5f5f7); border: 1px solid var(--line);
    transition: border-color .2s;
  }
  .bo-feat:hover { border-color: rgba(var(--accent-rgb), 0.3); }
  .bo-feat-num { flex: 0 0 auto; font-size: 1.6rem; font-weight: 800; color: var(--accent); opacity: 0.3; line-height: 1; }
  .bo-feat h3 { font-size: 1rem; font-weight: 700; margin: 0 0 6px; }
  .bo-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }
  .bo-stats { padding: 64px 0; background: var(--invert-surface); color: #fff; }
  .bo-stats-row { display: flex; justify-content: center; gap: 56px; flex-wrap: wrap; }
  .bo-stat { text-align: center; }
  .bo-stat-num { display: block; font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; color: var(--accent-2, #9d86ff); }
  .bo-stat-lbl { font-size: 0.85rem; color: rgba(255,255,255,0.55); margin-top: 4px; }
  .bo-how { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .bo-steps { display: flex; flex-direction: column; gap: 20px; max-width: 600px; margin: 0 auto; }
  .bo-step {
    display: flex; gap: 18px; align-items: flex-start; padding: 22px;
    border-radius: 14px; background: var(--paper); border: 1px solid var(--line);
  }
  .bo-step-n {
    flex: 0 0 auto; width: 36px; height: 36px; border-radius: 50%;
    background: var(--accent); color: #fff; display: flex; align-items: center;
    justify-content: center; font-size: 15px; font-weight: 700;
  }
  .bo-step h3 { font-size: 0.95rem; font-weight: 700; margin: 0 0 4px; }
  .bo-step p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.5; margin: 0; }
  .bo-final { padding: 100px 0; text-align: center; background: var(--paper); border-top: 1px solid var(--line); }
  .bo-final h2 { font-size: clamp(1.7rem, 3.5vw, 2.4rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; }
  .bo-final p { color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; }
  .bo-seo-ask { padding: 64px 0; background: var(--paper-2, #f5f5f7); }
  .bo-seo-ask h2 { font-size: clamp(1.3rem, 3vw, 1.8rem); margin: 0 0 16px; }
  .bo-seo-ask p { font-size: 0.95rem; color: var(--ink-soft); line-height: 1.7; max-width: 60ch; margin: 0 auto; text-align: center; }
  .bo-seo-related { padding: 32px 0; background: var(--paper); border-top: 1px solid var(--line); text-align: center; }
  .bo-seo-related p { font-size: 0.88rem; color: var(--ink-soft); margin: 0; }
  .bo-seo-related a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .bo-seo-related a:hover { color: var(--ink); }
  @media (max-width: 720px) {
    .bo-hero { padding: 64px 0 48px; }
    .bo-hero-grid { grid-template-columns: 1fr; text-align: center; }
    .bo-hero-copy { display: flex; flex-direction: column; align-items: center; }
    .bo-hero-mockup { max-width: 280px; margin: 0 auto; }
    .bo-pain, .bo-solution, .bo-how { padding: 56px 0; }
    .bo-pain-grid { grid-template-columns: 1fr 1fr; }
    .bo-feat-stack { gap: 12px; }
    .bo-stats { padding: 48px 0; }
    .bo-stats-row { gap: 32px; }
    .bo-final { padding: 72px 0; }
  }
</style>
