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
  let analysis = $state<any>(null);

  async function analyze() {
    if (!url.trim()) return;
    loading = true;
    error = '';
    analysis = null;

    try {
      let inputUrl = url.trim();
      if (!/^https?:\/\//i.test(inputUrl)) inputUrl = `https://${inputUrl}`;

      const res = await fetch('/api/tools/sitemap-analyzer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: inputUrl })
      });
      const data = await res.json();
      if (!res.ok) {
        error = data.error || $_('tools.common.errors.generic');
      } else {
        analysis = data.analysis;
      }
    } catch {
      error = $_('tools.common.errors.network');
    } finally {
      loading = false;
    }
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

  function scoreColor(issues: any[]): string {
    const highs = issues.filter(i => i.severity === 'high').length;
    const meds = issues.filter(i => i.severity === 'medium').length;
    if (highs > 0) return '#ef4444';
    if (meds > 2) return '#f59e0b';
    if (meds > 0) return '#f59e0b';
    return '#22c55e';
  }

  function scoreLabel(issues: any[]): string {
    const highs = issues.filter(i => i.severity === 'high').length;
    const meds = issues.filter(i => i.severity === 'medium').length;
    if (highs > 0) return $_('tools.sitemap-analyzer.status.issuesFound');
    if (meds > 0) return $_('tools.sitemap-analyzer.status.warnings');
    return $_('tools.sitemap-analyzer.status.healthy');
  }

  function formatDate(d: string): string {
    try {
      return new Date(d).toLocaleDateString(($locale as string) ?? 'en', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return d;
    }
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    analyze();
  }

  let showAllUrls = $state(false);
  const displayedUrls = $derived(showAllUrls ? analysis?.entries ?? [] : (analysis?.entries ?? []).slice(0, 50));
</script>

<svelte:head>
  <title>{$_('tools.sitemap-analyzer.meta.title')}</title>
  <meta name="description" content={$_('tools.sitemap-analyzer.meta.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('tools.sitemap-analyzer.meta.ogTitle')} />
  <meta property="og:description" content={$_('tools.sitemap-analyzer.meta.ogDescription')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={$_('tools.sitemap-analyzer.meta.twitterTitle')} />
  <meta name="twitter:description" content={$_('tools.sitemap-analyzer.meta.twitterDescription')} />
  {@html `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: $_('tools.sitemap-analyzer.meta.schemaName'),
    url: `${$page.url.origin}${lp('/tools/sitemap-analyzer')}`,
    description: $_('tools.sitemap-analyzer.meta.schemaDescription'),
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    provider: { '@type': 'Organization', name: 'Anomalia', url: 'https://anomalia.so' }
  })}</script>`}
</svelte:head>

<SiteNav cta={$_('tools.common.navCta')} />

<main>
  <!-- Hero -->
  <section class="sm-hero">
    <div class="wrap">
      <span class="eyebrow">{$_('tools.common.eyebrow')}</span>
      <h1>{$_('tools.sitemap-analyzer.hero.title')}</h1>
      <p class="subhead">{$_('tools.sitemap-analyzer.hero.subhead')}<br />{$_('tools.sitemap-analyzer.hero.subheadLine2')}</p>

      <form onsubmit={handleSubmit} class="tool-form">
        <div class="input-row">
          <input type="text" bind:value={url} placeholder={$_('tools.common.urlPlaceholder')} required disabled={loading} />
          <button type="submit" class="btn btn-primary" disabled={loading || !url.trim()}>
            {#if loading}
              <span class="spinner"></span> {$_('tools.sitemap-analyzer.form.loading')}
            {:else}
              {$_('tools.sitemap-analyzer.form.submit')}
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
  {#if analysis}
    <section class="sm-results">
      <div class="wrap">

        <!-- Status Card -->
        <div class="status-card" style="border-left: 4px solid {scoreColor(analysis.issues)}">
          <div class="status-left">
            <h2 style="color: {scoreColor(analysis.issues)}">{scoreLabel(analysis.issues)}</h2>
            <p class="status-url">{analysis.url}</p>
            {#if analysis.found}
              <p class="status-detail">
                {$_('tools.sitemap-analyzer.status.urlsFound', { values: { count: analysis.totalUrls.toLocaleString() } })}
                {#if analysis.isIndex} · {$_('tools.sitemap-analyzer.status.indexDetail', { values: { count: analysis.childSitemaps.length } })}{/if}
                · {$_('tools.sitemap-analyzer.status.size', { values: { size: analysis.sizeKB } })}
              </p>
            {/if}
          </div>
          <div class="status-badge" style="background: {scoreColor(analysis.issues)}">
            {$_('tools.sitemap-analyzer.status.errorsWarnings', {
              values: {
                errors: analysis.issues.filter((i: any) => i.severity === 'high').length,
                warnings: analysis.issues.filter((i: any) => i.severity === 'medium').length
              }
            })}
          </div>
        </div>

        <!-- Issues -->
        {#if analysis.issues.length > 0}
          <div class="result-section">
            <h3>{$_('tools.sitemap-analyzer.issues.title', { values: { count: analysis.issues.length } })}</h3>
            <div class="issues-list">
              {#each analysis.issues as issue}
                <div class="issue-card">
                  <div class="issue-header">
                    <span class="severity-badge" style="background: {severityColor(issue.severity)}">
                      {severityLabel(issue.severity)}
                    </span>
                    <h4>{issue.title}</h4>
                  </div>
                  <p class="issue-detail">{issue.detail}</p>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Stats Grid -->
        {#if analysis.found && analysis.totalUrls > 0}
          <div class="result-section">
            <h3>{$_('tools.sitemap-analyzer.stats.title')}</h3>
            <div class="stats-grid">
              <div class="stat-card">
                <span class="stat-num">{analysis.totalUrls.toLocaleString()}</span>
                <span class="stat-label">{$_('tools.sitemap-analyzer.stats.totalUrls')}</span>
              </div>
              <div class="stat-card">
                <span class="stat-num">{analysis.stats.withLastmod}</span>
                <span class="stat-label">{$_('tools.sitemap-analyzer.stats.withLastmod')}</span>
              </div>
              <div class="stat-card">
                <span class="stat-num">{analysis.stats.withChangefreq}</span>
                <span class="stat-label">{$_('tools.sitemap-analyzer.stats.withChangefreq')}</span>
              </div>
              <div class="stat-card">
                <span class="stat-num">{analysis.stats.withPriority}</span>
                <span class="stat-label">{$_('tools.sitemap-analyzer.stats.withPriority')}</span>
              </div>
              <div class="stat-card">
                <span class="stat-num">{analysis.stats.avgPriority}</span>
                <span class="stat-label">{$_('tools.sitemap-analyzer.stats.avgPriority')}</span>
              </div>
              <div class="stat-card">
                <span class="stat-num">{analysis.stats.withImages}</span>
                <span class="stat-label">{$_('tools.sitemap-analyzer.stats.withImages')}</span>
              </div>
            </div>
          </div>

          <!-- Date Range -->
          {#if analysis.stats.lastmodRange}
            <div class="result-section">
              <h3>{$_('tools.sitemap-analyzer.dateRange.title')}</h3>
              <div class="date-range">
                <div class="date-card">
                  <span class="date-label">{$_('tools.sitemap-analyzer.dateRange.oldest')}</span>
                  <span class="date-val">{formatDate(analysis.stats.lastmodRange.oldest)}</span>
                </div>
                <div class="date-arrow">→</div>
                <div class="date-card">
                  <span class="date-label">{$_('tools.sitemap-analyzer.dateRange.newest')}</span>
                  <span class="date-val">{formatDate(analysis.stats.lastmodRange.newest)}</span>
                </div>
              </div>
            </div>
          {/if}

          <!-- Change Frequency Distribution -->
          {#if Object.keys(analysis.stats.changefreqDistribution).length > 0}
            <div class="result-section">
              <h3>{$_('tools.sitemap-analyzer.changefreq.title')}</h3>
              <div class="freq-bars">
                {#each Object.entries(analysis.stats.changefreqDistribution).sort(([,a], [,b]) => (b as number) - (a as number)) as [freq, count]}
                  {@const pct = Math.round(((count as number) / analysis.stats.withChangefreq) * 100)}
                  <div class="freq-row">
                    <span class="freq-label">{freq}</span>
                    <div class="freq-bar-track">
                      <div class="freq-bar-fill" style="width: {pct}%"></div>
                    </div>
                    <span class="freq-count">{count as number}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- URL Structure -->
          {#if analysis.structure.length > 0}
            <div class="result-section">
              <h3>{$_('tools.sitemap-analyzer.structure.title')}</h3>
              <p class="section-desc">{$_('tools.sitemap-analyzer.structure.desc')}</p>
              <div class="structure-bars">
                {#each analysis.structure as item}
                  {@const pct = Math.round((item.count / analysis.totalUrls) * 100)}
                  <div class="struct-row">
                    <span class="struct-path">{item.path}</span>
                    <div class="struct-bar-track">
                      <div class="struct-bar-fill" style="width: {pct}%"></div>
                    </div>
                    <span class="struct-count">{item.count} <span class="struct-pct">({pct}%)</span></span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- URL List -->
          <div class="result-section">
            <div class="url-header">
              <h3>
                {#if analysis.entries.length !== analysis.totalUrls}
                  {$_('tools.sitemap-analyzer.urls.titleOf', { values: { shown: analysis.entries.length, total: analysis.totalUrls.toLocaleString() } })}
                {:else}
                  {$_('tools.sitemap-analyzer.urls.title', { values: { shown: analysis.entries.length } })}
                {/if}
              </h3>
              {#if analysis.entries.length > 50}
                <button class="btn-toggle" onclick={() => showAllUrls = !showAllUrls}>
                  {showAllUrls
                    ? $_('tools.sitemap-analyzer.urls.showLess')
                    : $_('tools.sitemap-analyzer.urls.showAll', { values: { count: analysis.entries.length } })}
                </button>
              {/if}
            </div>
            <div class="url-table">
              <div class="url-row url-row-head">
                <span class="url-col-url">{$_('tools.sitemap-analyzer.urls.colUrl')}</span>
                <span class="url-col-date">{$_('tools.sitemap-analyzer.urls.colLastmod')}</span>
                <span class="url-col-freq">{$_('tools.sitemap-analyzer.urls.colFreq')}</span>
                <span class="url-col-pri">{$_('tools.sitemap-analyzer.urls.colPriority')}</span>
              </div>
              {#each displayedUrls as entry}
                <div class="url-row">
                  <span class="url-col-url" title={entry.loc}>
                    <a href={entry.loc} target="_blank" rel="noopener">{entry.loc.replace(/^https?:\/\/[^/]+/, '')}</a>
                  </span>
                  <span class="url-col-date">{entry.lastmod ? formatDate(entry.lastmod) : '—'}</span>
                  <span class="url-col-freq">{entry.changefreq || '—'}</span>
                  <span class="url-col-pri">{entry.priority || '—'}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- CTA -->
        <div class="cta-section">
          <h3>{$_('tools.sitemap-analyzer.cta.title')}</h3>
          <p>{$_('tools.sitemap-analyzer.cta.body')}</p>
          <a href="/start" class="btn btn-primary">{$_('tools.common.cta.tryFree')}</a>
        </div>
      </div>
    </section>
  {/if}
</main>

<SiteFooter />

<style>
  /* Hero */
  .sm-hero {
    padding: 150px 0 120px;
    text-align: center;
    min-height: 40vh;
    display: flex;
    align-items: center;
  }
  .sm-hero h1 {
    font-size: clamp(2.4rem, 4.4vw, 4.1rem);
    font-weight: var(--heading-weight);
    line-height: 1.12;
    letter-spacing: var(--heading-tracking);
    margin: 0 auto;
    max-width: 20ch;
  }
  .sm-hero .subhead {
    font-size: clamp(1.05rem, 1.5vw, 1.25rem);
    font-weight: 400;
    color: var(--ink-soft);
    max-width: 52ch;
    margin: 24px auto 0;
    line-height: 1.45;
    letter-spacing: -0.015em;
  }
  .sm-hero .subhead strong { color: var(--ink); }

  /* Form */
  .tool-form {
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
    width: 16px; height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .error-msg { margin-top: 16px; color: #ef4444; font-size: 0.9rem; text-align: center; }

  /* Results */
  .sm-results { padding: 0 0 120px; }
  .sm-results .wrap { max-width: 860px; }

  .status-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 28px;
    margin-bottom: 40px;
  }
  .status-left h2 { font-size: 1.4rem; margin: 0 0 4px; }
  .status-url { color: var(--ink-faint); font-size: 0.82rem; margin: 0; word-break: break-all; font-family: var(--mono, monospace); }
  .status-detail { color: var(--ink-soft); font-size: 0.88rem; margin: 6px 0 0; }
  .status-badge {
    flex-shrink: 0;
    color: #fff;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 8px 16px;
    border-radius: 10px;
    white-space: nowrap;
  }

  .result-section { margin-bottom: 40px; }
  .result-section h3 {
    font-size: 1.15rem;
    color: var(--ink);
    margin: 0 0 12px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .section-desc { color: var(--ink-soft); font-size: 0.9rem; margin: 0 0 16px; }

  /* Issues */
  .issues-list { display: flex; flex-direction: column; gap: 12px; }
  .issue-card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 20px;
  }
  .issue-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .severity-badge {
    font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.04em; padding: 3px 8px; border-radius: 6px; color: #fff; white-space: nowrap;
  }
  .issue-header h4 { font-size: 0.95rem; color: var(--ink); margin: 0; font-weight: 600; }
  .issue-detail { color: var(--ink-soft); font-size: 0.85rem; margin: 0; line-height: 1.5; }

  /* Stats Grid */
  .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .stat-card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 20px;
    text-align: center;
  }
  .stat-num { display: block; font-size: 1.8rem; font-weight: 700; color: var(--accent); line-height: 1; }
  .stat-label { display: block; font-size: 0.78rem; color: var(--ink-faint); font-weight: 500; margin-top: 6px; }

  /* Date Range */
  .date-range { display: flex; align-items: center; gap: 16px; }
  .date-card {
    flex: 1;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px 20px;
    text-align: center;
  }
  .date-label { display: block; font-size: 0.75rem; color: var(--ink-faint); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .date-val { display: block; font-size: 1.1rem; font-weight: 600; color: var(--ink); margin-top: 4px; }
  .date-arrow { font-size: 1.2rem; color: var(--accent); font-weight: 700; }

  /* Frequency bars */
  .freq-bars { display: flex; flex-direction: column; gap: 8px; }
  .freq-row { display: grid; grid-template-columns: 80px 1fr 50px; align-items: center; gap: 12px; }
  .freq-label { font-size: 0.82rem; font-weight: 600; color: var(--ink-soft); }
  .freq-bar-track { height: 8px; background: var(--paper-2); border-radius: 4px; overflow: hidden; }
  .freq-bar-fill { height: 100%; background: var(--accent); border-radius: 4px; transition: width .5s var(--ease); }
  .freq-count { font-size: 0.82rem; font-weight: 600; color: var(--ink-faint); text-align: right; }

  /* Structure bars */
  .structure-bars { display: flex; flex-direction: column; gap: 8px; }
  .struct-row { display: grid; grid-template-columns: 140px 1fr 80px; align-items: center; gap: 12px; }
  .struct-path { font-size: 0.82rem; font-weight: 600; color: var(--ink); font-family: var(--mono, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .struct-bar-track { height: 8px; background: var(--paper-2); border-radius: 4px; overflow: hidden; }
  .struct-bar-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); border-radius: 4px; transition: width .5s var(--ease); }
  .struct-count { font-size: 0.82rem; font-weight: 600; color: var(--ink-soft); text-align: right; }
  .struct-pct { color: var(--ink-faint); font-weight: 400; }

  /* URL Table */
  .url-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .url-header h3 { margin: 0; }
  .btn-toggle {
    background: none; border: 1px solid var(--line); border-radius: 8px;
    padding: 6px 14px; font-size: 0.8rem; font-weight: 600; color: var(--ink-soft);
    cursor: pointer; transition: background .2s;
  }
  .btn-toggle:hover { background: var(--paper-2); }

  .url-table {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
  }
  .url-row {
    display: grid;
    grid-template-columns: 1fr 130px 80px 60px;
    align-items: center;
    padding: 10px 16px;
    border-bottom: 1px solid var(--line);
    gap: 12px;
  }
  .url-row:last-child { border-bottom: none; }
  .url-row-head {
    background: var(--paper-2);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-faint);
    padding: 10px 16px;
  }
  .url-col-url {
    font-size: 0.82rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .url-col-url a { color: var(--ink); text-decoration: none; }
  .url-col-url a:hover { color: var(--accent); text-decoration: underline; }
  .url-col-date, .url-col-freq, .url-col-pri { font-size: 0.78rem; color: var(--ink-faint); }

  /* CTA */
  .cta-section {
    text-align: center;
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 48px 32px;
    margin-top: 48px;
  }
  .cta-section h3 { font-size: 1.5rem; color: var(--ink); margin: 0 0 12px; }
  .cta-section p { color: var(--ink-soft); font-size: 1rem; margin: 0 0 24px; max-width: 44ch; margin-inline: auto; line-height: 1.5; }

  @media (max-width: 640px) {
    .sm-hero { padding: 124px 0 60px; }
    .sm-hero h1 { font-size: 1.8rem; max-width: none; white-space: normal !important; overflow-wrap: break-word; word-break: break-word; }
    .status-card { flex-direction: column; text-align: center; gap: 16px; }
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
    .input-row { flex-direction: column; }
    .input-row button { width: 100%; justify-content: center; }
    .url-row { grid-template-columns: 1fr; gap: 4px; }
    .url-row-head { display: none; }
    .url-col-date, .url-col-freq, .url-col-pri { font-size: 0.72rem; }
    .struct-row { grid-template-columns: 100px 1fr 60px; }
    .freq-row { grid-template-columns: 60px 1fr 40px; }
    .date-range { flex-direction: column; }
    .date-arrow { transform: rotate(90deg); }
  }
</style>
