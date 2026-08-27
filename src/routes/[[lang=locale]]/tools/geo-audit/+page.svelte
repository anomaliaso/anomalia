<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import '$lib/styles/landing.css';

  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  let url = $state('');
  let loading = $state(false);
  let error = $state('');
  let audit = $state<any>(null);

  async function runAudit() {
    if (!url.trim()) return;
    loading = true;
    error = '';
    audit = null;

    try {
      const res = await fetch('/api/tools/geo-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        error = data.error || $_('tools.common.errors.generic');
      } else {
        audit = data.audit;
      }
    } catch {
      error = $_('tools.common.errors.network');
    } finally {
      loading = false;
    }
  }

  function scoreColor(score: number): string {
    if (score >= 80) return '#22c55e';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  }

  function scoreLabel(score: number): string {
    if (score >= 80) return $_('tools.geo-audit.score.excellent');
    if (score >= 60) return $_('tools.geo-audit.score.good');
    if (score >= 40) return $_('tools.geo-audit.score.needsWork');
    return $_('tools.geo-audit.score.critical');
  }

  function severityColor(s: string): string {
    if (s === 'high') return '#ef4444';
    if (s === 'medium') return '#f59e0b';
    return '#6b7280';
  }

  function severityLabel(s: string): string {
    if (s === 'high' || s === 'medium' || s === 'low') {
      return $_(`tools.common.severity.${s}`);
    }
    return s;
  }

  function statusIcon(status: string): string {
    if (status === 'good') return '✓';
    if (status === 'warn') return '~';
    return '✗';
  }

  function statusColor(status: string): string {
    if (status === 'good') return '#22c55e';
    if (status === 'warn') return '#f59e0b';
    return '#ef4444';
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    runAudit();
  }

  // The static explainer below the tool is the page's own GEO: question-shaped headings whose
  // answers stand alone, and the FAQPage markup generated from those SAME strings — so the data a
  // model reads can never drift from the text a human reads.
  const FAQ_IDS = ['geo-vs-seo', 'proves-citation', 'where-ai-reads', 'product-offer', 'llms-txt', 'what-moves-citation'];
  const LAYER_IDS = ['crawled', 'feeds', 'live'];
  const faqEntries = $derived(
    FAQ_IDS.map((id) => ({ q: $_(`tools.geo-audit.faq.${id}.q`), a: $_(`tools.geo-audit.faq.${id}.a`) }))
  );

  const signalLabel = $derived((id: string) => $_(`tools.geo-audit.offer.signals.${id}`));
</script>

<svelte:head>
  <title>{$_('tools.geo-audit.meta.title')}</title>
  <meta name="description" content={$_('tools.geo-audit.meta.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('tools.geo-audit.meta.ogTitle')} />
  <meta property="og:description" content={$_('tools.geo-audit.meta.ogDescription')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={$_('tools.geo-audit.meta.twitterTitle')} />
  <meta name="twitter:description" content={$_('tools.geo-audit.meta.twitterDescription')} />
  {@html `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: $_('tools.geo-audit.meta.schemaName'),
    url: `${$page.url.origin}${lp('/tools/geo-audit')}`,
    description: $_('tools.geo-audit.meta.schemaDescription'),
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    provider: { '@type': 'Organization', name: 'Anomalia', url: 'https://anomalia.so' }
  })}</script>`}
  {@html `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqEntries.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a }
    }))
  })}</script>`}
</svelte:head>

<SiteNav cta={$_('tools.common.navCta')} />

<main>
  <!-- Hero -->
  <section class="geo-hero">
    <div class="wrap">
      <span class="eyebrow">{$_('tools.common.eyebrow')}</span>
      <h1>{$_('tools.geo-audit.hero.title')}</h1>
      <p class="subhead">{$_('tools.geo-audit.hero.subhead')}<br />{$_('tools.geo-audit.hero.subheadLine2')}</p>

      <form onsubmit={handleSubmit} class="audit-form">
        <div class="input-row">
          <input
            type="text"
            bind:value={url}
            placeholder={$_('tools.common.urlPlaceholder')}
            required
            disabled={loading}
          />
          <button type="submit" class="btn btn-primary" disabled={loading || !url.trim()}>
            {#if loading}
              <span class="spinner"></span> {$_('tools.geo-audit.form.loading')}
            {:else}
              {$_('tools.geo-audit.form.submit')}
            {/if}
          </button>
        </div>
      </form>

      {#if error}
        <p class="error-msg">{error}</p>
      {/if}
    </div>
  </section>

  <!-- Results -->
  {#if audit}
    <section class="geo-results">
      <div class="wrap">
        <!-- Score Card -->
        <div class="score-card">
          <div class="score-circle" style="--color: {scoreColor(audit.score)}">
            <span class="score-num">{audit.score}</span>
            <span class="score-max">/100</span>
          </div>
          <div class="score-info">
            <h2 style="color: {scoreColor(audit.score)}">{scoreLabel(audit.score)}</h2>
            <p class="score-sub">{$_('tools.geo-audit.score.forUrl', { values: { url } })}</p>
            {#if audit.responseMs}
              <p class="response-time">{$_('tools.geo-audit.score.loadedIn', { values: { ms: audit.responseMs } })}</p>
            {/if}
          </div>
        </div>

        <!-- Issues -->
        {#if audit.issues.length > 0}
          <div class="result-section">
            <h3>{$_('tools.geo-audit.issues.title', { values: { count: audit.issues.length } })}</h3>
            <div class="issues-list">
              {#each audit.issues as issue}
                <div class="issue-card">
                  <div class="issue-header">
                    <span class="severity-badge" style="background: {severityColor(issue.severity)}">
                      {severityLabel(issue.severity)}
                    </span>
                    <h4>{issue.title}</h4>
                  </div>
                  <p class="issue-detail">{issue.detail}</p>
                  <p class="issue-fix"><strong>{$_('tools.common.fixLabel')}</strong> {issue.fix}</p>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- AI Crawlers -->
        <div class="result-section">
          <h3>{$_('tools.geo-audit.crawlers.title')}</h3>
          <p class="section-desc">{$_('tools.geo-audit.crawlers.desc')}</p>
          <div class="chips-grid">
            {#each audit.aiCrawlers as crawler}
              <div class="chip" class:blocked={crawler.blocked} class:allowed={!crawler.blocked}>
                <span class="chip-status">{crawler.blocked ? '✗' : '✓'}</span>
                {crawler.bot}
              </div>
            {/each}
          </div>
        </div>

        <!-- Content Analysis -->
        {#if audit.content}
          <div class="result-section">
            <h3>{$_('tools.geo-audit.content.title')}</h3>
            <div class="check-grid">
              <div class="check-item">
                <span class="check-label">{$_('tools.geo-audit.content.titleLabel')}</span>
                <span class="check-value">{audit.content.title || $_('tools.common.missing')}</span>
                <span class="check-status" style="color: {statusColor(audit.content.statuses.title)}">{statusIcon(audit.content.statuses.title)}</span>
              </div>
              <div class="check-item">
                <span class="check-label">{$_('tools.geo-audit.content.titleLength')}</span>
                <span class="check-value">{$_('tools.geo-audit.content.chars', { values: { count: audit.content.titleLength } })}</span>
                <span class="check-status" style="color: {statusColor(audit.content.statuses.title)}">{audit.content.titleLength >= 30 && audit.content.titleLength <= 60 ? '✓' : '~'}</span>
              </div>
              <div class="check-item">
                <span class="check-label">{$_('tools.geo-audit.content.metaDescription')}</span>
                <span class="check-value">{audit.content.description ? audit.content.description.slice(0, 80) + $_('tools.common.truncated') : $_('tools.common.missing')}</span>
                <span class="check-status" style="color: {statusColor(audit.content.statuses.description)}">{statusIcon(audit.content.statuses.description)}</span>
              </div>
              <div class="check-item">
                <span class="check-label">{$_('tools.geo-audit.content.h1')}</span>
                <span class="check-value">{audit.content.h1Count}</span>
                <span class="check-status" style="color: {statusColor(audit.content.statuses.h1)}">{statusIcon(audit.content.statuses.h1)}</span>
              </div>
              <div class="check-item">
                <span class="check-label">{$_('tools.geo-audit.content.wordCount')}</span>
                <span class="check-value">{audit.content.wordCount}</span>
                <span class="check-status" style="color: {statusColor(audit.content.statuses.depth)}">{statusIcon(audit.content.statuses.depth)}</span>
              </div>
              <div class="check-item">
                <span class="check-label">{$_('tools.geo-audit.content.textRatio')}</span>
                <span class="check-value">{$_('tools.geo-audit.content.percent', { values: { value: audit.content.textRatio } })}</span>
                <span class="check-status" style="color: {statusColor(audit.content.statuses.ratio)}">{statusIcon(audit.content.statuses.ratio)}</span>
              </div>
              <div class="check-item">
                <span class="check-label">{$_('tools.geo-audit.content.imagesAlt')}</span>
                <span class="check-value">{$_('tools.geo-audit.content.imagesRatio', { values: { shown: audit.content.imagesWithAlt, total: audit.content.imagesTotal } })}</span>
                <span class="check-status" style="color: {statusColor(audit.content.statuses.images)}">{statusIcon(audit.content.statuses.images)}</span>
              </div>
              <div class="check-item">
                <span class="check-label">{$_('tools.geo-audit.content.internalLinks')}</span>
                <span class="check-value">{audit.content.internalLinks}</span>
                <span class="check-status" style="color: {statusColor(audit.content.statuses.links)}">{statusIcon(audit.content.statuses.links)}</span>
              </div>
              <div class="check-item">
                <span class="check-label">{$_('tools.geo-audit.content.qaBlocks')}</span>
                <span class="check-value">{audit.content.qaBlocks}</span>
                <span class="check-status" style="color: {statusColor(audit.content.statuses.qa)}">{statusIcon(audit.content.statuses.qa)}</span>
              </div>
              <div class="check-item">
                <span class="check-label">{$_('tools.geo-audit.content.htmlLang')}</span>
                <span class="check-value">{audit.content.htmlLang || $_('tools.common.missing')}</span>
                <span class="check-status" style="color: {statusColor(audit.content.statuses.lang)}">{statusIcon(audit.content.statuses.lang)}</span>
              </div>
            </div>
          </div>
        {/if}

        <!-- Structured Data -->
        <div class="result-section">
          <h3>{$_('tools.geo-audit.structuredData.title')}</h3>
          {#if audit.structuredDataTypes.length > 0}
            <div class="chips-grid">
              {#each audit.structuredDataTypes as type}
                <div class="chip allowed">{type}</div>
              {/each}
            </div>
          {:else}
            <p class="empty-msg">{$_('tools.geo-audit.structuredData.empty')}</p>
          {/if}
        </div>

        <!-- Offer layer — only for sites the audit judged to be selling -->
        {#if audit.commerce?.isCommerce}
          <div class="result-section">
            <h3>{$_('tools.geo-audit.offer.title')}</h3>
            <p class="section-desc">{$_('tools.geo-audit.offer.desc')}</p>
            <div class="chips-grid">
              <div class="chip" class:allowed={audit.commerce.hasProduct} class:blocked={!audit.commerce.hasProduct}>
                <span class="chip-status">{audit.commerce.hasProduct ? '✓' : '✗'}</span>
                {$_('tools.geo-audit.offer.product')}
              </div>
              <div class="chip" class:allowed={audit.commerce.hasOffer} class:blocked={!audit.commerce.hasOffer}>
                <span class="chip-status">{audit.commerce.hasOffer ? '✓' : '✗'}</span>
                {$_('tools.geo-audit.offer.offer')}
              </div>
              <div class="chip" class:allowed={audit.commerce.hasAggregateRating} class:blocked={!audit.commerce.hasAggregateRating}>
                <span class="chip-status">{audit.commerce.hasAggregateRating ? '✓' : '✗'}</span>
                {$_('tools.geo-audit.offer.rating')}
              </div>
            </div>

            {#if audit.commerce.missingCoreFields?.length}
              <p class="offer-missing">
                {$_('tools.geo-audit.offer.missingCore')}
                <code>{audit.commerce.missingCoreFields.join(', ')}</code>
              </p>
            {:else if audit.commerce.missingActionFields?.length}
              <p class="offer-missing">
                {$_('tools.geo-audit.offer.missingAction')}
                <code>{audit.commerce.missingActionFields.join(', ')}</code>
              </p>
            {:else if audit.commerce.hasOffer}
              <p class="offer-missing ok">{$_('tools.geo-audit.offer.complete')}</p>
            {/if}

            {#if audit.commerce.signals?.length}
              <p class="offer-signals">
                {$_('tools.geo-audit.offer.detectedBy')}
                {audit.commerce.signals.map(signalLabel).join(' · ')}
              </p>
            {/if}
          </div>
        {/if}

        <!-- Meta & Sitemap -->
        <div class="result-section">
          <h3>{$_('tools.geo-audit.technical.title')}</h3>
          <div class="tech-grid">
            <div class="tech-item" class:pass={audit.meta.title} class:fail={!audit.meta.title}>
              <span>{audit.meta.title ? '✓' : '✗'}</span> {$_('tools.geo-audit.technical.titleTag')}
            </div>
            <div class="tech-item" class:pass={audit.meta.description} class:fail={!audit.meta.description}>
              <span>{audit.meta.description ? '✓' : '✗'}</span> {$_('tools.geo-audit.technical.metaDescription')}
            </div>
            <div class="tech-item" class:pass={audit.meta.canonical} class:fail={!audit.meta.canonical}>
              <span>{audit.meta.canonical ? '✓' : '✗'}</span> {$_('tools.geo-audit.technical.canonical')}
            </div>
            <div class="tech-item" class:pass={audit.meta.ogTitle} class:fail={!audit.meta.ogTitle}>
              <span>{audit.meta.ogTitle ? '✓' : '✗'}</span> {$_('tools.geo-audit.technical.ogTitle')}
            </div>
            <div class="tech-item" class:pass={audit.llmsTxt} class:fail={!audit.llmsTxt}>
              <span>{audit.llmsTxt ? '✓' : '✗'}</span> {$_('tools.geo-audit.technical.llmsTxt')}
            </div>
            <div class="tech-item" class:pass={audit.sitemapUrls > 0} class:fail={audit.sitemapUrls === 0}>
              <span>{audit.sitemapUrls > 0 ? '✓' : '✗'}</span> {$_('tools.geo-audit.technical.sitemap', { values: { count: audit.sitemapUrls } })}
            </div>
          </div>
        </div>

        <!-- CTA -->
        <div class="cta-section">
          <h3>{$_('tools.geo-audit.cta.title')}</h3>
          <p>{$_('tools.geo-audit.cta.body')}</p>
          <a href="/start" class="btn btn-primary">{$_('tools.common.cta.tryFree')}</a>
        </div>
      </div>
    </section>
  {/if}

  <!-- What the tool does not measure, and where the numbers come from. Always rendered: it is the
       part of this page worth reading when someone arrives without an URL to test. -->
  <section class="geo-learn">
    <div class="wrap">
      <h2>{$_('tools.geo-audit.layers.title')}</h2>
      <p class="learn-lede">{$_('tools.geo-audit.layers.desc')}</p>
      <div class="layers">
        {#each LAYER_IDS as id (id)}
          <div class="layer">
            <h3>{$_(`tools.geo-audit.layers.${id}.title`)}</h3>
            <p>{$_(`tools.geo-audit.layers.${id}.body`)}</p>
          </div>
        {/each}
      </div>

      <div class="limit">
        <h2>{$_('tools.geo-audit.limit.title')}</h2>
        <p>{$_('tools.geo-audit.limit.body')}</p>
        <p class="limit-weights">{$_('tools.geo-audit.limit.weights')}</p>
      </div>

      <h2 class="faq-title">{$_('tools.geo-audit.faq.title')}</h2>
      <div class="faq">
        {#each faqEntries as entry (entry.q)}
          <div class="faq-item">
            <h3>{entry.q}</h3>
            <p>{entry.a}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  /* Hero */
  .geo-hero {
    padding: 150px 0 120px;
    text-align: center;
    min-height: 40vh;
    display: flex;
    align-items: center;
  }
  .geo-hero h1 {
    font-size: clamp(2.4rem, 4.4vw, 4.1rem);
    font-weight: var(--heading-weight);
    line-height: 1.12;
    letter-spacing: var(--heading-tracking);
    margin: 0 auto;
    max-width: 20ch;
  }
  .geo-hero .subhead {
    font-size: clamp(1.05rem, 1.5vw, 1.25rem);
    font-weight: 400;
    color: var(--ink-soft);
    max-width: 52ch;
    margin: 24px auto 0;
    line-height: 1.45;
    letter-spacing: -0.015em;
  }
  .geo-hero .subhead strong { color: var(--ink); }

  /* Form */
  .audit-form {
    max-width: 560px;
    margin: 36px auto 0;
  }
  .input-row {
    display: flex;
    gap: 10px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 6px;
    transition: border-color 0.2s;
  }
  .input-row:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.1);
  }
  .input-row input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--ink);
    font-size: 1rem;
    padding: 12px 16px;
    outline: none;
    font-family: var(--sans);
  }
  .input-row input::placeholder { color: var(--ink-faint); }
  .input-row button {
    white-space: nowrap;
    padding: 12px 24px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .input-row button:disabled { opacity: 0.6; cursor: not-allowed; }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .error-msg {
    margin-top: 16px;
    color: #ef4444;
    font-size: 0.9rem;
    text-align: center;
  }

  /* Results */
  .geo-results {
    padding: 0 0 120px;
  }
  .geo-results .wrap {
    max-width: 800px;
  }

  .score-card {
    display: flex;
    align-items: center;
    gap: 32px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 32px;
    margin-bottom: 48px;
  }
  .score-circle {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    border: 4px solid var(--color);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .score-num {
    font-size: 2.5rem;
    font-weight: 700;
    color: var(--color);
    line-height: 1;
  }
  .score-max {
    font-size: 0.85rem;
    color: var(--ink-faint);
  }
  .score-info h2 {
    font-size: 1.5rem;
    margin: 0 0 4px;
  }
  .score-sub {
    color: var(--ink-soft);
    font-size: 0.9rem;
    margin: 0;
    word-break: break-all;
  }
  .response-time {
    color: var(--ink-faint);
    font-size: 0.8rem;
    margin: 8px 0 0;
  }

  .result-section {
    margin-bottom: 40px;
  }
  .result-section h3 {
    font-size: 1.15rem;
    color: var(--ink);
    margin: 0 0 12px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .section-desc {
    color: var(--ink-soft);
    font-size: 0.9rem;
    margin: 0 0 16px;
    line-height: 1.5;
  }

  /* Issues */
  .issues-list { display: flex; flex-direction: column; gap: 12px; }
  .issue-card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 20px;
  }
  .issue-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .severity-badge {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 3px 8px;
    border-radius: 6px;
    color: #fff;
    white-space: nowrap;
  }
  .issue-header h4 {
    font-size: 0.95rem;
    color: var(--ink);
    margin: 0;
    font-weight: 600;
  }
  .issue-detail {
    color: var(--ink-soft);
    font-size: 0.85rem;
    margin: 0 0 8px;
    line-height: 1.5;
  }
  .issue-fix {
    color: var(--ink-faint);
    font-size: 0.85rem;
    margin: 0;
    line-height: 1.5;
  }
  .issue-fix strong { color: var(--ink-soft); }

  /* Offer layer */
  .offer-missing {
    margin: 14px 0 0;
    font-size: 0.85rem;
    color: var(--ink-soft);
    line-height: 1.5;
  }
  .offer-missing.ok { color: #22c55e; }
  .offer-missing code {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 2px 6px;
    font-size: 0.8rem;
    color: var(--ink);
  }
  .offer-signals {
    margin: 8px 0 0;
    font-size: 0.78rem;
    color: var(--ink-faint);
  }

  /* Static explainer */
  .geo-learn {
    padding: 40px 0 110px;
  }
  .geo-learn .wrap { max-width: 800px; }
  .geo-learn h2 {
    font-size: clamp(1.5rem, 2.4vw, 2rem);
    font-weight: var(--heading-weight);
    color: var(--ink);
    margin: 0 0 12px;
    line-height: 1.2;
  }
  .learn-lede {
    color: var(--ink-soft);
    font-size: 0.95rem;
    line-height: 1.6;
    margin: 0 0 28px;
  }
  .layers {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 18px;
  }
  .layer {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 22px;
  }
  .layer h3 {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--ink);
    margin: 0 0 8px;
  }
  .layer p {
    font-size: 0.85rem;
    color: var(--ink-soft);
    line-height: 1.6;
    margin: 0;
  }
  .limit { margin-top: 64px; }
  .limit p {
    color: var(--ink-soft);
    font-size: 0.95rem;
    line-height: 1.65;
    margin: 0 0 12px;
  }
  .limit-weights {
    font-size: 0.85rem !important;
    color: var(--ink-faint) !important;
    border-left: 2px solid var(--line);
    padding-left: 16px;
  }
  .faq-title { margin-top: 64px !important; }
  .faq {
    border-top: 1px solid var(--line);
    margin-top: 24px;
  }
  .faq-item {
    border-bottom: 1px solid var(--line);
    padding: 22px 0;
  }
  .faq-item h3 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--ink);
    margin: 0 0 8px;
    line-height: 1.4;
  }
  .faq-item p {
    font-size: 0.9rem;
    color: var(--ink-soft);
    line-height: 1.65;
    margin: 0;
  }

  /* Chips */
  .chips-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 8px 14px;
    font-size: 0.85rem;
    color: var(--ink-soft);
    font-weight: 500;
  }
  .chip.blocked {
    border-color: rgba(239,68,68,0.2);
    color: #ef4444;
  }
  .chip.allowed {
    border-color: rgba(34,197,94,0.2);
    color: #22c55e;
  }
  .chip-status { font-weight: 700; }

  /* Check grid */
  .check-grid {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
  }
  .check-item {
    display: grid;
    grid-template-columns: 140px 1fr 32px;
    align-items: center;
    padding: 12px 20px;
    border-bottom: 1px solid var(--line);
    gap: 16px;
  }
  .check-item:last-child { border-bottom: none; }
  .check-label {
    font-size: 0.82rem;
    color: var(--ink-faint);
    font-weight: 500;
  }
  .check-value {
    font-size: 0.85rem;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .check-status {
    font-weight: 700;
    font-size: 0.9rem;
    text-align: center;
  }

  .empty-msg {
    color: var(--ink-faint);
    font-size: 0.9rem;
    font-style: italic;
  }

  /* Tech grid */
  .tech-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px;
  }
  .tech-item {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px 16px;
    font-size: 0.85rem;
    color: var(--ink-soft);
    font-weight: 500;
  }
  .tech-item.pass { color: #22c55e; border-color: rgba(34,197,94,0.15); }
  .tech-item.fail { color: #ef4444; border-color: rgba(239,68,68,0.15); }
  .tech-item span { font-weight: 700; }

  /* CTA */
  .cta-section {
    text-align: center;
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 48px 32px;
    margin-top: 48px;
  }
  .cta-section h3 {
    font-size: 1.5rem;
    color: var(--ink);
    margin: 0 0 12px;
  }
  .cta-section p {
    color: var(--ink-soft);
    font-size: 1rem;
    margin: 0 0 24px;
    max-width: 44ch;
    margin-inline: auto;
    line-height: 1.5;
  }

  @media (max-width: 640px) {
    .geo-hero { padding: 124px 0 60px; }
    .geo-hero h1 { font-size: 1.8rem; max-width: none; white-space: normal !important; overflow-wrap: break-word; word-break: break-word; }
    .score-card { flex-direction: column; text-align: center; gap: 20px; }
    .check-item { grid-template-columns: 100px 1fr 24px; gap: 10px; padding: 10px 14px; }
    .input-row { flex-direction: column; }
    .input-row button { width: 100%; justify-content: center; }
    .geo-learn { padding: 24px 0 70px; }
    .limit, .faq-title { margin-top: 44px !important; }
  }
</style>
