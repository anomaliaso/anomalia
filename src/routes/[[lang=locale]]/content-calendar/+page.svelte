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
  const tk = 'pain.contentCalendar';
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
        "name": "What is a content calendar for social media?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "A content calendar is a planning tool that maps out what content you'll post, on which platform, and when. It helps you maintain consistency, align content with business goals and events, avoid last-minute scrambles, and ensure a healthy mix of content types across your channels."
        }
      },
      {
        "@type": "Question",
        "name": "How do I create a social media content calendar?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Start by defining your content pillars (educational, entertaining, promotional). Then map content types to days of the week, add key dates and events, create templates for recurring content, and use a scheduling tool to automate publishing. Review and adjust monthly based on performance data."
        }
      },
      {
        "@type": "Question",
        "name": "What should I include in a content calendar?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Include the posting date and time, platform, content format (image, video, carousel), caption text, hashtags, links, and content status (draft, approved, scheduled). Also note any relevant events, product launches, or seasonal themes that should influence your content."
        }
      },
      {
        "@type": "Question",
        "name": "How far ahead should I plan my content calendar?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Plan 2-4 weeks ahead for the best balance of preparation and flexibility. Monthly planning sessions work well for overarching themes, while weekly sessions handle specific posts. Leave 20-30% of your calendar open for timely, reactive content related to trends and current events."
        }
      }
    ]
  }
  </script>
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main class="cc-page">
  <section class="cc-hero">
    <div class="cc-wrap cc-hero-grid">
      <div class="cc-hero-copy">
        <span class="cc-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="cc-h1">{$_(`${tk}.headline`)}</h1>
        <p class="cc-sub">{$_(`${tk}.sub`)}</p>
        <a class="cc-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      </div>
      <div class="cc-hero-mockup">
        <div class="cc-cal-full">
          <div class="cc-cal-head">
            <span>November 2025</span>
            <div class="cc-cal-nav">
              <span>‹</span><span>›</span>
            </div>
          </div>
          <div class="cc-cal-weekdays">
            {#each ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] as d}
              <span>{d}</span>
            {/each}
          </div>
          <div class="cc-cal-body">
            {#each Array(35) as _, i}
              {@const day = i - 2}
              {@const valid = day >= 1 && day <= 30}
              {@const filled = valid && [1,3,5,6,8,10,12,13,15,17,19,20,22,24,26,27,29].includes(day)}
              <div class="cc-cal-cell" class:cc-cal-empty={!valid} class:cc-cal-has={filled}>
                {#if valid}
                  <span class="cc-cal-day-num">{day}</span>
                  {#if filled}
                    <span class="cc-cal-post-pill" style="background:{day % 3 === 0 ? 'var(--accent-2, #9d86ff)' : 'var(--accent)'}"></span>
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="cc-pain">
    <div class="cc-wrap">
      <h2 class="cc-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="cc-compare">
        <div class="cc-compare-card cc-compare-empty">
          <div class="cc-compare-label">Before</div>
          <div class="cc-compare-grid">
            {#each Array(20) as _, i}
              {@const has = [2,7,15].includes(i)}
              <div class="cc-compare-slot" class:cc-compare-dot={has}></div>
            {/each}
          </div>
        </div>
        <div class="cc-compare-arrow">→</div>
        <div class="cc-compare-card cc-compare-full">
          <div class="cc-compare-label">After</div>
          <div class="cc-compare-grid">
            {#each Array(20) as _, i}
              {@const has = [0,1,3,4,5,7,8,9,10,11,13,14,15,16,17,19].includes(i)}
              <div class="cc-compare-slot" class:cc-compare-dot={has}></div>
            {/each}
          </div>
        </div>
      </div>
      <div class="cc-pain-row">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="cc-pain-card">
            <div class="cc-pain-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M5 6h6M5 9h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </div>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="cc-solution">
    <div class="cc-wrap">
      <h2 class="cc-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="cc-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="cc-feat-grid">
        {#each [1, 2, 3] as i (i)}
          <div class="cc-feat">
            <div class="cc-feat-badge">{i}</div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="cc-stats">
    <div class="cc-wrap">
      <div class="cc-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="cc-stat">
            <span class="cc-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="cc-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="cc-how">
    <div class="cc-wrap">
      <h2 class="cc-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="cc-how-grid">
        {#each [1, 2, 3] as i (i)}
          <div class="cc-how-card">
            <div class="cc-how-num">{i}</div>
            <h3>{$_(`${tk}.how.s${i}.title`)}</h3>
            <p>{$_(`${tk}.how.s${i}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="cc-seo-ask">
    <div class="cc-wrap">
      <h2 class="cc-h2">Is a content calendar really necessary for social media?</h2>
      <p>Yes. Without a content calendar, most creators default to sporadic posting and content that doesn't align with their goals. A calendar ensures you maintain a balanced content mix, never miss important dates, and can batch-create content efficiently. Accounts using content calendars report 60% less time spent on daily content decisions.</p>
    </div>
  </section>

  <section class="cc-seo-related">
    <div class="cc-wrap">
      <p>Related: <a href={lp('/scheduling')}>Social media scheduling tools</a> · <a href={lp('/strategy')}>Build a social media strategy</a> · <a href={lp('/consistency')}>Post consistently on social media</a></p>
    </div>
  </section>

  <section class="cc-final">
    <div class="cc-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="cc-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .cc-wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }
  .cc-hero { padding: 100px 0 80px; background: var(--paper); border-bottom: 1px solid var(--line); }
  .cc-hero-grid { display: grid; grid-template-columns: 1fr 340px; gap: 48px; align-items: center; }
  .cc-eyebrow {
    display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--accent); background: rgba(var(--accent-rgb), 0.08);
    padding: 5px 14px; border-radius: 999px; margin-bottom: 20px;
  }
  .cc-h1 {
    font-size: clamp(2rem, 4.5vw, 3rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); line-height: 1.08; margin: 0;
  }
  .cc-sub { font-size: 1.1rem; line-height: 1.6; color: var(--ink-soft); margin: 18px 0 0; max-width: 42ch; }
  .cc-cta {
    display: inline-flex; margin-top: 28px; background: var(--invert-surface); color: #fff;
    text-decoration: none; border-radius: 980px; padding: 14px 32px;
    font-size: 15px; font-weight: 700; transition: transform 0.15s, box-shadow 0.15s;
  }
  .cc-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
  .cc-hero-mockup {
    border-radius: 16px; overflow: hidden;
    border: 1px solid var(--line);
    box-shadow: 0 12px 40px rgba(0,0,0,0.1);
    background: var(--paper); padding: 16px;
  }
  .cc-cal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .cc-cal-head span { font-size: 13px; font-weight: 700; color: var(--ink); }
  .cc-cal-nav { display: flex; gap: 8px; }
  .cc-cal-nav span { font-size: 16px; color: var(--ink-soft); cursor: pointer; }
  .cc-cal-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 4px; }
  .cc-cal-weekdays span { font-size: 9px; font-weight: 600; color: var(--ink-soft); text-align: center; padding: 4px 0; }
  .cc-cal-body { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
  .cc-cal-cell {
    aspect-ratio: 1; border-radius: 4px; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 2px; background: var(--paper-2, #f5f5f7);
  }
  .cc-cal-empty { background: transparent; }
  .cc-cal-has { background: rgba(var(--accent-rgb), 0.06); }
  .cc-cal-day-num { font-size: 8px; color: var(--ink-soft); }
  .cc-cal-post-pill { width: 14px; height: 3px; border-radius: 2px; }
  .cc-pain { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .cc-h2 {
    font-size: clamp(1.5rem, 3.5vw, 2.1rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); margin: 0 0 36px; text-align: center;
  }
  .cc-compare {
    display: flex; align-items: center; justify-content: center; gap: 20px;
    max-width: 480px; margin: 0 auto 36px;
  }
  .cc-compare-card {
    flex: 1; padding: 16px; border-radius: 14px; border: 1px solid var(--line); background: var(--paper);
  }
  .cc-compare-label { font-size: 11px; font-weight: 700; color: var(--ink-soft); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  .cc-compare-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
  .cc-compare-slot { aspect-ratio: 1; border-radius: 4px; background: var(--paper-2, #f5f5f7); }
  .cc-compare-dot { background: var(--accent); }
  .cc-compare-arrow { font-size: 20px; color: var(--accent); font-weight: 700; flex: 0 0 auto; }
  .cc-pain-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; max-width: 640px; margin: 0 auto; }
  .cc-pain-card {
    display: flex; align-items: flex-start; gap: 14px; padding: 20px;
    border-radius: 14px; background: var(--paper); border: 1px solid var(--line);
  }
  .cc-pain-icon {
    flex: 0 0 auto; width: 32px; height: 32px; border-radius: 8px;
    background: rgba(var(--accent-rgb), 0.08); color: var(--accent);
    display: flex; align-items: center; justify-content: center;
  }
  .cc-pain-card p { font-size: 0.92rem; line-height: 1.5; color: var(--ink); margin: 0; }
  .cc-solution { padding: 80px 0; background: var(--paper); }
  .cc-sol-sub {
    text-align: center; color: var(--ink-soft); margin: 0 0 40px;
    font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto;
  }
  .cc-feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .cc-feat {
    padding: 32px 24px; border-radius: 16px; border: 1px solid var(--line);
    background: var(--paper); text-align: center; transition: box-shadow .2s;
  }
  .cc-feat:hover { box-shadow: 0 8px 24px rgba(var(--accent-rgb), 0.08); }
  .cc-feat-badge {
    width: 36px; height: 36px; border-radius: 50%; background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 14px;
    font-weight: 800; margin: 0 auto 16px;
  }
  .cc-feat h3 { font-size: 1rem; font-weight: 700; margin: 0 0 8px; }
  .cc-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }
  .cc-stats { padding: 64px 0; background: var(--invert-surface); color: #fff; }
  .cc-stats-row { display: flex; justify-content: center; gap: 56px; flex-wrap: wrap; }
  .cc-stat { text-align: center; }
  .cc-stat-num { display: block; font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; color: var(--accent-2, #9d86ff); }
  .cc-stat-lbl { font-size: 0.85rem; color: rgba(255,255,255,0.55); margin-top: 4px; }
  .cc-how { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .cc-how-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .cc-how-card {
    position: relative; padding: 32px 26px; border-radius: 18px;
    background: var(--paper); border: 1px solid var(--line);
  }
  .cc-how-num {
    position: absolute; top: -14px; left: 26px;
    width: 28px; height: 28px; border-radius: 8px;
    background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 800;
  }
  .cc-how-card h3 { font-size: 1.02rem; font-weight: 700; margin: 0 0 6px; }
  .cc-how-card p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }
  .cc-final { padding: 100px 0; text-align: center; background: var(--paper); border-top: 1px solid var(--line); }
  .cc-final h2 { font-size: clamp(1.7rem, 3.5vw, 2.4rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; }
  .cc-final p { color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; }
  .cc-seo-ask { padding: 64px 0; background: var(--paper-2, #f5f5f7); }
  .cc-seo-ask h2 { font-size: clamp(1.3rem, 3vw, 1.8rem); margin: 0 0 16px; }
  .cc-seo-ask p { font-size: 0.95rem; color: var(--ink-soft); line-height: 1.7; max-width: 60ch; margin: 0 auto; text-align: center; }
  .cc-seo-related { padding: 32px 0; background: var(--paper); border-top: 1px solid var(--line); text-align: center; }
  .cc-seo-related p { font-size: 0.88rem; color: var(--ink-soft); margin: 0; }
  .cc-seo-related a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .cc-seo-related a:hover { color: var(--ink); }
  @media (max-width: 720px) {
    .cc-hero { padding: 64px 0 48px; }
    .cc-hero-grid { grid-template-columns: 1fr; text-align: center; }
    .cc-hero-copy { display: flex; flex-direction: column; align-items: center; }
    .cc-hero-mockup { max-width: 280px; margin: 0 auto; }
    .cc-pain, .cc-solution, .cc-how { padding: 56px 0; }
    .cc-pain-row { grid-template-columns: 1fr; }
    .cc-feat-grid, .cc-how-grid { grid-template-columns: 1fr; }
    .cc-stats { padding: 48px 0; }
    .cc-stats-row { gap: 32px; }
    .cc-final { padding: 72px 0; }
    .cc-compare { flex-direction: column; }
    .cc-compare-arrow { transform: rotate(90deg); }
  }
</style>
