<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import '$lib/styles/landing.css';

  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  let input = $state('');
  let loading = $state(false);
  let error = $state('');
  let research = $state<any>(null);

  async function runResearch() {
    if (!input.trim()) return;
    loading = true;
    error = '';
    research = null;
    try {
      const res = await fetch('/api/tools/keyword-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: input.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        error = data.error || $_('tools.common.errors.generic');
      } else {
        research = data.research;
      }
    } catch {
      error = $_('tools.common.errors.network');
    } finally {
      loading = false;
    }
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    runResearch();
  }

  function oppClass(o: string): string {
    if (o === 'high') return 'opp-high';
    if (o === 'medium') return 'opp-med';
    return 'opp-low';
  }

  function formatVolume(n: number | undefined): string {
    if (n == null || n <= 0) return '—';
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
    return String(n);
  }
</script>

<svelte:head>
  <title>{$_('tools.keyword-research.meta.title')}</title>
  <meta name="description" content={$_('tools.keyword-research.meta.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('tools.keyword-research.meta.ogTitle')} />
  <meta property="og:description" content={$_('tools.keyword-research.meta.ogDescription')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={$_('tools.keyword-research.meta.twitterTitle')} />
  <meta name="twitter:description" content={$_('tools.keyword-research.meta.twitterDescription')} />
  {@html `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: $_('tools.keyword-research.meta.schemaName'),
    url: `${$page.url.origin}${lp('/tools/keyword-research')}`,
    description: $_('tools.keyword-research.meta.schemaDescription'),
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    provider: { '@type': 'Organization', name: 'Anomalia', url: 'https://anomalia.so' }
  })}</script>`}
</svelte:head>

<SiteNav cta={$_('tools.common.navCta')} />

<main>
  <section class="kr-hero">
    <div class="wrap">
      <span class="eyebrow">{$_('tools.common.eyebrow')}</span>
      <h1>{$_('tools.keyword-research.hero.title')}</h1>
      <p class="subhead">
        {$_('tools.keyword-research.hero.subhead')}<br />
        {$_('tools.keyword-research.hero.subheadLine2')}
      </p>

      <form onsubmit={handleSubmit} class="kr-form">
        <div class="input-row">
          <input
            type="text"
            bind:value={input}
            placeholder={$_('tools.keyword-research.form.placeholder')}
            disabled={loading}
            aria-label={$_('tools.keyword-research.form.placeholder')}
          />
          <button type="submit" class="btn btn-primary" disabled={loading || !input.trim()}>
            {loading ? $_('tools.keyword-research.form.loading') : $_('tools.keyword-research.form.submit')}
          </button>
        </div>
        <p class="hint">{$_('tools.keyword-research.form.hint')}</p>
      </form>

      {#if error}
        <div class="error-box">{error}</div>
      {/if}
    </div>
  </section>

  {#if research}
    <section class="kr-results">
      <div class="wrap">
        <div class="summary-card">
          <h2>{$_('tools.keyword-research.results.title')}</h2>
          <p>{research.focusSummary}</p>
          <p class="meta">
            {$_('tools.keyword-research.results.showing', {
              values: { shown: research.keywords.length, total: research.totalFound }
            })}
          </p>
        </div>

        <div class="kw-list">
          {#each research.keywords as k, i (k.keyword)}
            <div class="kw-card">
              <div class="kw-top">
                <span class="rank">#{i + 1}</span>
                <h3>{k.keyword}</h3>
                <span class="opp {oppClass(k.opportunity)}">{$_(`tools.keyword-research.opp.${k.opportunity}`)}</span>
              </div>
              <div class="kw-metrics">
                <div>
                  <span class="m-label">{$_('tools.keyword-research.metrics.volume')}</span>
                  <span class="m-val">{formatVolume(k.volume)}</span>
                </div>
                <div>
                  <span class="m-label">{$_('tools.keyword-research.metrics.difficulty')}</span>
                  <span class="m-val">{k.difficulty != null && k.difficulty > 0 ? k.difficulty : '—'}</span>
                </div>
                <div>
                  <span class="m-label">{$_('tools.keyword-research.metrics.intent')}</span>
                  <span class="m-val">{$_(`tools.keyword-research.intent.${k.intent}`)}</span>
                </div>
              </div>
              <p class="rationale">{k.rationale}</p>
              <p class="action"><strong>{$_('tools.keyword-research.metrics.action')}:</strong> {k.action}</p>
            </div>
          {/each}
        </div>

        {#if research.lockedCount > 0}
          <div class="locked">
            <div class="locked-preview" aria-hidden="true">
              {#each Array(Math.min(3, research.lockedCount)) as _, i}
                <div class="kw-card blurred">
                  <div class="kw-top">
                    <span class="rank">#{research.keywords.length + i + 1}</span>
                    <h3>●●●● ●●●●● ●●●</h3>
                    <span class="opp opp-med">···</span>
                  </div>
                  <p class="rationale">████████████████████████</p>
                </div>
              {/each}
            </div>
            <div class="cta-section">
              <h3>{$_('tools.keyword-research.cta.title')}</h3>
              <p>
                {$_('tools.keyword-research.cta.body', { values: { n: research.lockedCount } })}
              </p>
              <a href="/start" class="btn btn-primary">{$_('tools.keyword-research.cta.button')}</a>
            </div>
          </div>
        {:else}
          <div class="cta-section">
            <h3>{$_('tools.keyword-research.cta.titleFull')}</h3>
            <p>{$_('tools.keyword-research.cta.bodyFull')}</p>
            <a href="/start" class="btn btn-primary">{$_('tools.common.cta.tryFree')}</a>
          </div>
        {/if}
      </div>
    </section>
  {/if}
</main>

<SiteFooter />

<style>
  .kr-hero {
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
  .kr-form {
    margin-bottom: 16px;
  }
  .input-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .input-row input {
    flex: 1;
    min-width: 220px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: 12px;
    font-size: 1rem;
    background: var(--paper);
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
  .kr-results {
    padding: 20px 0 80px;
  }
  .summary-card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 24px;
    margin-bottom: 24px;
  }
  .summary-card h2 {
    margin: 0 0 8px;
    font-size: 1.25rem;
  }
  .summary-card p {
    margin: 0;
    line-height: 1.5;
    color: var(--ink-soft);
  }
  .meta {
    margin-top: 10px !important;
    font-size: 0.85rem;
    color: var(--ink-faint) !important;
  }
  .kw-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .kw-card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px 20px;
  }
  .kw-top {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .rank {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--ink-faint);
  }
  .kw-top h3 {
    margin: 0;
    font-size: 1.05rem;
    flex: 1;
  }
  .opp {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-radius: 999px;
    padding: 3px 8px;
  }
  .opp-high {
    background: #dcfce7;
    color: #166534;
  }
  .opp-med {
    background: #fef3c7;
    color: #92400e;
  }
  .opp-low {
    background: #f3f4f6;
    color: #6b7280;
  }
  .kw-metrics {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .m-label {
    display: block;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-faint);
  }
  .m-val {
    font-weight: 600;
    font-size: 0.95rem;
  }
  .rationale {
    margin: 0 0 8px;
    font-size: 0.9rem;
    color: var(--ink-soft);
    line-height: 1.45;
  }
  .action {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.45;
  }
  .locked {
    margin-top: 20px;
    position: relative;
  }
  .locked-preview {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: -40px;
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
  .cta-section h3 {
    margin: 0 0 8px;
    font-size: 1.25rem;
  }
  .cta-section p {
    margin: 0 0 18px;
    color: var(--ink-soft);
    max-width: 440px;
    margin-inline: auto;
  }
</style>
