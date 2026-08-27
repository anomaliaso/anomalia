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
  let result = $state<{ valid: boolean; exists: boolean; issues: string[]; suggestions: string[]; content: string | null } | null>(null);

  async function validate() {
    if (!siteUrl.trim()) return;
    loading = true;
    error = '';
    result = null;

    try {
      let url = siteUrl.trim();
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

      const res = await fetch('/api/tools/llms-txt-validator', {
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

  function handleSubmit(e: Event) {
    e.preventDefault();
    validate();
  }
</script>

<svelte:head>
  <title>{$_('tools.llms-txt-validator.meta.title')}</title>
  <meta name="description" content={$_('tools.llms-txt-validator.meta.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('tools.llms-txt-validator.meta.ogTitle')} />
  <meta property="og:description" content={$_('tools.llms-txt-validator.meta.ogDescription')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={$_('tools.llms-txt-validator.meta.twitterTitle')} />
  <meta name="twitter:description" content={$_('tools.llms-txt-validator.meta.twitterDescription')} />
</svelte:head>

<SiteNav cta={$_('tools.common.navCta')} />

<main>
  <section class="tool-hero">
    <div class="wrap">
      <span class="eyebrow">{$_('tools.common.eyebrow')}</span>
      <h1>{$_('tools.llms-txt-validator.hero.title')}</h1>
      <p class="subhead">{$_('tools.llms-txt-validator.hero.subhead')}</p>

      <form onsubmit={handleSubmit} class="tool-form">
        <div class="input-row">
          <input type="text" bind:value={siteUrl} placeholder={$_('tools.common.urlPlaceholder')} required disabled={loading} />
          <button type="submit" class="btn btn-primary" disabled={loading || !siteUrl.trim()}>
            {#if loading}
              <span class="spinner"></span> {$_('tools.llms-txt-validator.form.loading')}
            {:else}
              {$_('tools.llms-txt-validator.form.submit')}
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
        <!-- Status -->
        <div class="status-card" class:pass={result.valid && result.exists} class:warn={result.exists && !result.valid} class:fail={!result.exists}>
          <span class="status-icon">{result.valid && result.exists ? '✓' : result.exists ? '~' : '✗'}</span>
          <div>
            <h3>{result.valid && result.exists ? $_('tools.llms-txt-validator.status.validTitle') : result.exists ? $_('tools.llms-txt-validator.status.issuesTitle') : $_('tools.llms-txt-validator.status.missingTitle')}</h3>
            <p>{result.valid && result.exists ? $_('tools.llms-txt-validator.status.validBody') : result.exists ? $_('tools.llms-txt-validator.status.issuesBody') : $_('tools.llms-txt-validator.status.missingBody')}</p>
          </div>
        </div>

        <!-- Issues -->
        {#if result.issues.length > 0}
          <div class="result-section">
            <h3>{$_('tools.llms-txt-validator.issues.title', { values: { count: result.issues.length } })}</h3>
            <div class="issues-list">
              {#each result.issues as issue}
                <div class="issue-item fail">
                  <span>✗</span> {issue}
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Suggestions -->
        {#if result.suggestions.length > 0}
          <div class="result-section">
            <h3>{$_('tools.llms-txt-validator.suggestions.title')}</h3>
            <div class="issues-list">
              {#each result.suggestions as suggestion}
                <div class="issue-item warn">
                  <span>→</span> {suggestion}
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Content preview -->
        {#if result.content}
          <div class="result-section">
            <h3>{$_('tools.llms-txt-validator.preview.title')}</h3>
            <pre class="code-block">{result.content.slice(0, 1000)}{result.content.length > 1000 ? '\n' + $_('tools.common.truncated') : ''}</pre>
          </div>
        {/if}

        <!-- CTA -->
        <div class="cta-section">
          <h3>{$_('tools.llms-txt-validator.cta.title')}</h3>
          <a href={lp('/tools/llms-txt-generator')} class="btn btn-primary">{$_('tools.llms-txt-validator.cta.button')}</a>
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
    max-width: 48ch;
    margin: 24px auto 0;
    line-height: 1.45;
  }
  .tool-hero .subhead strong { color: var(--ink); }

  .tool-form { max-width: 560px; margin: 36px auto 0; }
  .input-row {
    display: flex; gap: 10px;
    background: var(--paper); border: 1px solid var(--line);
    border-radius: 16px; padding: 6px; transition: border-color 0.2s;
  }
  .input-row:focus-within { border-color: var(--accent); box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.1); }
  .input-row input {
    flex: 1; background: transparent; border: none; color: var(--ink);
    font-size: 1rem; padding: 12px 16px; outline: none; font-family: var(--sans);
  }
  .input-row input::placeholder { color: var(--ink-faint); }
  .input-row button { white-space: nowrap; padding: 12px 24px; display: flex; align-items: center; gap: 8px; }
  .input-row button:disabled { opacity: 0.6; cursor: not-allowed; }

  .spinner {
    width: 16px; height: 16px;
    border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff;
    border-radius: 50%; animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .error-msg { margin-top: 16px; color: #ef4444; font-size: 0.9rem; text-align: center; }

  .tool-body { padding: 0 0 120px; }

  .status-card {
    display: flex; align-items: center; gap: 20px;
    background: var(--paper); border: 1px solid var(--line);
    border-radius: 20px; padding: 28px; margin-bottom: 32px;
  }
  .status-card.pass { border-color: rgba(34,197,94,0.3); }
  .status-card.warn { border-color: rgba(245,158,11,0.3); }
  .status-card.fail { border-color: rgba(239,68,68,0.3); }
  .status-icon {
    width: 48px; height: 48px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.5rem; font-weight: 700; flex-shrink: 0;
  }
  .status-card.pass .status-icon { background: rgba(34,197,94,0.1); color: #22c55e; }
  .status-card.warn .status-icon { background: rgba(245,158,11,0.1); color: #f59e0b; }
  .status-card.fail .status-icon { background: rgba(239,68,68,0.1); color: #ef4444; }
  .status-card h3 { font-size: 1.1rem; font-weight: 600; color: var(--ink); margin: 0 0 4px; }
  .status-card p { font-size: 0.9rem; color: var(--ink-soft); margin: 0; line-height: 1.5; }

  .result-section { margin-bottom: 28px; }
  .result-section h3 { font-size: 1rem; font-weight: 600; color: var(--ink); margin: 0 0 12px; }

  .issues-list { display: flex; flex-direction: column; gap: 8px; }
  .issue-item {
    display: flex; align-items: flex-start; gap: 10px;
    background: var(--paper); border: 1px solid var(--line);
    border-radius: 10px; padding: 12px 16px;
    font-size: 0.85rem; color: var(--ink-soft); line-height: 1.5;
  }
  .issue-item.fail { color: #ef4444; border-color: rgba(239,68,68,0.15); }
  .issue-item.fail span { font-weight: 700; }
  .issue-item.warn { color: #f59e0b; border-color: rgba(245,158,11,0.15); }
  .issue-item.warn span { font-weight: 700; }

  .code-block {
    background: var(--paper-2); border: 1px solid var(--line);
    border-radius: 12px; padding: 20px;
    font-family: var(--mono, 'SF Mono', 'Fira Code', monospace);
    font-size: 0.82rem; color: var(--ink); line-height: 1.6;
    overflow-x: auto; white-space: pre-wrap; word-break: break-word;
  }

  .cta-section {
    text-align: center; background: var(--paper-2);
    border: 1px solid var(--line); border-radius: 20px;
    padding: 48px 32px; margin-top: 40px;
  }
  .cta-section h3 { font-size: 1.3rem; color: var(--ink); margin: 0 0 20px; }

  @media (max-width: 768px) {
    .tool-hero { padding: 124px 0 60px; }
    .tool-hero h1 { font-size: 1.8rem; max-width: none; white-space: normal !important; overflow-wrap: break-word; word-break: break-word; }
    .status-card { flex-direction: column; text-align: center; }
    .input-row { flex-direction: column; }
    .input-row button { width: 100%; justify-content: center; }
  }
</style>
