<script lang="ts">
  import { onMount } from 'svelte';
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import MarcoWidget from '$lib/components/MarcoWidget.svelte';
  import { BOOKING_URL } from '$lib/links';
  import { marketingStartHref } from '$lib/start-href';
  import '$lib/styles/landing.css';

  let { data } = $props();
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const waitlistActive = $derived(data.waitlistActive);
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const loggedIn = $derived(Boolean(data.session));
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));
  const tk = 'landing.playbooks';

  const CATEGORIES = ['all', 'food', 'retail', 'health', 'beauty', 'fitness', 'services', 'creative', 'local'] as const;

  const PLAYBOOKS = [
    { slug: 'restaurant', cat: 'food', kd: 52 },
    { slug: 'cafe', cat: 'food', kd: 44 },
    { slug: 'bakery', cat: 'food', kd: 41 },
    { slug: 'pizzeria', cat: 'food', kd: 48 },
    { slug: 'ecommerce', cat: 'retail', kd: 68 },
    { slug: 'fashion-brand', cat: 'retail', kd: 58 },
    { slug: 'jewelry-store', cat: 'retail', kd: 49 },
    { slug: 'pet-shop', cat: 'retail', kd: 42 },
    { slug: 'dental-clinic', cat: 'health', kd: 64 },
    { slug: 'chiropractor', cat: 'health', kd: 54 },
    { slug: 'nutritionist', cat: 'health', kd: 52 },
    { slug: 'mental-health', cat: 'health', kd: 61 },
    { slug: 'hair-salon', cat: 'beauty', kd: 47 },
    { slug: 'nail-studio', cat: 'beauty', kd: 39 },
    { slug: 'spa', cat: 'beauty', kd: 45 },
    { slug: 'barbershop', cat: 'beauty', kd: 43 },
    { slug: 'gym', cat: 'fitness', kd: 64 },
    { slug: 'yoga-studio', cat: 'fitness', kd: 51 },
    { slug: 'personal-trainer', cat: 'fitness', kd: 56 },
    { slug: 'crossfit-box', cat: 'fitness', kd: 52 },
    { slug: 'law-firm', cat: 'services', kd: 72 },
    { slug: 'real-estate', cat: 'services', kd: 69 },
    { slug: 'accountant', cat: 'services', kd: 58 },
    { slug: 'cleaning-service', cat: 'services', kd: 46 },
    { slug: 'photographer', cat: 'creative', kd: 54 },
    { slug: 'agency', cat: 'creative', kd: 62 },
    { slug: 'freelancer', cat: 'creative', kd: 48 },
    { slug: 'coach', cat: 'creative', kd: 55 },
    { slug: 'hotel', cat: 'local', kd: 61 },
    { slug: 'auto-shop', cat: 'local', kd: 49 },
    { slug: 'plumber', cat: 'local', kd: 52 },
    { slug: 'electrician', cat: 'local', kd: 47 }
  ];

  let activeCategory = $state<string>('all');
  const filtered = $derived(
    activeCategory === 'all'
      ? PLAYBOOKS
      : PLAYBOOKS.filter((p) => p.cat === activeCategory)
  );

  const siteUrl = $derived($page.url.origin);
  const jsonLd = $derived(
    JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${siteUrl}/#org`,
          name: 'Anomalia',
          url: `${siteUrl}/`,
          logo: `${siteUrl}/icon-512.png`
        },
        {
          '@type': 'WebPage',
          '@id': `${siteUrl}/playbooks`,
          url: `${siteUrl}/playbooks`,
          name: $_('meta.playbooks.title'),
          description: $_('meta.playbooks.description'),
          publisher: { '@id': `${siteUrl}/#org` },
          inLanguage: $locale ?? 'en'
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
            { '@type': 'ListItem', position: 2, name: 'Playbooks', item: `${siteUrl}/playbooks` }
          ]
        }
      ]
    })
  );

  let openFaq = $state<number | null>(null);
  function toggleFaq(i: number) {
    openFaq = openFaq === i ? null : i;
  }

  onMount(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  });
</script>

<svelte:head>
  <title>{$_('meta.playbooks.title')}</title>
  <meta name="description" content={$_('meta.playbooks.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('meta.playbooks.title')} />
  <meta property="og:description" content={$_('meta.playbooks.description')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:title" content={$_('meta.playbooks.title')} />
  <meta name="twitter:description" content={$_('meta.playbooks.description')} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">

  <!-- ============ HERO ============ -->
  <section class="pb-hero">
    <div class="wrap pb-hero-inner">
      <span class="eyebrow reveal">{$_(`${tk}.hero.eyebrow`)}</span>
      <h1 class="pb-h1 reveal" data-d="1">{$_(`${tk}.hero.title`)}</h1>
      <p class="pb-sub reveal" data-d="2">{$_(`${tk}.hero.desc`)}</p>
    </div>
  </section>

  <!-- ============ WHAT'S INSIDE ============ -->
  <section class="pb-inside">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.inside.kicker`)}</div>
        <h2>{$_(`${tk}.inside.title`)}</h2>
      </div>
      <div class="pb-inside-grid">
        {#each ['contentPlan', 'socialTemplates', 'blogStrategy', 'hashtagBank', 'postingSchedule', 'competitorGap'] as k, i (k)}
          <div class="pb-inside-card reveal" data-d={(i % 3) + 1}>
            <span class="pb-inside-n">{String(i + 1).padStart(2, '0')}</span>
            <h3>{$_(`${tk}.inside.${k}.title`)}</h3>
            <p>{$_(`${tk}.inside.${k}.desc`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ DIRECTORY ============ -->
  <section class="pb-directory">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.directory.kicker`)}</div>
        <h2>{$_(`${tk}.directory.title`)}</h2>
        <p>{$_(`${tk}.directory.sub`)}</p>
      </div>

      <!-- Category filters -->
      <div class="pb-filters reveal">
        {#each CATEGORIES as cat (cat)}
          <button
            class="pb-filter"
            class:active={activeCategory === cat}
            onclick={() => activeCategory = cat}
          >
            {$_(`${tk}.categories.${cat}`)}
          </button>
        {/each}
      </div>

      <!-- Playbook grid -->
      <div class="pb-grid">
        {#each filtered as pb (pb.slug)}
          <a href={lp(`/playbooks/${pb.slug}`)} class="pb-card reveal">
            <div class="pb-card-top">
              <span class="pb-card-cat">{$_(`${tk}.categories.${pb.cat}`)}</span>
              <span class="pb-card-kd">KD {pb.kd}</span>
            </div>
            <h3 class="pb-card-title">{$_(`${tk}.playbooks.${pb.slug}.title`)}</h3>
            <p class="pb-card-desc">{$_(`${tk}.playbooks.${pb.slug}.desc`)}</p>
            <div class="pb-card-footer">
              <span class="pb-card-tag">{$_(`${tk}.directory.tag`)}</span>
              <span class="pb-card-arrow">→</span>
            </div>
          </a>
        {/each}
      </div>

      <div class="pb-count reveal">
        <p>Showing {filtered.length} of {PLAYBOOKS.length} playbooks</p>
      </div>
    </div>
  </section>

  <!-- ============ SAMPLE PLAYBOOK ============ -->
  <section class="pb-sample">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.sample.kicker`)}</div>
        <h2>{$_(`${tk}.sample.title`)}</h2>
      </div>
      <div class="pb-sample-card reveal">
        <div class="pb-sample-header">
          <div class="pb-sample-cat">{$_(`${tk}.sample.category`)}</div>
          <h3>{$_(`${tk}.sample.name`)}</h3>
          <p>{$_(`${tk}.sample.tagline`)}</p>
        </div>
        <div class="pb-sample-stats">
          <div class="pb-sample-stat">
            <span class="pb-sample-stat-num">{$_(`${tk}.sample.stat1.num`)}</span>
            <span class="pb-sample-stat-lbl">{$_(`${tk}.sample.stat1.label`)}</span>
          </div>
          <div class="pb-sample-stat">
            <span class="pb-sample-stat-num">{$_(`${tk}.sample.stat2.num`)}</span>
            <span class="pb-sample-stat-lbl">{$_(`${tk}.sample.stat2.label`)}</span>
          </div>
          <div class="pb-sample-stat">
            <span class="pb-sample-stat-num">{$_(`${tk}.sample.stat3.num`)}</span>
            <span class="pb-sample-stat-lbl">{$_(`${tk}.sample.stat3.label`)}</span>
          </div>
        </div>
        <div class="pb-sample-roadmap">
          <h4>{$_(`${tk}.sample.roadmapTitle`)}</h4>
          <ol>
            {#each ['r1', 'r2', 'r3', 'r4', 'r5'] as k (k)}
              <li>{$_(`${tk}.sample.${k}`)}</li>
            {/each}
          </ol>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ FAQ ============ -->
  <section class="pb-faq">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_(`${tk}.faq.kicker`)}</div>
        <h2>{$_(`${tk}.faq.title`)}</h2>
      </div>
      <div class="pb-faq-list">
        {#each ['q1', 'q2', 'q3', 'q4'] as k, i (k)}
          <div class="pb-faq-item reveal" data-d={i + 1}>
            <button class="pb-faq-q" onclick={() => toggleFaq(i)} aria-expanded={openFaq === i}>
              <span>{$_(`${tk}.faq.${k}.q`)}</span>
              <span class="pb-faq-arrow" class:open={openFaq === i}>→</span>
            </button>
            {#if openFaq === i}
              <div class="pb-faq-a">
                <p>{$_(`${tk}.faq.${k}.a`)}</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ FINAL CTA ============ -->
  <section class="pb-final">
    <div class="wrap pb-final-inner reveal">
      <h2>{$_(`${tk}.final.title`)}</h2>
      <p>{$_(`${tk}.final.sub`)}</p>
      <div class="gr-actions pb-final-actions">
        <a href={startHref} class="btn btn-primary btn-hero">{$_(`${tk}.final.ctaPrimary`)} <span class="arr">→</span></a>
        <a href={BOOKING_URL} target="_blank" rel="noopener" class="btn btn-ghost gr-ghost">{$_(`${tk}.final.ctaSecondary`)}</a>
      </div>
    </div>
  </section>

</main>

<SiteFooter />
<MarcoWidget />

<style>
  /* ---------- HERO ---------- */
  .pb-hero { padding: 120px 0 80px; text-align: center; background: var(--paper-2); }
  .pb-h1 { font-size: clamp(2.2rem, 5vw, 3.8rem); font-weight: var(--heading-weight); line-height: 1.08; letter-spacing: var(--heading-tracking); margin: 0 auto; max-width: 18ch; text-wrap: balance; }
  .pb-sub { color: var(--ink-soft); font-size: 1.15rem; max-width: 55ch; margin: 20px auto 0; line-height: 1.55; }

  /* ---------- WHAT'S INSIDE ---------- */
  .pb-inside { padding: 96px 0; }
  .pb-inside-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .pb-inside-card { padding: 28px 24px; border-radius: 18px; background: var(--paper); border: 1px solid var(--line); }
  .pb-inside-n { font-family: var(--serif); font-size: 1.4rem; font-weight: var(--heading-weight); color: var(--accent); display: block; margin-bottom: 12px; }
  .pb-inside-card h3 { font-family: var(--sans); font-size: 1.05rem; font-weight: 700; margin: 0; }
  .pb-inside-card p { font-size: 0.88rem; color: var(--ink-soft); margin-top: 8px; line-height: 1.5; }

  /* ---------- DIRECTORY ---------- */
  .pb-directory { padding: 96px 0; background: var(--paper-2); }
  .pb-filters { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-bottom: 40px; }
  .pb-filter { padding: 8px 18px; border-radius: 999px; border: 1px solid var(--line); background: var(--paper); font-family: var(--sans); font-size: 0.85rem; font-weight: 600; color: var(--ink-soft); cursor: pointer; transition: all .2s var(--ease); }
  .pb-filter:hover { border-color: var(--accent); color: var(--accent); }
  .pb-filter.active { background: var(--invert-surface); color: #fff; border-color: var(--ink); }

  .pb-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .pb-card { display: flex; flex-direction: column; background: var(--paper); border: 1px solid var(--line); border-radius: 16px; padding: 22px 20px; transition: transform .25s var(--ease), box-shadow .25s var(--ease); cursor: pointer; text-decoration: none; color: inherit; }
  .pb-card:hover { transform: translateY(-3px); box-shadow: 0 12px 28px -16px rgba(var(--accent-rgb), 0.4); }
  .pb-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .pb-card-cat { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); }
  .pb-card-kd { font-size: 11px; font-weight: 600; color: var(--ink-faint); background: var(--paper-2); padding: 2px 8px; border-radius: 6px; }
  .pb-card-title { font-family: var(--sans); font-size: 1rem; font-weight: 700; margin: 0; line-height: 1.3; }
  .pb-card-desc { font-size: 0.82rem; color: var(--ink-soft); margin-top: 6px; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .pb-card-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
  .pb-card-tag { font-size: 11px; font-weight: 600; color: var(--ink-faint); }
  .pb-card-arrow { font-size: 16px; color: var(--ink-faint); transition: color .2s; }
  .pb-card:hover .pb-card-arrow { color: var(--accent); }

  .pb-count { text-align: center; margin-top: 32px; }
  .pb-count p { font-size: 0.85rem; color: var(--ink-faint); }

  /* ---------- SAMPLE PLAYBOOK ---------- */
  .pb-sample { padding: 96px 0; }
  .pb-sample-card { max-width: 720px; margin: 0 auto; background: var(--paper); border: 1px solid var(--line); border-radius: 24px; overflow: hidden; box-shadow: 0 24px 50px -30px rgba(0,0,0,0.12); }
  .pb-sample-header { padding: 32px 32px 24px; border-bottom: 1px solid var(--line); }
  .pb-sample-cat { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); margin-bottom: 8px; }
  .pb-sample-header h3 { font-family: var(--serif); font-size: 1.5rem; font-weight: var(--heading-weight); margin: 0; }
  .pb-sample-header p { font-size: 0.95rem; color: var(--ink-soft); margin-top: 8px; line-height: 1.5; }
  .pb-sample-stats { display: grid; grid-template-columns: repeat(3, 1fr); border-bottom: 1px solid var(--line); }
  .pb-sample-stat { padding: 20px; text-align: center; }
  .pb-sample-stat:not(:last-child) { border-right: 1px solid var(--line); }
  .pb-sample-stat-num { display: block; font-family: var(--serif); font-size: 1.4rem; font-weight: var(--heading-weight); color: var(--accent); }
  .pb-sample-stat-lbl { display: block; font-size: 0.8rem; color: var(--ink-faint); margin-top: 4px; }
  .pb-sample-roadmap { padding: 28px 32px; }
  .pb-sample-roadmap h4 { font-family: var(--sans); font-size: 0.95rem; font-weight: 700; margin: 0 0 16px; }
  .pb-sample-roadmap ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 10px; }
  .pb-sample-roadmap li { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.4; }

  /* ---------- FAQ ---------- */
  .pb-faq { padding: 96px 0; background: var(--paper-2); }
  .pb-faq-list { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 0; }
  .pb-faq-item { border-bottom: 1px solid var(--line); }
  .pb-faq-q { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 0; background: none; border: none; cursor: pointer; font-family: var(--sans); font-size: 1.05rem; font-weight: 600; color: var(--ink); text-align: left; }
  .pb-faq-arrow { font-size: 18px; color: var(--ink-faint); transition: transform .25s var(--ease), color .25s var(--ease); flex-shrink: 0; }
  .pb-faq-arrow.open { color: var(--accent); transform: rotate(90deg); }
  .pb-faq-a { padding: 0 0 22px; animation: faqIn .3s var(--ease); }
  .pb-faq-a p { font-size: 0.96rem; color: var(--ink-soft); line-height: 1.6; }
  @keyframes faqIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

  /* ---------- FINAL CTA ---------- */
  .pb-final { padding: 120px 0; text-align: center; }
  .pb-final-inner { display: flex; flex-direction: column; align-items: center; }
  .pb-final h2 { font-size: clamp(2rem, 4.5vw, 3.2rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; max-width: 26ch; text-wrap: balance; }
  .pb-final p { color: var(--ink-soft); margin: 18px 0 0; font-size: 1.15rem; max-width: 50ch; line-height: 1.55; }
  .pb-final-actions { margin-top: 34px; }

  /* ---------- RESPONSIVE ---------- */
  @media (max-width: 1024px) {
    .pb-grid { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 920px) {
    .pb-inside-grid { grid-template-columns: repeat(2, 1fr); }
    .pb-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 720px) {
    .pb-hero { padding: 84px 0 56px; }
    .pb-inside, .pb-directory, .pb-sample, .pb-faq { padding: 64px 0; }
    .pb-grid { grid-template-columns: 1fr; }
    .pb-sample-stats { grid-template-columns: 1fr; }
    .pb-sample-stat:not(:last-child) { border-right: none; border-bottom: 1px solid var(--line); }
    .pb-final { padding: 84px 0; }
  }
  @media (max-width: 480px) {
    .pb-inside-grid { grid-template-columns: 1fr; }
  }
</style>
