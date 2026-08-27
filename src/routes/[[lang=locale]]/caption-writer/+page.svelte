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
  const tk = 'pain.captionWriter';
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
        "name": "How do you write good social media captions?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Good captions start with a strong hook in the first line, deliver value or emotion in the body, and end with a clear call-to-action. Keep language conversational, use line breaks for readability, include relevant hashtags, and match the tone to your brand voice and platform culture."
        }
      },
      {
        "@type": "Question",
        "name": "Can AI write social media captions for me?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Yes. AI caption tools analyze your brand voice, target audience, and content topic to generate platform-optimized captions. They can produce multiple variations in seconds, suggest hashtags, and adapt tone for different platforms. AI captions work best as a starting point that you personalize with your unique perspective."
        }
      },
      {
        "@type": "Question",
        "name": "How long should social media captions be?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "It depends on the platform. Instagram captions perform well at 138-150 characters for short posts or 500+ for storytelling. TikTok captions should be under 150 characters. LinkedIn posts get the most engagement at 1,200-1,500 characters. X (Twitter) works best under 100 characters. Always front-load the most important text."
        }
      },
      {
        "@type": "Question",
        "name": "What makes a caption engaging?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Engaging captions use a strong hook to stop the scroll, ask questions to invite comments, tell stories that create emotional connection, and include clear CTAs that drive action. The best captions feel like a conversation with a friend, not a marketing message."
        }
      }
    ]
  }
  </script>
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main class="cw-page">
  <section class="cw-hero">
    <div class="cw-wrap cw-hero-grid">
      <div class="cw-hero-mockup">
        <div class="cw-phone">
          <div class="cw-phone-notch"></div>
          <div class="cw-phone-post">
            <img src="/hero/post3.png" alt="AI-powered caption writer generating social media post text" loading="lazy" />
          </div>
          <div class="cw-phone-caption">
            <span class="cw-type-cursor"></span>How to grow your audience in 2025...
          </div>
          <div class="cw-phone-bar">
            <span>♡ 2.4k</span><span>💬 186</span><span>↗ 542</span>
          </div>
        </div>
      </div>
      <div class="cw-hero-copy">
        <span class="cw-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="cw-h1">{$_(`${tk}.headline`)}</h1>
        <p class="cw-sub">{$_(`${tk}.sub`)}</p>
        <a class="cw-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      </div>
    </div>
  </section>

  <section class="cw-pain">
    <div class="cw-wrap">
      <h2 class="cw-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="cw-pain-cols">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="cw-pain-item">
            <div class="cw-pain-mark">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </div>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="cw-solution">
    <div class="cw-wrap">
      <h2 class="cw-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="cw-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="cw-feat-cards">
        {#each [1, 2, 3] as i (i)}
          <div class="cw-feat">
            <div class="cw-feat-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
            <div class="cw-feat-preview">
              <div class="cw-preview-img">
                <img src="/hero/post{i}.png" alt="Social media caption preview example {i} showing AI-generated text" loading="lazy" />
              </div>
              <div class="cw-preview-text">
                {#if i === 1}✨ 5 tips to boost engagement today...{:else if i === 2}Your brand story matters. Here's how to tell it...{:else}🚀 Ready to transform your social presence?...{/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="cw-stats">
    <div class="cw-wrap">
      <div class="cw-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="cw-stat">
            <span class="cw-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="cw-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="cw-how">
    <div class="cw-wrap">
      <h2 class="cw-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="cw-how-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="cw-how-step">
            <div class="cw-how-left">
              <div class="cw-how-num">{String(i).padStart(2, '0')}</div>
            </div>
            <div class="cw-how-right">
              <h3>{$_(`${tk}.how.s${i}.title`)}</h3>
              <p>{$_(`${tk}.how.s${i}.desc`)}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="cw-seo-ask">
    <div class="cw-wrap">
      <h2 class="cw-h2">How does an AI caption writer know my brand voice?</h2>
      <p>AI caption writers learn your brand voice through examples you provide and ongoing feedback. By analyzing your best-performing posts, preferred tone, and vocabulary, the AI generates captions that match your style. Over time, as you approve or edit suggestions, the tool becomes more attuned to your unique voice and audience preferences.</p>
    </div>
  </section>

  <section class="cw-seo-related">
    <div class="cw-wrap">
      <p>Related: <a href={lp('/engagement')}>Increase social media engagement</a> · <a href={lp('/strategy')}>Build a social media strategy</a> · <a href={lp('/automation')}>Social media automation tools</a></p>
    </div>
  </section>

  <section class="cw-final">
    <div class="cw-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="cw-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .cw-wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }
  .cw-hero { padding: 100px 0 80px; background: var(--paper); border-bottom: 1px solid var(--line); }
  .cw-hero-grid { display: grid; grid-template-columns: 280px 1fr; gap: 48px; align-items: center; }
  .cw-eyebrow {
    display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--accent); background: rgba(var(--accent-rgb), 0.08);
    padding: 5px 14px; border-radius: 999px; margin-bottom: 20px;
  }
  .cw-h1 {
    font-size: clamp(2rem, 4.5vw, 3rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); line-height: 1.08; margin: 0;
  }
  .cw-sub { font-size: 1.1rem; line-height: 1.6; color: var(--ink-soft); margin: 18px 0 0; max-width: 42ch; }
  .cw-cta {
    display: inline-flex; margin-top: 28px; background: var(--invert-surface); color: #fff;
    text-decoration: none; border-radius: 980px; padding: 14px 32px;
    font-size: 15px; font-weight: 700; transition: transform 0.15s, box-shadow 0.15s;
  }
  .cw-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
  .cw-hero-mockup {
    border-radius: 24px; overflow: hidden;
    box-shadow: 0 16px 48px rgba(0,0,0,0.12);
  }
  .cw-phone {
    width: 240px; border-radius: 28px; overflow: hidden;
    border: 3px solid var(--line); background: var(--paper);
    box-shadow: 0 12px 40px rgba(0,0,0,0.1);
    padding: 12px 0 0; margin: 0 auto;
  }
  .cw-phone-notch {
    width: 80px; height: 6px; border-radius: 3px;
    background: var(--line); margin: 0 auto 12px;
  }
  .cw-phone-post img { width: 100%; display: block; }
  .cw-phone-caption {
    padding: 10px 14px; font-size: 11px; line-height: 1.5;
    color: var(--ink); min-height: 44px;
  }
  .cw-type-cursor {
    display: inline-block; width: 2px; height: 12px; background: var(--accent);
    margin-right: 2px; vertical-align: middle; animation: cw-blink 1s step-end infinite;
  }
  @keyframes cw-blink { 50% { opacity: 0; } }
  .cw-phone-bar {
    display: flex; gap: 14px; padding: 8px 14px 12px;
    font-size: 10px; color: var(--ink-soft); border-top: 1px solid var(--line);
  }
  .cw-pain { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .cw-h2 {
    font-size: clamp(1.5rem, 3.5vw, 2.1rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); margin: 0 0 36px; text-align: center;
  }
  .cw-pain-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; max-width: 720px; margin: 0 auto; }
  .cw-pain-item {
    display: flex; align-items: flex-start; gap: 14px; padding: 22px 24px;
    border-radius: 14px; background: var(--paper); border: 1px solid var(--line);
  }
  .cw-pain-mark {
    flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%;
    background: rgba(var(--accent-rgb), 0.08); color: var(--accent);
    display: flex; align-items: center; justify-content: center;
  }
  .cw-pain-item p { font-size: 0.93rem; line-height: 1.5; color: var(--ink); margin: 0; }
  .cw-solution { padding: 80px 0; background: var(--paper); }
  .cw-sol-sub {
    text-align: center; color: var(--ink-soft); margin: 0 0 40px;
    font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto;
  }
  .cw-feat-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .cw-feat {
    padding: 28px 22px; border-radius: 16px; border: 1px solid var(--line);
    background: var(--paper); transition: box-shadow .2s;
  }
  .cw-feat:hover { box-shadow: 0 8px 24px rgba(var(--accent-rgb), 0.08); }
  .cw-feat-icon {
    width: 44px; height: 44px; border-radius: 12px; margin-bottom: 16px;
    background: rgba(var(--accent-rgb), 0.1); color: var(--accent);
    display: flex; align-items: center; justify-content: center;
  }
  .cw-feat h3 { font-size: 1rem; font-weight: 700; margin: 0 0 8px; }
  .cw-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0 0 14px; }
  .cw-feat-preview {
    border-radius: 10px; overflow: hidden; border: 1px solid var(--line); background: var(--paper-2, #f5f5f7);
  }
  .cw-preview-img { height: 60px; overflow: hidden; }
  .cw-preview-img img { width: 100%; height: 100%; object-fit: cover; }
  .cw-preview-text {
    padding: 8px 10px; font-size: 10px; line-height: 1.4; color: var(--ink-soft);
    font-style: italic;
  }
  .cw-stats { padding: 64px 0; background: var(--invert-surface); color: #fff; }
  .cw-stats-row { display: flex; justify-content: center; gap: 56px; flex-wrap: wrap; }
  .cw-stat { text-align: center; }
  .cw-stat-num { display: block; font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; color: var(--accent-2, #9d86ff); }
  .cw-stat-lbl { font-size: 0.85rem; color: rgba(255,255,255,0.55); margin-top: 4px; }
  .cw-how { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .cw-how-steps { max-width: 600px; margin: 0 auto; display: flex; flex-direction: column; gap: 0; }
  .cw-how-step {
    display: flex; gap: 24px; padding: 28px 0;
    border-bottom: 1px solid var(--line);
  }
  .cw-how-step:last-child { border-bottom: none; }
  .cw-how-left { flex: 0 0 auto; }
  .cw-how-num { font-size: 32px; font-weight: 800; color: rgba(var(--accent-rgb), 0.12); line-height: 1; }
  .cw-how-right h3 { font-size: 1.05rem; font-weight: 700; margin: 0 0 6px; }
  .cw-how-right p { font-size: 0.92rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }
  .cw-final { padding: 100px 0; text-align: center; background: var(--paper); border-top: 1px solid var(--line); }
  .cw-final h2 { font-size: clamp(1.7rem, 3.5vw, 2.4rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; }
  .cw-final p { color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; }
  .cw-seo-ask { padding: 64px 0; background: var(--paper-2, #f5f5f7); }
  .cw-seo-ask h2 { font-size: clamp(1.3rem, 3vw, 1.8rem); margin: 0 0 16px; }
  .cw-seo-ask p { font-size: 0.95rem; color: var(--ink-soft); line-height: 1.7; max-width: 60ch; margin: 0 auto; text-align: center; }
  .cw-seo-related { padding: 32px 0; background: var(--paper); border-top: 1px solid var(--line); text-align: center; }
  .cw-seo-related p { font-size: 0.88rem; color: var(--ink-soft); margin: 0; }
  .cw-seo-related a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .cw-seo-related a:hover { color: var(--ink); }
  @media (max-width: 720px) {
    .cw-hero { padding: 64px 0 48px; }
    .cw-hero-grid { grid-template-columns: 1fr; text-align: center; }
    .cw-hero-copy { display: flex; flex-direction: column; align-items: center; order: -1; }
    .cw-hero-mockup { max-width: 260px; margin: 0 auto; }
    .cw-pain, .cw-solution, .cw-how { padding: 56px 0; }
    .cw-pain-cols { grid-template-columns: 1fr; }
    .cw-feat-cards { grid-template-columns: 1fr; }
    .cw-stats { padding: 48px 0; }
    .cw-stats-row { gap: 32px; }
    .cw-how-step { gap: 16px; }
    .cw-how-num { font-size: 24px; }
    .cw-final { padding: 72px 0; }
  }
</style>
