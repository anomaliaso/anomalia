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
  const tk = 'pain.strategy';
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
        "name": "What is a social media strategy?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "A social media strategy is a documented plan that defines your goals, target audience, content pillars, posting schedule, and success metrics. It guides every piece of content you create and ensures your social media efforts contribute to measurable business outcomes."
        }
      },
      {
        "@type": "Question",
        "name": "How do I create a social media strategy from scratch?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Start by defining your business goals and target audience. Choose 1-2 platforms where your audience is most active. Define 3-4 content pillars, create a posting schedule, set measurable KPIs, and build a content calendar. Review performance monthly and iterate based on data."
        }
      },
      {
        "@type": "Question",
        "name": "What are content pillars in social media?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Content pillars are 3-5 recurring themes that guide your content creation. Common pillars include educational content (tips, how-tos), entertaining content (memes, trends), inspirational content (stories, quotes), and promotional content (products, offers). They ensure variety and consistency in your feed."
        }
      },
      {
        "@type": "Question",
        "name": "How often should I update my social media strategy?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Review your strategy monthly against KPIs and do a full strategy refresh quarterly. The digital landscape changes fast — algorithm updates, new features, and shifting audience behavior require regular adaptation. Use analytics data to identify what's working and adjust accordingly."
        }
      }
    ]
  }
  </script>
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main class="st-page">
  <section class="st-hero">
    <div class="st-wrap st-hero-grid">
      <div class="st-hero-copy">
        <span class="st-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="st-h1">{$_(`${tk}.headline`)}</h1>
        <p class="st-sub">{$_(`${tk}.sub`)}</p>
        <a class="st-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      </div>
      <div class="st-hero-mockup">
        <div class="st-pillars">
          <div class="st-pillar" style="border-left: 3px solid var(--accent)">
            <div class="st-pillar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>
            </div>
            <div class="st-pillar-title">Educational</div>
            <div class="st-pillar-tags">
              <span>Tips</span><span>How-to</span><span>Guides</span>
            </div>
          </div>
          <div class="st-pillar" style="border-left: 3px solid var(--accent-2, #9d86ff)">
            <div class="st-pillar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-2, #9d86ff)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
            </div>
            <div class="st-pillar-title">Entertaining</div>
            <div class="st-pillar-tags">
              <span>Memes</span><span>Reels</span><span>Trends</span>
            </div>
          </div>
          <div class="st-pillar" style="border-left: 3px solid var(--ink)">
            <div class="st-pillar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
            </div>
            <div class="st-pillar-title">Inspirational</div>
            <div class="st-pillar-tags">
              <span>Stories</span><span>Quotes</span><span>Wins</span>
            </div>
          </div>
          <div class="st-pillar" style="border-left: 3px solid var(--accent)">
            <div class="st-pillar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
            </div>
            <div class="st-pillar-title">Promotional</div>
            <div class="st-pillar-tags">
              <span>Launches</span><span>Offers</span><span>CTAs</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="st-pain">
    <div class="st-wrap">
      <h2 class="st-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="st-pain-grid">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="st-pain-card">
            <div class="st-pain-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </div>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="st-solution">
    <div class="st-wrap">
      <h2 class="st-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="st-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="st-feat-row">
        {#each [1, 2, 3] as i (i)}
          <div class="st-feat">
            <div class="st-feat-badge">{i}</div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
            <div class="st-feat-platforms">
              <div class="st-plat-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>
                <span>IG</span>
              </div>
              <div class="st-plat-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>
                <span>TT</span>
              </div>
              <div class="st-plat-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>
                <span>LI</span>
              </div>
              <div class="st-plat-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l11.733 16H20L8.267 4H4zm0 16l6.5-6.5M20 4l-6.5 6.5"/></svg>
                <span>X</span>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="st-stats">
    <div class="st-wrap">
      <div class="st-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="st-stat">
            <span class="st-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="st-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="st-how">
    <div class="st-wrap">
      <h2 class="st-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="st-steps">
        {#each [1, 2, 3] as i (i)}
          <div class="st-step">
            <div class="st-step-marker">
              <div class="st-step-dot"></div>
              {#if i < 3}<div class="st-step-conn"></div>{/if}
            </div>
            <div class="st-step-content">
              <h3>{$_(`${tk}.how.s${i}.title`)}</h3>
              <p>{$_(`${tk}.how.s${i}.desc`)}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="st-seo-ask">
    <div class="st-wrap">
      <h2 class="st-h2">Do I need a different strategy for each social media platform?</h2>
      <p>Yes. Each platform has unique algorithms, content formats, and audience behaviors. Instagram rewards Reels and carousels, TikTok prioritizes short-form video hooks, LinkedIn favors professional insights, and X values concise, timely commentary. Your core message stays the same, but the format and tone should adapt to each platform's culture for maximum impact.</p>
    </div>
  </section>

  <section class="st-seo-related">
    <div class="st-wrap">
      <p>Related: <a href={lp('/content-calendar')}>Content calendar planning</a> · <a href={lp('/engagement')}>Increase social media engagement</a> · <a href={lp('/analytics')}>Social media analytics tools</a></p>
    </div>
  </section>

  <section class="st-final">
    <div class="st-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="st-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .st-wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }
  .st-hero { padding: 100px 0 80px; background: var(--paper); border-bottom: 1px solid var(--line); }
  .st-hero-grid { display: grid; grid-template-columns: 1fr 360px; gap: 48px; align-items: center; }
  .st-eyebrow {
    display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--accent); background: rgba(var(--accent-rgb), 0.08);
    padding: 5px 14px; border-radius: 999px; margin-bottom: 20px;
  }
  .st-h1 {
    font-size: clamp(2rem, 4.5vw, 3rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); line-height: 1.08; margin: 0;
  }
  .st-sub { font-size: 1.1rem; line-height: 1.6; color: var(--ink-soft); margin: 18px 0 0; max-width: 42ch; }
  .st-cta {
    display: inline-flex; margin-top: 28px; background: var(--invert-surface); color: #fff;
    text-decoration: none; border-radius: 980px; padding: 14px 32px;
    font-size: 15px; font-weight: 700; transition: transform 0.15s, box-shadow 0.15s;
  }
  .st-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
  .st-hero-mockup {
    border-radius: 16px; overflow: hidden;
    border: 1px solid var(--line);
    box-shadow: 0 12px 40px rgba(0,0,0,0.1);
    background: var(--paper); padding: 20px;
  }
  .st-pillars { display: flex; flex-direction: column; gap: 10px; }
  .st-pillar {
    padding: 14px 16px; border-radius: 10px; background: var(--paper-2, #f5f5f7);
    border: 1px solid var(--line); display: flex; align-items: center; gap: 12px;
  }
  .st-pillar-icon {
    width: 36px; height: 36px; border-radius: 10px;
    background: var(--paper); display: flex; align-items: center; justify-content: center;
    flex: 0 0 auto;
  }
  .st-pillar-title { font-size: 13px; font-weight: 700; color: var(--ink); flex: 1; }
  .st-pillar-tags { display: flex; gap: 4px; }
  .st-pillar-tags span {
    font-size: 9px; font-weight: 600; padding: 3px 7px; border-radius: 999px;
    background: var(--paper); color: var(--ink-soft); border: 1px solid var(--line);
  }
  .st-pain { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .st-h2 {
    font-size: clamp(1.5rem, 3.5vw, 2.1rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); margin: 0 0 36px; text-align: center;
  }
  .st-pain-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; max-width: 720px; margin: 0 auto; }
  .st-pain-card {
    display: flex; align-items: flex-start; gap: 14px; padding: 22px 24px;
    border-radius: 14px; background: var(--paper); border: 1px solid var(--line);
    transition: transform .2s, box-shadow .2s;
  }
  .st-pain-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.05); }
  .st-pain-icon {
    flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%;
    background: rgba(var(--accent-rgb), 0.08); color: var(--accent);
    display: flex; align-items: center; justify-content: center;
  }
  .st-pain-card p { font-size: 0.93rem; line-height: 1.5; color: var(--ink); margin: 0; }
  .st-solution { padding: 80px 0; background: var(--paper); }
  .st-sol-sub {
    text-align: center; color: var(--ink-soft); margin: 0 0 40px;
    font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto;
  }
  .st-feat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .st-feat {
    padding: 32px 24px; border-radius: 16px; border: 1px solid var(--line);
    background: var(--paper); text-align: center; transition: box-shadow .2s;
    position: relative; overflow: hidden;
  }
  .st-feat::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
    background: var(--accent);
  }
  .st-feat:hover { box-shadow: 0 8px 24px rgba(var(--accent-rgb), 0.08); }
  .st-feat-badge {
    width: 36px; height: 36px; border-radius: 50%; background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 14px;
    font-weight: 800; margin: 0 auto 16px;
  }
  .st-feat h3 { font-size: 1rem; font-weight: 700; margin: 0 0 8px; }
  .st-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0 0 16px; }
  .st-feat-platforms { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
  .st-plat-chip {
    display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px;
    border-radius: 999px; border: 1px solid var(--line); background: var(--paper-2, #f5f5f7);
    font-size: 11px; font-weight: 600; color: var(--ink);
  }
  .st-plat-chip svg { color: var(--accent); }
  .st-stats { padding: 64px 0; background: var(--invert-surface); color: #fff; }
  .st-stats-row { display: flex; justify-content: center; gap: 56px; flex-wrap: wrap; }
  .st-stat { text-align: center; }
  .st-stat-num { display: block; font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; color: var(--accent-2, #9d86ff); }
  .st-stat-lbl { font-size: 0.85rem; color: rgba(255,255,255,0.55); margin-top: 4px; }
  .st-how { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .st-steps { max-width: 560px; margin: 0 auto; }
  .st-step { display: flex; gap: 20px; }
  .st-step-marker { display: flex; flex-direction: column; align-items: center; flex: 0 0 auto; }
  .st-step-dot { width: 14px; height: 14px; border-radius: 50%; background: var(--accent); flex: 0 0 auto; }
  .st-step-conn { width: 2px; flex: 1; background: var(--line); margin: 6px 0; }
  .st-step-content { padding-bottom: 36px; }
  .st-step-content h3 { font-size: 1.05rem; font-weight: 700; margin: 0 0 6px; }
  .st-step-content p { font-size: 0.92rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }
  .st-final { padding: 100px 0; text-align: center; background: var(--paper); border-top: 1px solid var(--line); }
  .st-final h2 { font-size: clamp(1.7rem, 3.5vw, 2.4rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; }
  .st-final p { color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; }
  .st-seo-ask { padding: 64px 0; background: var(--paper-2, #f5f5f7); }
  .st-seo-ask h2 { font-size: clamp(1.3rem, 3vw, 1.8rem); margin: 0 0 16px; }
  .st-seo-ask p { font-size: 0.95rem; color: var(--ink-soft); line-height: 1.7; max-width: 60ch; margin: 0 auto; text-align: center; }
  .st-seo-related { padding: 32px 0; background: var(--paper); border-top: 1px solid var(--line); text-align: center; }
  .st-seo-related p { font-size: 0.88rem; color: var(--ink-soft); margin: 0; }
  .st-seo-related a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .st-seo-related a:hover { color: var(--ink); }
  @media (max-width: 720px) {
    .st-hero { padding: 64px 0 48px; }
    .st-hero-grid { grid-template-columns: 1fr; text-align: center; }
    .st-hero-copy { display: flex; flex-direction: column; align-items: center; }
    .st-hero-mockup { max-width: 280px; margin: 0 auto; }
    .st-pain, .st-solution, .st-how { padding: 56px 0; }
    .st-pain-grid { grid-template-columns: 1fr; }
    .st-feat-row { grid-template-columns: 1fr; }
    .st-stats { padding: 48px 0; }
    .st-stats-row { gap: 32px; }
    .st-final { padding: 72px 0; }
  }
</style>
