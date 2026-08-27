<script lang="ts">
  import { get } from 'svelte/store';
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import '$lib/styles/landing.css';

  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  let siteUrl = $state('');
  let loading = $state(false);
  let error = $state('');
  let result = $state<{ llmsTxt: string; siteName: string; pagesCount: number } | null>(null);

  async function generate() {
    if (!siteUrl.trim()) return;
    loading = true;
    error = '';
    result = null;

    try {
      let url = siteUrl.trim();
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

      const res = await fetch('/api/tools/llms-txt-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      if (!res.ok) {
        error = data.error || get(_)('tools.common.errors.generic');
      } else {
        result = data;
      }
    } catch {
      error = get(_)('tools.common.errors.network');
    } finally {
      loading = false;
    }
  }

  function copyToClipboard() {
    if (result) {
      navigator.clipboard.writeText(result.llmsTxt);
    }
  }

  function downloadFile() {
    if (!result) return;
    const blob = new Blob([result.llmsTxt], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'llms.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    generate();
  }
</script>

<svelte:head>
  <title>{$_('tools.llms-txt-generator.meta.title')}</title>
  <meta name="description" content={$_('tools.llms-txt-generator.meta.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('tools.llms-txt-generator.meta.ogTitle')} />
  <meta property="og:description" content={$_('tools.llms-txt-generator.meta.ogDescription')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={$_('tools.llms-txt-generator.meta.twitterTitle')} />
  <meta name="twitter:description" content={$_('tools.llms-txt-generator.meta.twitterDescription')} />
</svelte:head>

<SiteNav cta={$_('tools.common.navCta')} />

<main>
  <section class="tool-hero">
    <div class="wrap">
      <span class="eyebrow">{$_('tools.common.eyebrow')}</span>
      <h1>{$_('tools.llms-txt-generator.hero.title')}</h1>
      <p class="subhead">{$_('tools.llms-txt-generator.hero.subhead')}</p>

      <form onsubmit={handleSubmit} class="tool-form">
        <div class="input-row">
          <input type="text" bind:value={siteUrl} placeholder={$_('tools.common.urlPlaceholder')} required disabled={loading} />
          <button type="submit" class="btn btn-primary" disabled={loading || !siteUrl.trim()}>
            {#if loading}
              <span class="spinner"></span> {$_('tools.llms-txt-generator.form.loading')}
            {:else}
              {$_('tools.llms-txt-generator.form.submit')}
            {/if}
          </button>
        </div>
      </form>

      {#if error}
        <p class="error-msg">{error}</p>
      {/if}
    </div>
  </section>

  {#if result}
    <section class="tool-body">
      <div class="wrap">
        <div class="result-block">
          <div class="result-header">
            <h3>{$_('tools.llms-txt-generator.result.title')}</h3>
            <div class="result-actions">
              <button onclick={copyToClipboard} class="btn btn-ghost-sm">{$_('tools.llms-txt-generator.result.copy')}</button>
              <button onclick={downloadFile} class="btn btn-primary-sm">{$_('tools.llms-txt-generator.result.download')}</button>
            </div>
          </div>

          {#if result.pagesCount > 0}
            <div class="stats-row">
              <div class="stat-chip">
                <span class="stat-num">{result.pagesCount}</span>
                <span class="stat-label">{$_('tools.llms-txt-generator.result.pagesFound')}</span>
              </div>
            </div>
          {/if}

          <div class="code-output">{result.llmsTxt}</div>
        </div>

        <div class="info-cards">
          <div class="info-card">
            <h4>{$_('tools.llms-txt-generator.info.whatTitle')}</h4>
            <p>{$_('tools.llms-txt-generator.info.whatBody')}</p>
          </div>
          <div class="info-card">
            <h4>{$_('tools.llms-txt-generator.info.howTitle')}</h4>
            <p>{$_('tools.llms-txt-generator.info.howBody')}</p>
          </div>
          <div class="info-card">
            <h4>{$_('tools.llms-txt-generator.info.whyTitle')}</h4>
            <p>{$_('tools.llms-txt-generator.info.whyBody')}</p>
          </div>
        </div>

        <div class="cta-section">
          <h3>{$_('tools.llms-txt-generator.cta.title')}</h3>
          <p>{$_('tools.llms-txt-generator.cta.body')}</p>
          <a href="/start" class="btn btn-primary">{$_('tools.common.cta.tryFree')}</a>
        </div>
      </div>
    </section>
  {/if}
</main>

<SiteFooter />

<style>
  .tool-hero {
    padding: 150px 0 80px;
    text-align: center;
    min-height: 50vh;
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
    max-width: 52ch;
    margin: 24px auto 0;
    line-height: 1.45;
  }
  .tool-hero .subhead strong { color: var(--ink); }

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
  .input-row button { white-space: nowrap; padding: 12px 24px; display: flex; align-items: center; gap: 8px; }
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

  .tool-body { padding: 0 0 120px; }

  .result-block {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 28px;
    margin-bottom: 40px;
  }
  .result-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }
  .result-header h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--ink);
    margin: 0;
  }
  .result-actions { display: flex; gap: 8px; }

  .stats-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
  }
  .stat-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 6px 12px;
  }
  .stat-num {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--accent);
  }
  .stat-label {
    font-size: 0.75rem;
    color: var(--ink-faint);
    font-weight: 500;
  }

  .btn-ghost-sm {
    background: transparent;
    border: 1px solid var(--line);
    color: var(--ink);
    padding: 8px 16px;
    border-radius: 10px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }
  .btn-ghost-sm:hover { background: var(--paper-2); }
  .btn-primary-sm {
    background: var(--accent);
    border: none;
    color: #fff;
    padding: 8px 16px;
    border-radius: 10px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .btn-primary-sm:hover { opacity: 0.9; }

  .code-output {
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 20px;
    font-family: var(--mono, 'SF Mono', 'Fira Code', monospace);
    font-size: 0.82rem;
    color: var(--ink);
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .info-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    margin-bottom: 40px;
  }
  .info-card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 24px;
  }
  .info-card h4 {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--ink);
    margin: 0 0 8px;
  }
  .info-card p {
    font-size: 0.85rem;
    color: var(--ink-soft);
    line-height: 1.5;
    margin: 0;
  }
  .info-card code {
    background: var(--paper-2);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.8rem;
  }

  .cta-section {
    text-align: center;
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 48px 32px;
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
    max-width: 48ch;
    margin-inline: auto;
    line-height: 1.5;
  }

  @media (max-width: 820px) {
    .tool-hero { padding: 124px 0 60px; }
    .tool-hero h1 { font-size: 1.8rem; max-width: none; white-space: normal !important; overflow-wrap: break-word; word-break: break-word; }
    .info-cards { grid-template-columns: 1fr; }
    .input-row { flex-direction: column; }
    .input-row button { width: 100%; justify-content: center; }
  }
</style>
