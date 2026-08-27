<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import { _ } from 'svelte-i18n';
  import type { RadarPlatformKey } from '$lib/plans';

  let { data, form } = $props();
  let busy = $state(false);
  const withBusy = () => {
    busy = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy = false;
    };
  };

  const hasProLeads = $derived(Boolean(data.hasProRadarLeads));
  const brandSlug = $derived($page.params.brand);

  type PlatformRow = {
    key: RadarPlatformKey;
    label: string;
    proOnly: boolean;
  };

  const PLATFORM_ROWS: PlatformRow[] = [
    { key: 'gnews', label: 'Google News', proOnly: false },
    { key: 'reddit', label: 'Reddit', proOnly: false },
    { key: 'threads', label: 'Threads', proOnly: true },
    { key: 'x', label: 'X', proOnly: true },
    { key: 'linkedin', label: 'LinkedIn', proOnly: true }
  ];

  let srcKind = $state('gnews_query');
  const isProOnlyKind = (k: string) =>
    k === 'threads_query' || k === 'x_community' || k === 'linkedin_query';
  $effect(() => {
    if (!hasProLeads && isProOnlyKind(srcKind)) srcKind = 'gnews_query';
  });

  const kindLabel = (k: string) =>
    k === 'gnews_query'
      ? 'Google News'
      : k === 'subreddit'
        ? 'Reddit'
        : k === 'reddit_query'
          ? 'Reddit Search'
          : k === 'threads_query'
            ? 'Threads'
            : k === 'x_community'
              ? 'X Community'
              : k === 'linkedin_query'
                ? 'LinkedIn'
                : 'RSS';

  const kindPlaceholder: Record<string, string> = {
    gnews_query: $_('app.radar.ph.gnews'),
    subreddit: $_('app.radar.ph.subreddit'),
    reddit_query: $_('app.radar.ph.redditSearch'),
    threads_query: $_('app.radar.ph.threads'),
    x_community: $_('app.radar.ph.xcommunity'),
    linkedin_query: $_('app.settings.radar.phLinkedin'),
    rss: $_('app.radar.ph.rss')
  };

  const LANGUAGES = [
    { value: 'auto', label: 'Auto' },
    { value: 'it', label: 'Italiano' },
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Español' },
    { value: 'fr', label: 'Français' },
    { value: 'de', label: 'Deutsch' },
    { value: 'pt', label: 'Português' },
    { value: 'nl', label: 'Nederlands' },
    { value: 'pl', label: 'Polski' },
    { value: 'ro', label: 'Română' },
    { value: 'sv', label: 'Svenska' },
    { value: 'no', label: 'Norsk' },
    { value: 'da', label: 'Dansk' },
    { value: 'fi', label: 'Suomi' },
    { value: 'cs', label: 'Čeština' },
    { value: 'sk', label: 'Slovenčina' },
    { value: 'hu', label: 'Magyar' },
    { value: 'hr', label: 'Hrvatski' },
    { value: 'sr', label: 'Srpski' },
    { value: 'sl', label: 'Slovenščina' },
    { value: 'bg', label: 'Български' },
    { value: 'uk', label: 'Українська' },
    { value: 'ru', label: 'Русский' },
    { value: 'tr', label: 'Türkçe' },
    { value: 'el', label: 'Ελληνικά' },
    { value: 'ar', label: 'العربية' },
    { value: 'he', label: 'עברית' },
    { value: 'fa', label: 'فارسی' },
    { value: 'hi', label: 'हिन्दी' },
    { value: 'th', label: 'ไทย' },
    { value: 'vi', label: 'Tiếng Việt' },
    { value: 'id', label: 'Bahasa Indonesia' },
    { value: 'ms', label: 'Bahasa Melayu' },
    { value: 'zh', label: '中文' },
    { value: 'ja', label: '日本語' },
    { value: 'ko', label: '한국어' }
  ];

  const langLabel = (code?: string | null) => {
    if (!code || code === 'auto') return '';
    return LANGUAGES.find((l) => l.value === code)?.label ?? code.toUpperCase();
  };

  let addError = $state('');
  function validateAdd(e: SubmitEvent) {
    addError = '';
    const formEl = e.currentTarget as HTMLFormElement;
    const value = (formEl.querySelector('input[name="value"]') as HTMLInputElement)?.value?.trim() ?? '';
    if (!value) {
      e.preventDefault();
      addError = $_('app.radar.errorEmpty');
      return;
    }
    if (srcKind === 'rss' && !/^https?:\/\/.+/i.test(value)) {
      e.preventDefault();
      addError = $_('app.radar.errorUrl');
    }
  }

  const platformDesc = (key: RadarPlatformKey) => $_('app.settings.radar.platforms.' + key);
  const atSourceLimit = $derived(data.radarSources.length >= data.sourceLimit);
</script>

<section class="panel">
  <div class="panel-head">
    <div class="t">{$_('app.settings.radar.platformsTitle')}</div>
  </div>
  <div class="field">
    <div class="ftxt">
      <div class="fs">{$_('app.settings.radar.platformsDesc')}</div>
    </div>
  </div>
  {#each PLATFORM_ROWS as row (row.key)}
    {@const locked = row.proOnly && !hasProLeads}
    {@const on = locked ? false : data.platforms[row.key]}
    <div class="field plat" class:locked>
      <div class="ftxt">
        <div class="fh">
          {row.label}
          {#if row.proOnly}<span class="pro-badge">{$_('app.radar.proOnlyBadge')}</span>{/if}
        </div>
        <div class="fs">{platformDesc(row.key)}</div>
      </div>
      {#if locked}
        <a class="mini connect" href={`/app/${brandSlug}/settings/billing`}>{$_('app.radar.proLeadsUpgrade')}</a>
      {:else}
        <form method="POST" action="?/togglePlatform" use:enhance={withBusy}>
          <input type="hidden" name="platform" value={row.key} />
          <input type="hidden" name="enabled" value={String(!on)} />
          <label class="ios-switch">
            <input
              type="checkbox"
              checked={on}
              disabled={busy}
              onchange={(e) => e.currentTarget.form?.requestSubmit()}
            />
            <span class="ios-slider"></span>
          </label>
        </form>
      {/if}
    </div>
  {/each}
</section>

<section class="panel">
  <div class="panel-head">
    <div class="t">
      {$_('app.settings.radar.customTitle')}
      <span class="usage"
        >· {$_('app.settings.radar.usage', {
          values: { used: data.radarSources.length, limit: data.sourceLimit }
        })}</span
      >
    </div>
  </div>
  <div class="field">
    <div class="ftxt">
      <div class="fs">
        {$_('app.settings.radar.customDesc', { values: { limit: data.sourceLimit } })}
      </div>
    </div>
  </div>

  {#if atSourceLimit}
    <div class="field">
      <div class="fs warn">
        {$_('app.settings.radar.limitReached', { values: { limit: data.sourceLimit } })}
        <a href={`/app/${brandSlug}/settings/billing`}>{$_('app.radar.proLeadsUpgrade')}</a>
      </div>
    </div>
  {/if}

  {#if data.radarSources.length}
    {#each data.radarSources as s (s.id)}
      {@const locked = !hasProLeads && isProOnlyKind(s.kind)}
      <div class="acct src" class:off={!s.active || locked}>
        <div class="nm">
          <div class="h">
            {kindLabel(s.kind)}{langLabel(s.lang) ? ` · ${langLabel(s.lang)}` : ''}{#if locked}
              · {$_('app.radar.proOnlyBadge')}{/if}
          </div>
          <div class="s">{s.kind === 'subreddit' ? `r/${s.value}` : s.value}</div>
        </div>
        <div class="src-actions">
          {#if !locked}
            <form method="POST" action="?/radarToggleSource" use:enhance={withBusy}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="active" value={String(!s.active)} />
              <label class="ios-switch small">
                <input
                  type="checkbox"
                  checked={s.active}
                  disabled={busy}
                  onchange={(e) => e.currentTarget.form?.requestSubmit()}
                />
                <span class="ios-slider"></span>
              </label>
            </form>
          {/if}
          <form method="POST" action="?/radarDeleteSource" use:enhance={withBusy}>
            <input type="hidden" name="id" value={s.id} />
            <button class="mini danger" type="submit" disabled={busy} title={$_('app.settings.radar.delete')}
              >{$_('app.settings.radar.delete')}</button
            >
          </form>
        </div>
      </div>
    {/each}
  {:else}
    <div class="field"><div class="fs">{$_('app.studio.radar.empty')}</div></div>
  {/if}

  {#if !atSourceLimit}
    <div class="field add-wrap">
      <form method="POST" action="?/radarAddSource" use:enhance={withBusy} class="add-form" onsubmit={validateAdd}>
        <select name="kind" class="add-select" bind:value={srcKind}>
          <option value="gnews_query">Google News</option>
          <option value="subreddit">Reddit</option>
          <option value="reddit_query">Reddit Search</option>
          {#if hasProLeads}
            <option value="threads_query">Threads</option>
            <option value="x_community">X Community</option>
            <option value="linkedin_query">LinkedIn</option>
          {/if}
          <option value="rss">RSS</option>
        </select>
        <input
          type="text"
          name="value"
          placeholder={kindPlaceholder[srcKind] ?? ''}
          class="add-input"
          oninput={() => (addError = '')}
        />
        <select name="lang" class="add-select add-lang">
          {#each LANGUAGES as lang}<option value={lang.value}>{lang.label}</option>{/each}
        </select>
        <button class="mini connect" type="submit" disabled={busy}>{$_('app.studio.radar.add')}</button>
      </form>
      {#if !hasProLeads}
        <p class="hint">
          {$_('app.radar.proLeadsHint')}
          <a href={`/app/${brandSlug}/settings/billing`}>{$_('app.radar.proLeadsUpgrade')}</a>
        </p>
      {/if}
      {#if addError || form?.error === 'pro_leads_required'}
        <p class="err">{addError || $_('app.radar.errorProLeads')}</p>
      {/if}
      {#if form?.error === 'source_limit'}
        <p class="err">{$_('app.settings.radar.limitReached', { values: { limit: form.limit ?? data.sourceLimit } })}</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .plat.locked {
    opacity: 0.72;
  }
  .pro-badge {
    display: inline-block;
    margin-left: 6px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.12);
    padding: 2px 6px;
    border-radius: 999px;
    vertical-align: middle;
  }
  .src.off {
    opacity: 0.55;
  }
  .src-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .mini.danger {
    color: #c0392b;
    border-color: rgba(192, 57, 43, 0.35);
    background: transparent;
  }
  .add-wrap {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .add-form {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    width: 100%;
    align-items: center;
  }
  .add-select,
  .add-input {
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 13px;
  }
  .add-input {
    flex: 1;
    min-width: 160px;
  }
  .add-lang {
    max-width: 140px;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--ink-soft);
  }
  .hint a {
    color: var(--accent);
    font-weight: 600;
    text-decoration: none;
  }
  .err {
    margin: 0;
    font-size: 12px;
    color: #c0392b;
  }
  .usage {
    color: var(--ink-faint);
    font-weight: 500;
  }
  .fs.warn {
    color: #a3700a;
  }
  .fs.warn a {
    color: var(--accent);
    font-weight: 600;
    text-decoration: none;
    margin-left: 4px;
  }

  .ios-switch {
    position: relative;
    display: inline-block;
    width: 51px;
    height: 31px;
    flex-shrink: 0;
    cursor: pointer;
  }
  .ios-switch input {
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  }
  .ios-slider {
    position: absolute;
    inset: 0;
    background: #e9e9eb;
    border-radius: 31px;
    transition: background 0.2s;
  }
  .ios-slider::before {
    content: '';
    position: absolute;
    height: 27px;
    width: 27px;
    left: 2px;
    bottom: 2px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
  .ios-switch input:checked + .ios-slider {
    background: #34c759;
  }
  .ios-switch input:checked + .ios-slider::before {
    transform: translateX(20px);
  }
  .ios-switch.small {
    width: 43px;
    height: 26px;
  }
  .ios-switch.small .ios-slider {
    border-radius: 26px;
  }
  .ios-switch.small .ios-slider::before {
    height: 22px;
    width: 22px;
  }
  .ios-switch.small input:checked + .ios-slider::before {
    transform: translateX(17px);
  }
</style>
