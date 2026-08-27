<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import '$lib/styles/landing.css';

  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  let hoursPerWeek = $state(10);
  let hourlyRate = $state(50);
  let postsPerWeek = $state(5);
  let teamSize = $state(1);

  const anomaliaPrices = { starter: 49, pro: 199 };

  let results = $derived(() => {
    const currentCostMonthly = hoursPerWeek * hourlyRate * 4.33 * teamSize;
    const suggestedPlan = postsPerWeek <= 8 ? 'starter' : 'pro';
    const anomaliaCost = anomaliaPrices[suggestedPlan as keyof typeof anomaliaPrices];
    const savedHoursMonthly = hoursPerWeek * 4.33 * 0.8 * teamSize;
    const savedMoneyMonthly = currentCostMonthly - anomaliaCost;
    const roi = ((savedMoneyMonthly / anomaliaCost) * 100).toFixed(0);
    const yearlySaved = savedMoneyMonthly * 12;
    return { currentCostMonthly, suggestedPlan, anomaliaCost, savedHoursMonthly, savedMoneyMonthly, roi, yearlySaved };
  });
</script>

<svelte:head>
  <title>{$_('tools.social-media-roi.meta.title')}</title>
  <meta name="description" content={$_('tools.social-media-roi.meta.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('tools.social-media-roi.meta.ogTitle')} />
  <meta property="og:description" content={$_('tools.social-media-roi.meta.ogDescription')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={$_('tools.social-media-roi.meta.twitterTitle')} />
  <meta name="twitter:description" content={$_('tools.social-media-roi.meta.twitterDescription')} />
</svelte:head>

<SiteNav cta={$_('tools.common.navCta')} />

<main>
  <section class="tool-hero">
    <div class="wrap">
      <span class="eyebrow">{$_('tools.common.eyebrow')}</span>
      <h1>{$_('tools.social-media-roi.hero.title')}</h1>
      <p class="subhead">{$_('tools.social-media-roi.hero.subhead')}<br />{$_('tools.social-media-roi.hero.subheadLine2')}</p>
    </div>
  </section>

  <section class="tool-body">
    <div class="wrap">
      <div class="calc-grid">
        <!-- Inputs -->
        <div class="calc-inputs">
          <h3>{$_('tools.social-media-roi.inputs.title')}</h3>

          <div class="input-group">
            <label for="hours">{$_('tools.social-media-roi.inputs.hours')}</label>
            <div class="range-row">
              <input type="range" id="hours" min="1" max="40" step="1" bind:value={hoursPerWeek} />
              <span class="range-val">{$_('tools.social-media-roi.inputs.hoursValue', { values: { count: hoursPerWeek } })}</span>
            </div>
          </div>

          <div class="input-group">
            <label for="rate">{$_('tools.social-media-roi.inputs.rate')}</label>
            <div class="range-row">
              <input type="range" id="rate" min="10" max="200" step="5" bind:value={hourlyRate} />
              <span class="range-val">{$_('tools.social-media-roi.inputs.rateValue', { values: { value: hourlyRate } })}</span>
            </div>
          </div>

          <div class="input-group">
            <label for="posts">{$_('tools.social-media-roi.inputs.posts')}</label>
            <div class="range-row">
              <input type="range" id="posts" min="1" max="50" step="1" bind:value={postsPerWeek} />
              <span class="range-val">{postsPerWeek}</span>
            </div>
          </div>

          <div class="input-group">
            <label for="team">{$_('tools.social-media-roi.inputs.team')}</label>
            <div class="range-row">
              <input type="range" id="team" min="1" max="10" step="1" bind:value={teamSize} />
              <span class="range-val">{teamSize}</span>
            </div>
          </div>
        </div>

        <!-- Results -->
        <div class="calc-results">
          <h3>{$_('tools.social-media-roi.results.title')}</h3>

          <div class="result-card highlight">
            <span class="result-label">{$_('tools.social-media-roi.results.monthlyCost')}</span>
            <span class="result-value">€{results().currentCostMonthly.toLocaleString('it-IT', { maximumFractionDigits: 0 })}</span>
          </div>

          <div class="result-card">
            <span class="result-label">{$_('tools.social-media-roi.results.plan')}</span>
            <span class="result-value plan">{$_('tools.social-media-roi.results.planValue', { values: { plan: results().suggestedPlan.charAt(0).toUpperCase() + results().suggestedPlan.slice(1), price: results().anomaliaCost } })}</span>
          </div>

          <div class="result-card accent">
            <span class="result-label">{$_('tools.social-media-roi.results.saveMonthly')}</span>
            <span class="result-value">€{results().savedMoneyMonthly.toLocaleString('it-IT', { maximumFractionDigits: 0 })}</span>
          </div>

          <div class="result-card">
            <span class="result-label">{$_('tools.social-media-roi.results.hoursSaved')}</span>
            <span class="result-value">{$_('tools.social-media-roi.results.hoursValue', { values: { count: results().savedHoursMonthly.toFixed(0) } })}</span>
          </div>

          <div class="result-card accent">
            <span class="result-label">{$_('tools.social-media-roi.results.roi')}</span>
            <span class="result-value">{$_('tools.social-media-roi.results.roiValue', { values: { value: results().roi } })}</span>
          </div>

          <div class="result-card">
            <span class="result-label">{$_('tools.social-media-roi.results.yearly')}</span>
            <span class="result-value">€{results().yearlySaved.toLocaleString('it-IT', { maximumFractionDigits: 0 })}</span>
          </div>

          <a href="/start" class="btn btn-primary result-cta">{$_('tools.social-media-roi.results.cta')}</a>
        </div>
      </div>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .tool-hero {
    padding: 150px 0 80px;
    text-align: center;
    min-height: 40vh;
    display: flex;
    align-items: center;
  }
  .tool-hero h1 {
    font-size: clamp(2.4rem, 4.4vw, 3.5rem);
    font-weight: var(--heading-weight);
    line-height: 1.12;
    letter-spacing: var(--heading-tracking);
    margin: 0 auto;
    max-width: 20ch;
  }
  .tool-hero .subhead {
    font-size: clamp(1.05rem, 1.5vw, 1.25rem);
    color: var(--ink-soft);
    max-width: 48ch;
    margin: 24px auto 0;
    line-height: 1.45;
  }

  .tool-body {
    padding: 0 0 120px;
  }

  .calc-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 40px;
    max-width: 900px;
    margin: 0 auto;
  }

  .calc-inputs, .calc-results {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 32px;
  }

  .calc-inputs h3, .calc-results h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--ink);
    margin: 0 0 28px;
    letter-spacing: -0.02em;
  }

  .input-group {
    margin-bottom: 24px;
  }
  .input-group:last-child { margin-bottom: 0; }

  .input-group label {
    display: block;
    font-size: 0.85rem;
    color: var(--ink-soft);
    margin-bottom: 10px;
    font-weight: 500;
  }

  .range-row {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  input[type="range"] {
    flex: 1;
    -webkit-appearance: none;
    appearance: none;
    height: 6px;
    border-radius: 3px;
    background: var(--line);
    outline: none;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(var(--accent-rgb), 0.3);
  }
  input[type="range"]::-moz-range-thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: none;
    box-shadow: 0 2px 8px rgba(var(--accent-rgb), 0.3);
  }

  .range-val {
    font-size: 1rem;
    font-weight: 700;
    color: var(--ink);
    min-width: 50px;
    text-align: right;
  }

  .result-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 0;
    border-bottom: 1px solid var(--line);
  }
  .result-card:last-of-type { border-bottom: none; }

  .result-label {
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .result-value {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--ink);
  }
  .result-value.plan {
    font-size: 0.9rem;
    text-transform: capitalize;
  }

  .result-card.accent .result-value {
    color: #22c55e;
  }
  .result-card.highlight .result-value {
    color: #ef4444;
  }

  .result-cta {
    display: block;
    text-align: center;
    margin-top: 24px;
    width: 100%;
  }

  @media (max-width: 768px) {
    .calc-grid {
      grid-template-columns: 1fr;
    }
    .tool-hero { padding: 124px 0 60px; }
    .tool-hero h1 { font-size: 1.8rem; max-width: none; white-space: normal !important; overflow-wrap: break-word; word-break: break-word; }
  }
</style>
