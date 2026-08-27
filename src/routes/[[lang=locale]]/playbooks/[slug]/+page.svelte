<script lang="ts">
  import { onMount } from 'svelte';
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import MarcoWidget from '$lib/components/MarcoWidget.svelte';
  import { BOOKING_URL } from '$lib/links';
  import { getPlaybook, type Playbook } from '$lib/data/playbooks';
  import { marketingStartHref } from '$lib/start-href';
  import '$lib/styles/landing.css';

  let { data } = $props();
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const waitlistActive = $derived(data.waitlistActive);
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const loggedIn = $derived(Boolean(data.session));
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));

  const slug = $derived($page.params.slug);
  const pb = $derived(getPlaybook(slug));
  const tk = 'landing.playbooks';
  const pk = `landing.playbooks.playbooks.${slug}`;

  let openPhase = $state<number | null>(0);
  function togglePhase(i: number) {
    openPhase = openPhase === i ? null : i;
  }

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
  {#if pb}
    <title>{$_(`${pk}.title`)} — Autopilot Playbook — Anomalia</title>
    <meta name="description" content={$_(`${pk}.desc`)} />
    <meta name="robots" content="index, follow" />
  {/if}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">
  {#if pb}
    <!-- ============ BREADCRUMB ============ -->
    <nav class="pb-breadcrumb">
      <div class="wrap">
        <a href={lp('/playbooks')}>{$_(`${tk}.hero.eyebrow`)}</a>
        <span>›</span>
        <span>{$_(`${pk}.title`)}</span>
      </div>
    </nav>

    <!-- ============ HERO ============ -->
    <section class="pbp-hero">
      <div class="wrap">
        <div class="pbp-hero-cat">{$_(`${tk}.categories.${pb.category}`)}</div>
        <h1 class="pbp-h1 reveal">{$_(`${pk}.title`)}</h1>
        <p class="pbp-desc reveal" data-d="1">{$_(`${pk}.desc`)}</p>
        <div class="pbp-stats reveal" data-d="2">
          <div class="pbp-stat">
            <span class="pbp-stat-num">{pb.searchVol}/mo</span>
            <span class="pbp-stat-lbl">Search demand</span>
          </div>
          <div class="pbp-stat">
            <span class="pbp-stat-num">{pb.kd}</span>
            <span class="pbp-stat-lbl">Difficulty</span>
          </div>
          <div class="pbp-stat">
            <span class="pbp-stat-num">{pb.phases.length}</span>
            <span class="pbp-stat-lbl">Phases</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ============ EXECUTIVE NOTE ============ -->
    <section class="pbp-note">
      <div class="wrap">
        <div class="pbp-note-card reveal">
          <strong>Executive note</strong>
          <p>{$_(`${pk}.execNote`)}</p>
        </div>
      </div>
    </section>

    <!-- ============ KEY TAKEAWAYS ============ -->
    <section class="pbp-takeaways">
      <div class="wrap">
        <h2 class="reveal">Key takeaways</h2>
        <ol>
          {#each pb.takeaways as t, i (i)}
            <li class="reveal" data-d={i + 1}>{t}</li>
          {/each}
        </ol>
      </div>
    </section>

    <!-- ============ ROADMAP ============ -->
    <section class="pbp-roadmap">
      <div class="wrap">
        <div class="sec-head reveal">
          <div class="kicker">Strategic sequence</div>
          <h2>Your content autopilot roadmap</h2>
          <p>Run these in order. Each phase builds on the last.</p>
        </div>
        <div class="pbp-phases">
          {#each pb.phases as phase, i (i)}
            <div class="pbp-phase reveal" data-d={(i % 3) + 1}>
              <button class="pbp-phase-header" onclick={() => togglePhase(i)} aria-expanded={openPhase === i}>
                <span class="pbp-phase-num">{String(i + 1).padStart(2, '0')}</span>
                <span class="pbp-phase-title">{phase.title}</span>
                <span class="pbp-phase-arrow" class:open={openPhase === i}>→</span>
              </button>
              {#if openPhase === i}
                <div class="pbp-phase-body">
                  <p>{phase.desc}</p>
                  <ol>
                    {#each phase.steps as step (step)}
                      <li>{step}</li>
                    {/each}
                  </ol>
                  <div class="pbp-phase-compare">
                    <div class="pbp-phase-legacy">
                      <span>Legacy approach</span>
                      <p>{phase.legacy}</p>
                    </div>
                    <div class="pbp-phase-winning">
                      <span>Winning move</span>
                      <p>{phase.winning}</p>
                    </div>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </section>

    <!-- ============ OUTLOOK ============ -->
    <section class="pbp-outlook">
      <div class="wrap">
        <div class="sec-head reveal">
          <div class="kicker">Illustrative outlook</div>
          <h2>What steady execution looks like</h2>
          <p>Consistent publishing compounds. This is what growth looks like when the system runs as intended.</p>
        </div>

        <!-- Chart -->
        <div class="pbp-chart reveal">
          <div class="pbp-chart-header">
            <span class="pbp-chart-label">Indicative monthly organic visits</span>
            <span class="pbp-chart-illustrative">ILLUSTRATIVE</span>
          </div>

          <!-- Phase bar above chart -->
          <div class="pbp-phases-bar">
            <div class="pbp-phase-tag foundation">Foundation<small>Months 1–3</small></div>
            <div class="pbp-phase-tag growth">Growth<small>Months 3–6</small></div>
            <div class="pbp-phase-tag scale">Scale<small>Months 6–12</small></div>
          </div>

          <!-- Chart body -->
          <div class="pbp-chart-body">
            <!-- Y-axis -->
            <div class="pbp-chart-yaxis">
              <span>480</span>
              <span>360</span>
              <span>240</span>
              <span>120</span>
              <span>0</span>
            </div>

            <!-- Grid + bars -->
            <div class="pbp-chart-plot">
              <!-- Grid lines -->
              <div class="pbp-chart-grid">
                <span></span><span></span><span></span><span></span><span></span>
              </div>
              <!-- Bars -->
              <div class="pbp-chart-bars">
                <div class="pbp-col">
                  <div class="pbp-bar" style="--h: 4%"><span class="pbp-bar-val">40</span></div>
                  <span class="pbp-bar-label">M0</span>
                </div>
                <div class="pbp-col">
                  <div class="pbp-bar" style="--h: 19%"><span class="pbp-bar-val">90</span></div>
                  <span class="pbp-bar-label">M3</span>
                </div>
                <div class="pbp-col">
                  <div class="pbp-bar" style="--h: 42%"><span class="pbp-bar-val">2k</span></div>
                  <span class="pbp-bar-label">M6</span>
                </div>
                <div class="pbp-col">
                  <div class="pbp-bar" style="--h: 67%"><span class="pbp-bar-val">4k</span></div>
                  <span class="pbp-bar-label">M9</span>
                </div>
                <div class="pbp-col">
                  <div class="pbp-bar highlight" style="--h: 95%"><span class="pbp-bar-val">10k+</span></div>
                  <span class="pbp-bar-label">M12</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Phase cards below chart -->
        <div class="pbp-outlook-grid reveal" data-d="1">
          <div class="pbp-outlook-phase">
            <h4>Foundation Phase</h4>
            <span>Months 1–3</span>
            <p>Content gets indexed, first followers appear, brand voice takes shape</p>
          </div>
          <div class="pbp-outlook-phase">
            <h4>Growth Phase</h4>
            <span>Months 3–6</span>
            <p>Engagement improves, traffic becomes consistent, blog starts ranking</p>
          </div>
          <div class="pbp-outlook-phase">
            <h4>Scale Phase</h4>
            <span>Months 6–12</span>
            <p>Content compounds, priority keywords rank, real business impact kicks in</p>
          </div>
        </div>

        <p class="pbp-outlook-disclaimer reveal">Figures are illustrative placeholders, not commitments. Actual results depend on your starting authority, competition, and how consistently the phases are run. We don't promise outcomes — we give you the system to pursue them.</p>
      </div>
    </section>

    <!-- ============ RELATED ============ -->
    <section class="pbp-related">
      <div class="wrap">
        <div class="sec-head reveal">
          <div class="kicker">Related playbooks</div>
          <h2>Explore similar industries</h2>
        </div>
        <div class="pbp-related-grid">
          {#each pb.relatedSlugs as rSlug (rSlug)}
            {@const rPb = getPlaybook(rSlug)}
            {#if rPb}
              <a href={lp(`/playbooks/${rSlug}`)} class="pbp-related-card reveal">
                <span class="pbp-related-cat">{$_(`${tk}.categories.${rPb.category}`)}</span>
                <h3>{$_(`${tk}.playbooks.${rSlug}.title`)}</h3>
                <span class="pbp-related-kd">KD {rPb.kd}</span>
              </a>
            {/if}
          {/each}
        </div>
      </div>
    </section>

    <!-- ============ CTA ============ -->
    <section class="pbp-cta">
      <div class="wrap pbp-cta-inner reveal">
        <h2>The playbook is built. Now run it on autopilot.</h2>
        <p>Connect your brand to Anomalia and let the system execute every phase — content, publishing, optimization — while you focus on your business.</p>
        <div class="gr-actions">
          <a href={startHref} class="btn btn-primary btn-hero">Start free now <span class="arr">→</span></a>
          <a href={BOOKING_URL} target="_blank" rel="noopener" class="btn btn-ghost gr-ghost">Book a call</a>
        </div>
      </div>
    </section>

  {:else}
    <!-- ============ 404 ============ -->
    <section class="pbp-404">
      <div class="wrap">
        <h1>Playbook not found</h1>
        <p>We don't have a playbook for that profession yet.</p>
        <a href={lp('/playbooks')} class="btn btn-primary">Browse all playbooks</a>
      </div>
    </section>
  {/if}
</main>

<SiteFooter />
<MarcoWidget />

<style>
  /* ---------- BREADCRUMB ---------- */
  .pb-breadcrumb { padding: 100px 0 0; }
  .pb-breadcrumb .wrap { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--ink-faint); }
  .pb-breadcrumb a { color: var(--ink-faint); text-decoration: none; }
  .pb-breadcrumb a:hover { color: var(--accent); }

  /* ---------- HERO ---------- */
  .pbp-hero { padding: 32px 0 64px; }
  .pbp-hero-cat { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); margin-bottom: 12px; }
  .pbp-h1 { font-size: clamp(2.2rem, 5vw, 3.6rem); font-weight: var(--heading-weight); line-height: 1.08; letter-spacing: var(--heading-tracking); margin: 0; max-width: 20ch; text-wrap: balance; }
  .pbp-desc { font-size: 1.1rem; color: var(--ink-soft); max-width: 60ch; margin: 16px 0 0; line-height: 1.55; }
  .pbp-stats { display: flex; gap: 32px; margin-top: 32px; }
  .pbp-stat { display: flex; flex-direction: column; }
  .pbp-stat-num { font-family: var(--serif); font-size: 1.6rem; font-weight: var(--heading-weight); color: var(--accent); }
  .pbp-stat-lbl { font-size: 0.8rem; color: var(--ink-faint); margin-top: 2px; }

  /* ---------- EXECUTIVE NOTE ---------- */
  .pbp-note { padding: 0 0 64px; }
  .pbp-note-card { background: var(--paper-2); border-radius: 16px; padding: 28px 32px; max-width: 720px; }
  .pbp-note-card strong { display: block; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); margin-bottom: 10px; }
  .pbp-note-card p { font-size: 0.95rem; color: var(--ink-soft); line-height: 1.6; margin: 0; }

  /* ---------- TAKEAWAYS ---------- */
  .pbp-takeaways { padding: 64px 0; background: var(--paper-2); }
  .pbp-takeaways h2 { font-size: 1.3rem; margin: 0 0 24px; }
  .pbp-takeaways ol { max-width: 720px; padding-left: 20px; display: flex; flex-direction: column; gap: 14px; }
  .pbp-takeaways li { font-size: 0.95rem; color: var(--ink-soft); line-height: 1.5; }

  /* ---------- ROADMAP ---------- */
  .pbp-roadmap { padding: 96px 0; }
  .pbp-phases { max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; gap: 0; }
  .pbp-phase { border-bottom: 1px solid var(--line); }
  .pbp-phase-header { width: 100%; display: flex; align-items: center; gap: 16px; padding: 20px 0; background: none; border: none; cursor: pointer; text-align: left; }
  .pbp-phase-num { font-family: var(--serif); font-size: 1.2rem; font-weight: var(--heading-weight); color: var(--accent); flex-shrink: 0; }
  .pbp-phase-title { flex: 1; font-family: var(--sans); font-size: 1.05rem; font-weight: 600; color: var(--ink); }
  .pbp-phase-arrow { font-size: 18px; color: var(--ink-faint); transition: transform .25s var(--ease), color .25s var(--ease); flex-shrink: 0; }
  .pbp-phase-arrow.open { color: var(--accent); transform: rotate(90deg); }
  .pbp-phase-body { padding: 0 0 24px 48px; animation: phaseIn .3s var(--ease); }
  .pbp-phase-body p { font-size: 0.92rem; color: var(--ink-soft); line-height: 1.5; margin: 0 0 16px; }
  .pbp-phase-body ol { padding-left: 18px; display: flex; flex-direction: column; gap: 8px; margin: 0 0 20px; }
  .pbp-phase-body li { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.45; }
  .pbp-phase-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .pbp-phase-legacy, .pbp-phase-winning { padding: 16px; border-radius: 12px; }
  .pbp-phase-legacy { background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.12); }
  .pbp-phase-winning { background: rgba(var(--accent-rgb), 0.06); border: 1px solid rgba(var(--accent-rgb), 0.15); }
  .pbp-phase-legacy span, .pbp-phase-winning span { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
  .pbp-phase-legacy span { color: #ef4444; }
  .pbp-phase-winning span { color: var(--accent); }
  .pbp-phase-legacy p, .pbp-phase-winning p { font-size: 0.85rem; color: var(--ink-soft); line-height: 1.4; margin: 0; }
  @keyframes phaseIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

  /* ---------- OUTLOOK & CHART ---------- */
  /* ---------- CHART ---------- */
  .pbp-chart { max-width: 720px; margin: 0 auto 48px; background: var(--paper); border: 1px solid var(--line); border-radius: 20px; padding: 32px; }
  .pbp-chart-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .pbp-chart-label { font-size: 0.85rem; font-weight: 600; color: var(--ink-soft); }
  .pbp-chart-illustrative { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-faint); background: var(--paper-2); padding: 3px 10px; border-radius: 6px; }

  /* Phase bar */
  .pbp-phases-bar { display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 2px; margin-bottom: 40px; }
  .pbp-phase-tag { padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; display: flex; flex-direction: column; gap: 2px; }
  .pbp-phase-tag small { font-size: 10px; font-weight: 500; text-transform: none; letter-spacing: 0; opacity: 0.7; }
  .pbp-phase-tag.foundation { background: rgba(var(--accent-rgb), 0.08); color: var(--accent); }
  .pbp-phase-tag.growth { background: rgba(var(--accent-rgb), 0.14); color: var(--accent); }
  .pbp-phase-tag.scale { background: rgba(var(--accent-rgb), 0.22); color: var(--accent-2); }

  /* Chart body */
  .pbp-chart-body { display: flex; gap: 12px; }
  .pbp-chart-yaxis { display: flex; flex-direction: column; justify-content: space-between; padding-bottom: 28px; }
  .pbp-chart-yaxis span { font-size: 11px; color: var(--ink-faint); font-weight: 500; text-align: right; width: 32px; }

  .pbp-chart-plot { flex: 1; position: relative; height: 240px; }

  /* Grid lines */
  .pbp-chart-grid { position: absolute; inset: 0; bottom: 28px; display: flex; flex-direction: column; justify-content: space-between; pointer-events: none; }
  .pbp-chart-grid span { display: block; height: 1px; background: var(--line); }

  /* Bars */
  .pbp-chart-bars { position: absolute; inset: 0; bottom: 28px; display: flex; align-items: flex-end; gap: 8px; }
  .pbp-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; }
  .pbp-bar { width: 100%; max-width: 64px; height: var(--h); background: linear-gradient(180deg, var(--accent), rgba(var(--accent-rgb), 0.35)); border-radius: 6px 6px 0 0; animation: barGrow 1s var(--ease) both; position: relative; transition: opacity .2s; }
  .pbp-bar:hover { opacity: 0.85; }
  .pbp-bar.highlight { background: linear-gradient(180deg, var(--accent-2), var(--accent)); }
  .pbp-bar-val { position: absolute; top: -22px; left: 50%; transform: translateX(-50%); font-size: 12px; font-weight: 700; color: var(--ink); white-space: nowrap; }
  .pbp-bar.highlight .pbp-bar-val { color: var(--accent-2); }
  .pbp-bar-label { font-size: 11px; font-weight: 600; color: var(--ink-faint); margin-top: 8px; }

  @keyframes barGrow { from { height: 0; } }

  .pbp-outlook-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; max-width: 800px; margin: 0 auto; }
  .pbp-outlook-phase { padding: 28px 24px; background: var(--paper); border-radius: 16px; border: 1px solid var(--line); }
  .pbp-outlook-phase h4 { font-size: 1rem; font-weight: 700; margin: 0 0 4px; }
  .pbp-outlook-phase span { font-size: 0.8rem; color: var(--accent); font-weight: 600; }
  .pbp-outlook-phase p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.45; margin: 10px 0 0; }

  .pbp-outlook-disclaimer { text-align: center; font-size: 0.8rem; color: var(--ink-faint); max-width: 60ch; margin: 32px auto 0; line-height: 1.5; }

  /* ---------- OUTLOOK ---------- */
  .pbp-outlook { padding: 96px 0; background: var(--paper-2); }
  .pbp-outlook > .wrap > .sec-head p { max-width: 60ch; margin: 0 auto; }
  .pbp-outlook-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; max-width: 800px; margin: 0 auto; }
  .pbp-outlook-phase { padding: 28px 24px; background: var(--paper); border-radius: 16px; border: 1px solid var(--line); }
  .pbp-outlook-phase h4 { font-size: 1rem; font-weight: 700; margin: 0 0 4px; }
  .pbp-outlook-phase span { font-size: 0.8rem; color: var(--accent); font-weight: 600; }
  .pbp-outlook-phase p { font-size: 0.88rem; color: var(--ink-soft); line-height: 1.45; margin: 10px 0 0; }
  .pbp-outlook-disclaimer { text-align: center; font-size: 0.8rem; color: var(--ink-faint); max-width: 60ch; margin: 32px auto 0; line-height: 1.5; }

  /* ---------- RELATED ---------- */
  .pbp-related { padding: 96px 0; }
  .pbp-related-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; max-width: 800px; margin: 0 auto; }
  .pbp-related-card { display: flex; flex-direction: column; gap: 8px; padding: 24px; background: var(--paper); border: 1px solid var(--line); border-radius: 16px; text-decoration: none; transition: transform .25s var(--ease), box-shadow .25s var(--ease); }
  .pbp-related-card:hover { transform: translateY(-3px); box-shadow: 0 12px 28px -16px rgba(var(--accent-rgb), 0.4); }
  .pbp-related-cat { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); }
  .pbp-related-card h3 { font-size: 1rem; font-weight: 700; margin: 0; color: var(--ink); }
  .pbp-related-kd { font-size: 12px; color: var(--ink-faint); }

  /* ---------- CTA ---------- */
  .pbp-cta { padding: 120px 0; text-align: center; background: var(--paper-2); }
  .pbp-cta-inner { display: flex; flex-direction: column; align-items: center; }
  .pbp-cta h2 { font-size: clamp(1.8rem, 4vw, 2.8rem); font-weight: var(--heading-weight); margin: 0; max-width: 24ch; text-wrap: balance; }
  .pbp-cta p { color: var(--ink-soft); margin: 16px 0 0; font-size: 1.1rem; max-width: 50ch; line-height: 1.55; }

  /* ---------- 404 ---------- */
  .pbp-404 { padding: 160px 0; text-align: center; }
  .pbp-404 h1 { font-size: 2rem; margin: 0; }
  .pbp-404 p { color: var(--ink-soft); margin: 12px 0 24px; }

  /* ---------- RESPONSIVE ---------- */
  @media (max-width: 720px) {
    .pbp-stats { gap: 20px; }
    .pbp-phase-compare { grid-template-columns: 1fr; }
    .pbp-chart { padding: 20px; }
    .pbp-chart-plot { height: 180px; }
    .pbp-bar { max-width: 40px; }
    .pbp-bar-val { font-size: 10px; top: -18px; }
    .pbp-phases-bar { grid-template-columns: 1fr; }
    .pbp-outlook-grid { grid-template-columns: 1fr; }
    .pbp-related-grid { grid-template-columns: 1fr; }
    .pbp-cta { padding: 84px 0; }
  }
</style>
