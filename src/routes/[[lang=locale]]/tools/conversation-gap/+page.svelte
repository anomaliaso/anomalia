<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import '$lib/styles/landing.css';

  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  let url = $state('');
  let postsPerWeek = $state('');
  let loading = $state(false);
  let error = $state('');
  let rateLimited = $state(false);
  let result = $state<any>(null);

  async function run(e: Event) {
    e.preventDefault();
    if (!url.trim() || loading) return;
    loading = true;
    error = '';
    rateLimited = false;
    result = null;
    try {
      const body: Record<string, string | number> = { url: url.trim() };
      if (postsPerWeek.trim()) body.postsPerWeek = Number(postsPerWeek);
      const res = await fetch('/api/tools/conversation-gap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (res.status === 429) {
        rateLimited = true;
        error = data.error || $_('tools.common.errors.generic');
      } else if (!res.ok) {
        error = data.error || $_('tools.common.errors.generic');
      } else {
        result = data.result;
      }
    } catch {
      error = $_('tools.common.errors.network');
    } finally {
      loading = false;
    }
  }

  function formatRange(n: number): string {
    if (n == null || n <= 0) return '0';
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
    return String(Math.round(n));
  }

  function scoreTone(score: number): string {
    if (score >= 70) return 'high';
    if (score >= 40) return 'med';
    return 'low';
  }
</script>

<svelte:head>
  <title>{$_('tools.conversation-gap.meta.title')}</title>
  <meta name="description" content={$_('tools.conversation-gap.meta.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <meta property="og:title" content={$_('tools.conversation-gap.meta.ogTitle')} />
  <meta property="og:description" content={$_('tools.conversation-gap.meta.ogDescription')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  {@html `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: $_('tools.conversation-gap.meta.schemaName'),
    url: `${$page.url.origin}${lp('/tools/conversation-gap')}`,
    description: $_('tools.conversation-gap.meta.schemaDescription'),
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    provider: { '@type': 'Organization', name: 'Anomalia', url: 'https://anomalia.so' }
  })}</script>`}
</svelte:head>

<SiteNav cta={$_('tools.common.navCta')} />

<main>
  <section class="cg-hero">
    <div class="wrap">
      <span class="eyebrow">{$_('tools.common.eyebrow')}</span>
      <h1>{$_('tools.conversation-gap.hero.title')}</h1>
      <p class="subhead">{$_('tools.conversation-gap.hero.subhead')}</p>

      <form onsubmit={run} class="cg-form">
        <div class="input-row">
          <input
            type="text"
            bind:value={url}
            placeholder={$_('tools.conversation-gap.form.url')}
            disabled={loading}
            aria-label={$_('tools.conversation-gap.form.url')}
          />
          <input
            class="cadence"
            type="number"
            min="0.25"
            max="14"
            step="0.25"
            bind:value={postsPerWeek}
            placeholder={$_('tools.conversation-gap.form.postsPerWeek')}
            disabled={loading}
            aria-label={$_('tools.conversation-gap.form.postsPerWeek')}
          />
          <button type="submit" class="btn btn-primary" disabled={loading || !url.trim()}>
            {loading ? $_('tools.conversation-gap.form.loading') : $_('tools.conversation-gap.form.submit')}
          </button>
        </div>
        <p class="hint">{$_('tools.conversation-gap.form.hint')}</p>
      </form>

      {#if error}
        <div class="error-box" class:limit={rateLimited}>
          {error}
          {#if rateLimited}
            <a href={lp('/start')} class="limit-cta">{$_('tools.common.cta.tryFree')}</a>
          {/if}
        </div>
      {/if}
    </div>
  </section>

  {#if result}
    <section class="cg-results">
      <div class="wrap">
        <div class="hero-number">
          <p class="brand-line">
            {$_('tools.conversation-gap.results.forBrand', { values: { brand: result.brandLabel } })}
          </p>
          <div class="range">
            <span class="num">{formatRange(result.demandLow)}</span>
            <span class="sep">–</span>
            <span class="num">{formatRange(result.demandHigh)}</span>
          </div>
          <p class="range-label">{$_('tools.conversation-gap.results.rangeLabel')}</p>
          <p class="summary">{result.focusSummary}</p>
        </div>

        <div class="stats">
          <div class="stat">
            <span class="v score-{scoreTone(result.gapScore)}">{result.gapScore}</span>
            <span class="l">{$_('tools.conversation-gap.results.gapScore')}</span>
            <span class="h">{$_('tools.conversation-gap.results.gapScoreHint')}</span>
          </div>
          <div class="stat">
            <span class="v conf-{result.confidence}">{$_(`tools.conversation-gap.confidence.${result.confidence}`)}</span>
            <span class="l">{$_('tools.conversation-gap.results.confidence')}</span>
            <span class="h">{$_('tools.conversation-gap.results.confidenceHint')}</span>
          </div>
          <div class="stat">
            <span class="v">{result.cadencePostsPerMonth}<span class="unit">/mo</span></span>
            <span class="l">{$_('tools.conversation-gap.results.cadence')}</span>
            <span class="h">
              {result.cadenceAssumed
                ? $_('tools.conversation-gap.results.cadenceAssumed')
                : $_('tools.conversation-gap.results.cadenceGiven')}
            </span>
          </div>
        </div>

        <div class="limits">
          <h2>{$_('tools.conversation-gap.limits.title')}</h2>
          <ul>
            <li>{$_('tools.conversation-gap.limits.demandOnly')}</li>
            <li>{$_('tools.conversation-gap.limits.noConversion')}</li>
            <li>{$_('tools.conversation-gap.limits.noReach')}</li>
          </ul>
        </div>

        {#if result.methodNotes?.length}
          <details class="method">
            <summary>{$_('tools.conversation-gap.method.title')}</summary>
            <ul>
              {#each result.methodNotes as note}
                <li>{note}</li>
              {/each}
            </ul>
          </details>
        {/if}

        {#if result.lockedCount > 0}
          <div class="locked">
            <div class="locked-preview" aria-hidden="true">
              {#each Array(Math.min(3, result.lockedCount)) as _, i}
                <div class="topic-card blurred">
                  <div class="topic-top">
                    <span class="rank">#{i + 1}</span>
                    <h3>●●●● ●●●●● ●●●●</h3>
                    <span class="vol">···</span>
                  </div>
                  <p>████████████████████████████</p>
                </div>
              {/each}
            </div>
            <div class="cta-section">
              <h3>{$_('tools.conversation-gap.cta.title')}</h3>
              <p>
                {$_('tools.conversation-gap.cta.body', { values: { n: result.lockedCount } })}
              </p>
              <a href={lp('/start')} class="btn btn-primary">{$_('tools.conversation-gap.cta.button')}</a>
            </div>
          </div>
        {:else}
          <div class="cta-section solo">
            <h3>{$_('tools.conversation-gap.cta.titleFull')}</h3>
            <p>{$_('tools.conversation-gap.cta.bodyFull')}</p>
            <a href={lp('/start')} class="btn btn-primary">{$_('tools.common.cta.tryFree')}</a>
          </div>
        {/if}
      </div>
    </section>
  {/if}
</main>

<SiteFooter />

<style>
  .cg-hero {
    padding: 72px 0 40px;
    background:
      radial-gradient(ellipse 80% 50% at 50% -10%, rgba(34, 197, 94, 0.12), transparent),
      var(--bg, #faf9f7);
  }
  .wrap {
    max-width: 820px;
    margin: 0 auto;
    padding: 0 20px;
  }
  .eyebrow {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
    margin-bottom: 12px;
  }
  h1 {
    font-size: clamp(1.8rem, 4vw, 2.6rem);
    margin: 0 0 12px;
    letter-spacing: -0.03em;
    line-height: 1.15;
  }
  .subhead {
    color: var(--ink-soft);
    font-size: 1.05rem;
    line-height: 1.5;
    margin: 0 0 28px;
  }
  .input-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .input-row input {
    flex: 1;
    min-width: 180px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: 12px;
    font-size: 1rem;
    background: var(--paper);
  }
  .input-row input.cadence {
    flex: 0 0 140px;
    min-width: 120px;
  }
  .hint {
    margin: 10px 0 0;
    font-size: 0.85rem;
    color: var(--ink-faint);
  }
  .error-box {
    background: #fef2f2;
    color: #b91c1c;
    border: 1px solid #fecaca;
    border-radius: 12px;
    padding: 12px 16px;
    margin-top: 16px;
  }
  .error-box.limit {
    background: #fffbeb;
    color: #92400e;
    border-color: #fde68a;
  }
  .limit-cta {
    display: inline-block;
    margin-left: 8px;
    font-weight: 600;
    color: inherit;
  }
  .cg-results {
    padding: 12px 0 80px;
  }
  .hero-number {
    text-align: center;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 32px 24px 28px;
    margin-bottom: 20px;
  }
  .brand-line {
    margin: 0 0 8px;
    font-size: 0.85rem;
    color: var(--ink-faint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }
  .range {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 10px;
    letter-spacing: -0.04em;
  }
  .range .num {
    font-size: clamp(2.6rem, 8vw, 4rem);
    font-weight: 700;
    line-height: 1;
  }
  .range .sep {
    font-size: 2rem;
    color: var(--ink-faint);
    font-weight: 500;
  }
  .range-label {
    margin: 12px 0 0;
    font-size: 1rem;
    color: var(--ink-soft);
  }
  .summary {
    margin: 16px auto 0;
    max-width: 560px;
    color: var(--ink-soft);
    line-height: 1.5;
    font-size: 0.95rem;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }
  .stat {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .stat .v {
    font-size: 1.55rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .stat .unit {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--ink-faint);
    margin-left: 2px;
  }
  .stat .l {
    font-size: 0.82rem;
    color: var(--ink-soft);
  }
  .stat .h {
    font-size: 0.75rem;
    color: var(--ink-faint);
    line-height: 1.35;
  }
  .score-high {
    color: #b91c1c;
  }
  .score-med {
    color: #b45309;
  }
  .score-low {
    color: #166534;
  }
  .conf-high {
    color: #166534;
  }
  .conf-medium {
    color: #b45309;
  }
  .conf-low {
    color: #6b7280;
  }
  .limits {
    margin-bottom: 20px;
  }
  .limits h2 {
    font-size: 1rem;
    margin: 0 0 10px;
  }
  .limits ul {
    margin: 0;
    padding-left: 1.15rem;
    color: var(--ink-soft);
    line-height: 1.5;
    font-size: 0.92rem;
  }
  .method {
    margin-bottom: 24px;
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 12px 16px;
    background: var(--paper);
  }
  .method summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 0.92rem;
  }
  .method ul {
    margin: 10px 0 0;
    padding-left: 1.15rem;
    color: var(--ink-soft);
    font-size: 0.88rem;
    line-height: 1.45;
  }
  .locked {
    margin-top: 8px;
    position: relative;
  }
  .locked-preview {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: -40px;
  }
  .topic-card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px 20px;
  }
  .topic-top {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .topic-top h3 {
    margin: 0;
    flex: 1;
    font-size: 1rem;
  }
  .rank {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--ink-faint);
  }
  .vol {
    font-size: 0.8rem;
    color: var(--ink-faint);
  }
  .blurred {
    filter: blur(4px);
    user-select: none;
    opacity: 0.55;
  }
  .cta-section {
    position: relative;
    z-index: 1;
    text-align: center;
    background: linear-gradient(180deg, transparent, var(--paper) 28%);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 40px 24px 32px;
    margin-top: 8px;
  }
  .cta-section.solo {
    background: var(--paper);
  }
  .cta-section h3 {
    margin: 0 0 8px;
    font-size: 1.25rem;
  }
  .cta-section p {
    margin: 0 auto 18px;
    color: var(--ink-soft);
    max-width: 480px;
    line-height: 1.5;
  }
  @media (max-width: 600px) {
    .input-row input,
    .input-row :global(button) {
      width: 100%;
      flex: none;
    }
    .input-row input.cadence {
      width: 100%;
    }
  }
</style>
