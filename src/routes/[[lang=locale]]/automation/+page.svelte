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
  const tk = 'pain.automation';
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
        "name": "What is social media automation?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Social media automation is the use of tools to handle repetitive tasks like scheduling posts, generating captions, tracking analytics, and managing content approvals. It lets you maintain a consistent social media presence without spending hours daily on manual work."
        }
      },
      {
        "@type": "Question",
        "name": "Is social media automation allowed by platforms?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Yes. All major platforms including Instagram, TikTok, LinkedIn, X, and Facebook support scheduling through official APIs and approved third-party tools. Automation through legitimate scheduling tools is fully compliant with platform terms of service."
        }
      },
      {
        "@type": "Question",
        "name": "What tasks can be automated on social media?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "You can automate content scheduling and publishing, caption writing with AI, hashtag research, performance reporting, content approval workflows, and cross-platform posting. Engagement tasks like replying to comments should remain manual to maintain authenticity."
        }
      },
      {
        "@type": "Question",
        "name": "Does automation hurt social media engagement?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "No. Automation handles the publishing side, which has zero impact on engagement. In fact, automated posting at optimal times often improves engagement because content reaches your audience when they're most active. The key is keeping human interaction (replies, DMs) manual and authentic."
        }
      }
    ]
  }
  </script>
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main class="au-page">
  <section class="au-hero">
    <div class="au-wrap au-hero-grid">
      <div class="au-hero-mockup">
        <div class="au-flow">
          <div class="au-flow-step">
            <div class="au-flow-icon au-flow-create">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </div>
            <span>Create</span>
          </div>
          <div class="au-flow-arrow">
            <svg width="32" height="12" viewBox="0 0 32 12" fill="none"><path d="M0 6h28M24 1l5 5-5 5" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="au-flow-step">
            <div class="au-flow-icon au-flow-schedule">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            </div>
            <span>Schedule</span>
          </div>
          <div class="au-flow-arrow">
            <svg width="32" height="12" viewBox="0 0 32 12" fill="none"><path d="M0 6h28M24 1l5 5-5 5" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="au-flow-step">
            <div class="au-flow-icon au-flow-publish">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </div>
            <span>Publish</span>
          </div>
        </div>
      </div>
      <div class="au-hero-copy">
        <span class="au-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="au-h1">{$_(`${tk}.headline`)}</h1>
        <p class="au-sub">{$_(`${tk}.sub`)}</p>
        <a class="au-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      </div>
    </div>
  </section>

  <section class="au-pain">
    <div class="au-wrap">
      <h2 class="au-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="au-pain-strip">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="au-pain-item">
            <div class="au-pain-num">{String(i).padStart(2, '0')}</div>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="au-solution">
    <div class="au-wrap">
      <h2 class="au-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="au-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="au-feat-grid">
        {#each [1, 2, 3] as i (i)}
          <div class="au-feat">
            <div class="au-feat-top">
              <div class="au-feat-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
            </div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
            <div class="au-feat-phone">
              <div class="au-phone">
                <div class="au-phone-notch"></div>
                <img src="/hero/post{i}.png" alt="Automated social media workflow step {i} showing content creation to publishing" loading="lazy" />
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="au-stats">
    <div class="au-wrap">
      <div class="au-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="au-stat">
            <span class="au-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="au-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="au-how">
    <div class="au-wrap">
      <h2 class="au-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="au-how-grid">
        {#each [1, 2, 3] as i (i)}
          <div class="au-how-step">
            <div class="au-how-ring">
              <svg viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="20" stroke="rgba(var(--accent-rgb), 0.12)" stroke-width="3"/>
                <circle cx="24" cy="24" r="20" stroke="var(--accent)" stroke-width="3" stroke-dasharray="126" stroke-dashoffset={126 - (126 * i / 3)} stroke-linecap="round" transform="rotate(-90 24 24)"/>
              </svg>
              <span class="au-how-ring-num">{i}</span>
            </div>
            <h3>{$_(`${tk}.how.s${i}.title`)}</h3>
            <p>{$_(`${tk}.how.s${i}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="au-seo-ask">
    <div class="au-wrap">
      <h2 class="au-h2">Can small businesses benefit from social media automation?</h2>
      <p>Absolutely. Small businesses benefit the most because they have the least time to dedicate to social media. Automation tools level the playing field by letting solopreneurs and small teams maintain the same posting frequency and quality as larger competitors, without hiring dedicated social media staff or spending hours each day on content management.</p>
    </div>
  </section>

  <section class="au-seo-related">
    <div class="au-wrap">
      <p>Related: <a href={lp('/scheduling')}>Social media scheduling tools</a> · <a href={lp('/caption-writer')}>AI caption writer</a> · <a href={lp('/analytics')}>Social media analytics tracking</a></p>
    </div>
  </section>

  <section class="au-final">
    <div class="au-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="au-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .au-wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }
  .au-hero { padding: 100px 0 80px; background: var(--paper); border-bottom: 1px solid var(--line); }
  .au-hero-grid { display: grid; grid-template-columns: 360px 1fr; gap: 48px; align-items: center; }
  .au-eyebrow {
    display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--accent); background: rgba(var(--accent-rgb), 0.08);
    padding: 5px 14px; border-radius: 999px; margin-bottom: 20px;
  }
  .au-h1 {
    font-size: clamp(2rem, 4.5vw, 3rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); line-height: 1.08; margin: 0;
  }
  .au-sub { font-size: 1.1rem; line-height: 1.6; color: var(--ink-soft); margin: 18px 0 0; max-width: 42ch; }
  .au-cta {
    display: inline-flex; margin-top: 28px; background: var(--invert-surface); color: #fff;
    text-decoration: none; border-radius: 980px; padding: 14px 32px;
    font-size: 15px; font-weight: 700; transition: transform 0.15s, box-shadow 0.15s;
  }
  .au-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
  .au-hero-mockup {
    border-radius: 16px; overflow: hidden;
    border: 1px solid var(--line);
    box-shadow: 0 12px 40px rgba(0,0,0,0.1);
    background: var(--paper); padding: 28px 20px;
  }
  .au-flow { display: flex; align-items: center; justify-content: center; gap: 8px; }
  .au-flow-step { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .au-flow-step span { font-size: 11px; font-weight: 700; color: var(--ink); }
  .au-flow-icon {
    width: 48px; height: 48px; border-radius: 14px;
    display: flex; align-items: center; justify-content: center;
  }
  .au-flow-create { background: var(--accent); }
  .au-flow-schedule { background: var(--accent-2, #9d86ff); }
  .au-flow-publish { background: var(--invert-surface); }
  .au-flow-arrow { flex: 0 0 auto; }
  .au-pain { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .au-h2 {
    font-size: clamp(1.5rem, 3.5vw, 2.1rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); margin: 0 0 36px; text-align: center;
  }
  .au-pain-strip {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 0;
    max-width: 820px; margin: 0 auto;
    border-radius: 16px; overflow: hidden; border: 1px solid var(--line);
  }
  .au-pain-item {
    padding: 28px 22px; background: var(--paper);
    border-right: 1px solid var(--line);
    transition: background .2s;
  }
  .au-pain-item:last-child { border-right: none; }
  .au-pain-item:hover { background: rgba(var(--accent-rgb), 0.03); }
  .au-pain-num { font-size: 28px; font-weight: 800; color: rgba(var(--accent-rgb), 0.15); margin-bottom: 10px; }
  .au-pain-item p { font-size: 0.9rem; line-height: 1.5; color: var(--ink); margin: 0; }
  .au-solution { padding: 80px 0; background: var(--paper); }
  .au-sol-sub {
    text-align: center; color: var(--ink-soft); margin: 0 0 40px;
    font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto;
  }
  .au-feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .au-feat {
    padding: 28px 22px; border-radius: 16px; border: 1px solid var(--line);
    background: var(--paper); transition: box-shadow .2s;
  }
  .au-feat:hover { box-shadow: 0 8px 24px rgba(var(--accent-rgb), 0.08); }
  .au-feat-top { margin-bottom: 16px; }
  .au-feat-icon {
    width: 44px; height: 44px; border-radius: 12px;
    background: rgba(var(--accent-rgb), 0.1); color: var(--accent);
    display: flex; align-items: center; justify-content: center;
  }
  .au-feat h3 { font-size: 1rem; font-weight: 700; margin: 0 0 8px; }
  .au-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0 0 16px; }
  .au-feat-phone { display: flex; justify-content: center; }
  .au-phone {
    width: 120px; border-radius: 16px; overflow: hidden;
    border: 2px solid var(--line); background: var(--paper);
    box-shadow: 0 8px 24px rgba(0,0,0,0.08); padding: 8px 0 0;
  }
  .au-phone-notch {
    width: 40px; height: 4px; border-radius: 2px;
    background: var(--line); margin: 0 auto 8px;
  }
  .au-phone img { width: 100%; display: block; }
  .au-stats { padding: 64px 0; background: var(--invert-surface); color: #fff; }
  .au-stats-row { display: flex; justify-content: center; gap: 56px; flex-wrap: wrap; }
  .au-stat { text-align: center; }
  .au-stat-num { display: block; font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; color: var(--accent-2, #9d86ff); }
  .au-stat-lbl { font-size: 0.85rem; color: rgba(255,255,255,0.55); margin-top: 4px; }
  .au-how { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .au-how-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .au-how-step { text-align: center; }
  .au-how-ring { position: relative; width: 48px; height: 48px; margin: 0 auto 16px; }
  .au-how-ring svg { width: 100%; height: 100%; }
  .au-how-ring-num {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    font-size: 16px; font-weight: 800; color: var(--accent);
  }
  .au-how-step h3 { font-size: 0.95rem; font-weight: 700; margin: 0 0 6px; }
  .au-how-step p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.5; margin: 0; }
  .au-final { padding: 100px 0; text-align: center; background: var(--paper); border-top: 1px solid var(--line); }
  .au-final h2 { font-size: clamp(1.7rem, 3.5vw, 2.4rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; }
  .au-final p { color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; }
  .au-seo-ask { padding: 64px 0; background: var(--paper-2, #f5f5f7); }
  .au-seo-ask h2 { font-size: clamp(1.3rem, 3vw, 1.8rem); margin: 0 0 16px; }
  .au-seo-ask p { font-size: 0.95rem; color: var(--ink-soft); line-height: 1.7; max-width: 60ch; margin: 0 auto; text-align: center; }
  .au-seo-related { padding: 32px 0; background: var(--paper); border-top: 1px solid var(--line); text-align: center; }
  .au-seo-related p { font-size: 0.88rem; color: var(--ink-soft); margin: 0; }
  .au-seo-related a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .au-seo-related a:hover { color: var(--ink); }
  @media (max-width: 720px) {
    .au-hero { padding: 64px 0 48px; }
    .au-hero-grid { grid-template-columns: 1fr; }
    .au-hero-copy { text-align: center; display: flex; flex-direction: column; align-items: center; order: -1; }
    .au-hero-mockup { max-width: 280px; margin: 0 auto; }
    .au-pain, .au-solution, .au-how { padding: 56px 0; }
    .au-pain-strip { grid-template-columns: 1fr 1fr; }
    .au-pain-item { border-right: none; border-bottom: 1px solid var(--line); }
    .au-feat-grid, .au-how-grid { grid-template-columns: 1fr; }
    .au-stats { padding: 48px 0; }
    .au-stats-row { gap: 32px; }
    .au-final { padding: 72px 0; }
    .au-flow { flex-direction: column; }
    .au-flow-arrow { transform: rotate(90deg); }
  }
</style>
