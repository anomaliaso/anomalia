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
  const tk = 'pain.scheduling';
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
        "name": "What is the best social media scheduling tool?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "The best scheduling tool depends on your needs. Look for tools that support all your platforms, offer AI-assisted caption writing, provide analytics, and allow you to batch-schedule content. Anomalia combines scheduling with AI content creation and approval workflows for a complete solution."
        }
      },
      {
        "@type": "Question",
        "name": "How do I batch-create social media content?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Set aside 2-3 hours once a week to create all your content. Start with a content calendar, write captions using AI assistance, design graphics in batches, then schedule everything at once. This approach is 3x more efficient than creating content day-by-day."
        }
      },
      {
        "@type": "Question",
        "name": "Can I schedule posts for multiple platforms at once?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Yes. Modern scheduling tools let you create one piece of content and adapt it for multiple platforms simultaneously. You can customize captions, hashtags, and formats for each platform while scheduling everything from a single dashboard."
        }
      },
      {
        "@type": "Question",
        "name": "Does scheduling posts affect their reach?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "No. All major social platforms treat scheduled posts the same as manually published content. The algorithm evaluates content quality, engagement signals, and timing relevance — not whether a post was scheduled or published manually."
        }
      }
    ]
  }
  </script>
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main class="sc-page">
  <section class="sc-hero">
    <div class="sc-wrap sc-hero-grid">
      <div class="sc-hero-copy">
        <span class="sc-eyebrow">{$_(`${tk}.eyebrow`)}</span>
        <h1 class="sc-h1">{$_(`${tk}.headline`)}</h1>
        <p class="sc-sub">{$_(`${tk}.sub`)}</p>
        <a class="sc-cta" href={startHref}>{$_(`${tk}.cta`)} →</a>
      </div>
      <div class="sc-hero-mockup">
        <div class="sc-cal">
          <div class="sc-cal-head">December 2025</div>
          <div class="sc-cal-grid">
            {#each ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] as d}
              <div class="sc-cal-day">{d}</div>
            {/each}
            {#each Array(28) as _, i}
              {@const filled = [1,3,5,8,10,12,15,17,19,22,24,26].includes(i)}
              {@const colors = ['var(--accent)', 'var(--accent-2, #9d86ff)', 'var(--accent)']}
              <div class="sc-cal-slot" class:sc-cal-filled={filled}>
                {#if filled}
                  <span class="sc-cal-pill" style="background:{colors[i % 3]}">{i + 1}</span>
                {:else}
                  <span class="sc-cal-num">{i + 1}</span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="sc-pain">
    <div class="sc-wrap">
      <h2 class="sc-h2">{$_(`${tk}.problem.title`)}</h2>
      <div class="sc-pain-list">
        {#each [1, 2, 3, 4] as i (i)}
          <div class="sc-pain-item">
            <div class="sc-pain-x">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </div>
            <p>{$_(`${tk}.problem.b${i}`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="sc-solution">
    <div class="sc-wrap">
      <h2 class="sc-h2">{$_(`${tk}.solution.title`)}</h2>
      <p class="sc-sol-sub">{$_(`${tk}.solution.sub`)}</p>
      <div class="sc-feat-grid">
        {#each [1, 2, 3] as i (i)}
          <div class="sc-feat">
            <div class="sc-feat-num">{String(i).padStart(2, '0')}</div>
            <h3>{$_(`${tk}.solution.f${i}.title`)}</h3>
            <p>{$_(`${tk}.solution.f${i}.desc`)}</p>
            <div class="sc-feat-approve">
              <div class="sc-ap-header">
                <img src="/hero/post{i}.png" alt="Social media post preview for scheduling platform feature {i}" loading="lazy" />
              </div>
              <div class="sc-ap-body">
                <div class="sc-ap-caption">Post caption preview...</div>
                <div class="sc-ap-btns">
                  <button class="sc-ap-yes">✓</button>
                  <button class="sc-ap-no">✕</button>
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="sc-stats">
    <div class="sc-wrap">
      <div class="sc-stats-row">
        {#each [1, 2, 3] as i (i)}
          <div class="sc-stat">
            <span class="sc-stat-num">{$_(`${tk}.proof.s${i}.num`)}</span>
            <span class="sc-stat-lbl">{$_(`${tk}.proof.s${i}.label`)}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="sc-how">
    <div class="sc-wrap">
      <h2 class="sc-h2">{$_(`${tk}.how.title`)}</h2>
      <div class="sc-timeline">
        {#each [1, 2, 3] as i (i)}
          <div class="sc-tl-item">
            <div class="sc-tl-marker">
              <div class="sc-tl-dot"></div>
              {#if i < 3}<div class="sc-tl-line"></div>{/if}
            </div>
            <div class="sc-tl-body">
              <h3>{$_(`${tk}.how.s${i}.title`)}</h3>
              <p>{$_(`${tk}.how.s${i}.desc`)}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="sc-seo-ask">
    <div class="sc-wrap">
      <h2 class="sc-h2">How much time does scheduling social media posts save?</h2>
      <p>Scheduling tools typically save 5-10 hours per week by eliminating the need to manually log in, create, and publish content each day. Instead of context-switching multiple times daily, you batch your work into one focused session and let automation handle the rest, freeing you to focus on engagement and strategy.</p>
    </div>
  </section>

  <section class="sc-seo-related">
    <div class="sc-wrap">
      <p>Related: <a href={lp('/automation')}>Social media automation tools</a> · <a href={lp('/content-calendar')}>Content calendar planning</a> · <a href={lp('/consistency')}>Post consistently on social media</a></p>
    </div>
  </section>

  <section class="sc-final">
    <div class="sc-wrap">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <a class="sc-cta" href={startHref}>{$_(`${tk}.final.cta`)} →</a>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .sc-wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }
  .sc-hero { padding: 100px 0 80px; background: var(--paper); border-bottom: 1px solid var(--line); }
  .sc-hero-grid { display: grid; grid-template-columns: 1fr 360px; gap: 48px; align-items: center; }
  .sc-eyebrow {
    display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--accent); background: rgba(var(--accent-rgb), 0.08);
    padding: 5px 14px; border-radius: 999px; margin-bottom: 20px;
  }
  .sc-h1 {
    font-size: clamp(2rem, 4.5vw, 3rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); line-height: 1.08; margin: 0;
  }
  .sc-sub { font-size: 1.1rem; line-height: 1.6; color: var(--ink-soft); margin: 18px 0 0; max-width: 42ch; }
  .sc-cta {
    display: inline-flex; margin-top: 28px; background: var(--invert-surface); color: #fff;
    text-decoration: none; border-radius: 980px; padding: 14px 32px;
    font-size: 15px; font-weight: 700; transition: transform 0.15s, box-shadow 0.15s;
  }
  .sc-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
  .sc-hero-mockup {
    border-radius: 16px; overflow: hidden;
    border: 1px solid var(--line);
    box-shadow: 0 12px 40px rgba(0,0,0,0.1);
    background: var(--paper); padding: 20px;
  }
  .sc-cal-head { font-size: 14px; font-weight: 700; color: var(--ink); margin-bottom: 12px; text-align: center; }
  .sc-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .sc-cal-day { font-size: 10px; font-weight: 600; color: var(--ink-soft); text-align: center; padding: 4px 0; }
  .sc-cal-slot { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; border-radius: 6px; }
  .sc-cal-num { font-size: 10px; color: var(--ink-soft); }
  .sc-cal-pill {
    width: 100%; height: 100%; border-radius: 6px; display: flex; align-items: center; justify-content: center;
    font-size: 9px; font-weight: 700; color: #fff;
  }
  .sc-cal-filled { background: transparent; }
  .sc-pain { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .sc-h2 {
    font-size: clamp(1.5rem, 3.5vw, 2.1rem); font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking); margin: 0 0 36px; text-align: center;
  }
  .sc-pain-list { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; max-width: 720px; margin: 0 auto; }
  .sc-pain-item {
    display: flex; align-items: flex-start; gap: 12px; padding: 20px 22px;
    border-radius: 12px; background: var(--paper); border: 1px solid var(--line);
  }
  .sc-pain-x {
    flex: 0 0 auto; width: 24px; height: 24px; border-radius: 50%;
    background: rgba(var(--accent-rgb), 0.08); color: var(--accent);
    display: flex; align-items: center; justify-content: center;
  }
  .sc-pain-item p { font-size: 0.93rem; line-height: 1.5; color: var(--ink); margin: 0; }
  .sc-solution { padding: 80px 0; background: var(--paper); }
  .sc-sol-sub {
    text-align: center; color: var(--ink-soft); margin: 0 0 40px;
    font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto;
  }
  .sc-feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .sc-feat {
    padding: 32px 26px; border-radius: 18px; background: var(--paper-2, #f5f5f7);
    border: 1px solid var(--line); transition: transform .25s, box-shadow .25s;
  }
  .sc-feat:hover { transform: translateY(-4px); box-shadow: 0 14px 40px rgba(var(--accent-rgb), 0.08); }
  .sc-feat-num { font-size: 13px; font-weight: 800; color: var(--accent); letter-spacing: 0.08em; margin-bottom: 16px; }
  .sc-feat h3 { font-size: 1.05rem; font-weight: 700; margin: 0 0 8px; }
  .sc-feat p { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.55; margin: 0 0 16px; }
  .sc-feat-approve {
    border-radius: 12px; overflow: hidden; border: 1px solid var(--line); background: var(--paper);
  }
  .sc-ap-header { height: 80px; overflow: hidden; }
  .sc-ap-header img { width: 100%; height: 100%; object-fit: cover; }
  .sc-ap-body { padding: 10px 12px; }
  .sc-ap-caption { font-size: 11px; color: var(--ink-soft); margin-bottom: 8px; line-height: 1.4; }
  .sc-ap-btns { display: flex; gap: 6px; }
  .sc-ap-yes, .sc-ap-no {
    flex: 1; padding: 6px; border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer;
    transition: background .15s;
  }
  .sc-ap-yes { background: rgba(var(--accent-rgb), 0.1); color: var(--accent); }
  .sc-ap-no { background: var(--paper-2, #f5f5f7); color: var(--ink-soft); }
  .sc-stats { padding: 64px 0; background: var(--invert-surface); color: #fff; }
  .sc-stats-row { display: flex; justify-content: center; gap: 56px; flex-wrap: wrap; }
  .sc-stat { text-align: center; }
  .sc-stat-num { display: block; font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; color: var(--accent-2, #9d86ff); }
  .sc-stat-lbl { font-size: 0.85rem; color: rgba(255,255,255,0.55); margin-top: 4px; }
  .sc-how { padding: 80px 0; background: var(--paper-2, #f5f5f7); }
  .sc-timeline { max-width: 560px; margin: 0 auto; }
  .sc-tl-item { display: flex; gap: 20px; }
  .sc-tl-marker { display: flex; flex-direction: column; align-items: center; flex: 0 0 auto; }
  .sc-tl-dot { width: 14px; height: 14px; border-radius: 50%; background: var(--accent); flex: 0 0 auto; }
  .sc-tl-line { width: 2px; flex: 1; background: var(--line); margin: 6px 0; }
  .sc-tl-body { padding-bottom: 36px; }
  .sc-tl-body h3 { font-size: 1.05rem; font-weight: 700; margin: 0 0 6px; }
  .sc-tl-body p { font-size: 0.92rem; color: var(--ink-soft); line-height: 1.55; margin: 0; }
  .sc-final { padding: 100px 0; text-align: center; background: var(--paper); border-top: 1px solid var(--line); }
  .sc-final h2 { font-size: clamp(1.7rem, 3.5vw, 2.4rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; }
  .sc-final p { color: var(--ink-soft); margin: 14px 0 0; font-size: 1.05rem; max-width: 44ch; margin-left: auto; margin-right: auto; line-height: 1.6; }
  .sc-seo-ask { padding: 64px 0; background: var(--paper-2, #f5f5f7); }
  .sc-seo-ask h2 { font-size: clamp(1.3rem, 3vw, 1.8rem); margin: 0 0 16px; }
  .sc-seo-ask p { font-size: 0.95rem; color: var(--ink-soft); line-height: 1.7; max-width: 60ch; margin: 0 auto; text-align: center; }
  .sc-seo-related { padding: 32px 0; background: var(--paper); border-top: 1px solid var(--line); text-align: center; }
  .sc-seo-related p { font-size: 0.88rem; color: var(--ink-soft); margin: 0; }
  .sc-seo-related a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .sc-seo-related a:hover { color: var(--ink); }
  @media (max-width: 720px) {
    .sc-hero { padding: 64px 0 48px; }
    .sc-hero-grid { grid-template-columns: 1fr; text-align: center; }
    .sc-hero-copy { display: flex; flex-direction: column; align-items: center; }
    .sc-hero-mockup { max-width: 280px; margin: 0 auto; }
    .sc-pain, .sc-solution, .sc-how { padding: 56px 0; }
    .sc-pain-list { grid-template-columns: 1fr; }
    .sc-feat-grid { grid-template-columns: 1fr; }
    .sc-stats { padding: 48px 0; }
    .sc-stats-row { gap: 32px; }
    .sc-final { padding: 72px 0; }
  }
</style>
