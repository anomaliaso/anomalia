<script lang="ts">
  /**
   * Shared shell for the free tools: SEO head, hero, input form, request handling, error and
   * rate-limit states, and the issue list every tool produces. A tool page supplies its i18n key,
   * its input fields, and a snippet that renders whatever is specific to it.
   *
   * The eight original tool pages each hand-rolled all of this. They are left alone — this exists
   * so the new ones don't repeat it a tenth time.
   */
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import type { Snippet } from 'svelte';
  import '$lib/styles/landing.css';

  type Field = { name: string; type?: string; optional?: boolean };
  type Issue = { severity: 'high' | 'medium' | 'low'; title: string; detail: string };

  let {
    toolKey,
    endpoint,
    fields = [{ name: 'url' }],
    result: resultSnippet,
    intro
  }: {
    toolKey: string;
    endpoint: string;
    fields?: Field[];
    result?: Snippet<[any]>;
    intro?: Snippet;
  } = $props();

  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const t = $derived((k: string, fallback = '') => {
    const full = `tools.${toolKey}.${k}`;
    const v = $_(full);
    // svelte-i18n echoes the key back when a string is missing; don't render that at users.
    return v === full ? fallback : v;
  });

  let values = $state<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.name, ''])));
  let loading = $state(false);
  let error = $state('');
  let rateLimited = $state(false);
  let data = $state<any>(null);

  const canSubmit = $derived(fields.every((f) => f.optional || values[f.name]?.trim()));

  async function run(e: Event) {
    e.preventDefault();
    if (!canSubmit || loading) return;
    loading = true;
    error = '';
    rateLimited = false;
    data = null;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])))
      });
      const body = await res.json();
      if (res.status === 429) {
        rateLimited = true;
        error = body.error || $_('tools.common.errors.generic');
      } else if (!res.ok) {
        error = body.error || $_('tools.common.errors.generic');
      } else {
        data = body.result;
      }
    } catch {
      error = $_('tools.common.errors.network');
    } finally {
      loading = false;
    }
  }

  const issues = $derived((data?.issues ?? []) as Issue[]);
  const sevRank = { high: 0, medium: 1, low: 2 };
  const sortedIssues = $derived([...issues].sort((a, b) => sevRank[a.severity] - sevRank[b.severity]));
</script>

<svelte:head>
  <title>{t('meta.title')}</title>
  <meta name="description" content={t('meta.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <meta property="og:title" content={t('meta.title')} />
  <meta property="og:description" content={t('meta.description')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  {@html `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: t('meta.title'),
    url: `${$page.url.origin}${lp(`/tools/${toolKey}`)}`,
    description: t('meta.description'),
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    provider: { '@type': 'Organization', name: 'Anomalia', url: 'https://anomalia.so' }
  })}</script>`}
</svelte:head>

<SiteNav cta={$_('tools.common.navCta')} />

<main>
  <section class="tp-hero">
    <div class="wrap">
      <span class="eyebrow">{$_('tools.common.eyebrow')}</span>
      <h1>{t('hero.title')}</h1>
      <p class="subhead">{t('hero.subhead')}</p>

      <form onsubmit={run}>
        <div class="input-row">
          {#each fields as f (f.name)}
            <input
              type={f.type ?? 'text'}
              bind:value={values[f.name]}
              placeholder={t(`form.${f.name}`, $_('tools.common.urlPlaceholder'))}
              aria-label={t(`form.${f.name}`, f.name)}
              disabled={loading}
            />
          {/each}
          <button type="submit" class="btn btn-primary" disabled={loading || !canSubmit}>
            {loading ? t('form.loading', '…') : t('form.submit', 'Analyse')}
          </button>
        </div>
        {#if t('form.hint')}<p class="hint">{t('form.hint')}</p>{/if}
      </form>

      {#if error}
        <div class="error-box" class:limit={rateLimited}>
          {error}
          {#if rateLimited}
            <a href={lp('/waitlist')} class="limit-cta">{$_('tools.common.cta.tryFree')}</a>
          {/if}
        </div>
      {/if}

      {#if intro && !data}{@render intro()}{/if}
    </div>
  </section>

  {#if data}
    <section class="tp-results">
      <div class="wrap">
        {#if resultSnippet}{@render resultSnippet(data)}{/if}

        {#if sortedIssues.length}
          <div class="issues">
            <h2>{t('issuesTitle', 'What to fix')}</h2>
            {#each sortedIssues as issue}
              <div class="issue sev-{issue.severity}">
                <div class="issue-head">
                  <span class="sev">{$_(`tools.common.severity.${issue.severity}`)}</span>
                  <h3>{issue.title}</h3>
                </div>
                <p>{issue.detail}</p>
              </div>
            {/each}
          </div>
        {:else}
          <div class="all-clear">{t('allClear', 'No issues found.')}</div>
        {/if}

        <div class="upsell">
          <p>{t('upsell', '')}</p>
          <a href={lp('/waitlist')} class="btn btn-primary">{$_('tools.common.cta.tryFree')}</a>
        </div>
      </div>
    </section>
  {/if}
</main>

<SiteFooter />

<style>
  .tp-hero { padding: 56px 0 20px; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 0 20px; }
  .eyebrow {
    display: inline-block; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--ink-soft); margin-bottom: 12px;
  }
  h1 { font-size: clamp(1.8rem, 4vw, 2.6rem); margin: 0 0 12px; letter-spacing: -0.03em; line-height: 1.15; }
  .subhead { color: var(--ink-soft); font-size: 1.05rem; line-height: 1.5; margin: 0 0 28px; }
  .input-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .input-row input {
    flex: 1; min-width: 220px; padding: 14px 16px; border: 1px solid var(--line);
    border-radius: 12px; font-size: 1rem; background: var(--paper);
  }
  .hint { margin: 10px 0 0; font-size: 0.85rem; color: var(--ink-faint); }
  .error-box {
    background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca;
    border-radius: 12px; padding: 12px 16px; margin-top: 16px;
  }
  .error-box.limit { background: #fffbeb; color: #92400e; border-color: #fde68a; }
  .limit-cta { display: inline-block; margin-left: 8px; font-weight: 600; color: inherit; }
  .tp-results { padding: 20px 0 80px; }
  .issues { margin-top: 28px; }
  .issues h2 { font-size: 1.25rem; margin: 0 0 14px; }
  .issue {
    background: var(--paper); border: 1px solid var(--line); border-left-width: 3px;
    border-radius: 12px; padding: 16px 18px; margin-bottom: 12px;
  }
  .issue.sev-high { border-left-color: #dc2626; }
  .issue.sev-medium { border-left-color: #d97706; }
  .issue.sev-low { border-left-color: #64748b; }
  .issue-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .issue-head h3 { margin: 0; font-size: 1rem; }
  .sev {
    font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    padding: 2px 8px; border-radius: 999px; background: var(--wash); color: var(--ink-soft);
  }
  .issue p { margin: 8px 0 0; color: var(--ink-soft); line-height: 1.5; font-size: 0.94rem; }
  .all-clear {
    background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534;
    border-radius: 12px; padding: 16px 18px; margin-top: 24px;
  }
  .upsell {
    margin-top: 36px; padding: 24px; border: 1px solid var(--line);
    border-radius: 16px; background: var(--wash); text-align: center;
  }
  .upsell p { margin: 0 0 14px; color: var(--ink-soft); line-height: 1.5; }
  @media (max-width: 600px) {
    .input-row input, .input-row :global(button) { width: 100%; flex: none; }
  }
</style>
