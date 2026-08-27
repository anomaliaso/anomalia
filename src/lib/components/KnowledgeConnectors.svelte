<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { enhance, applyAction } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { ListChecks, Plug, RefreshCw, RotateCw, Search, Unplug, X } from '@lucide/svelte';
  import type { KnowledgeProvider } from '$lib/knowledge-providers';
  import { searchCatalog, type ConnectorCatalogItem } from '$lib/composio-catalog';

  /** What a card needs. The search endpoint returns exactly this subset of the catalog item. */
  type CatalogItem = Pick<
    ConnectorCatalogItem,
    'toolkitSlug' | 'displayName' | 'logo' | 'kind' | 'managedAuth' | 'knowledgeProvider'
  >;
  import { connectorNeedsScope } from '$lib/knowledge-scope';
  import {
    GITHUB_REPO_LIMIT,
    parseGithubRepoSelection,
    type GithubRepoOption
  } from '$lib/github-repos';
  import {
    NOTION_PAGE_LIMIT,
    notionFormValue,
    parseNotionPageSelection,
    type NotionPageOption
  } from '$lib/notion-pages';
  import { searchConsoleSettingsHref } from '$lib/connectors';
  import ScopePicker from '$lib/components/ScopePicker.svelte';
  import DriveFilePicker from '$lib/components/DriveFilePicker.svelte';
  import { parseDriveFileSelection, parseDriveFolderSelection } from '$lib/drive-folders';

  export type ConnectorSourceRow = {
    provider: KnowledgeProvider;
    status: string;
    display_name: string | null;
    last_sync_at: string | null;
    last_error: string | null;
    docs_ingested: number;
    settings?: Record<string, unknown> | null;
  };

  export type ConnectorConnectionRow = {
    toolkit_slug: string;
    status: string;
    display_name: string | null;
    last_error: string | null;
  };

  export type GscConnectorStatus = {
    configured: boolean;
    connected: boolean;
    siteUrl: string | null;
  };

  let {
    brandSlug,
    sources = [],
    connections = [],
    catalog = [],
    catalogError = '',
    connectorsConfigured = false,
    githubRepos = [],
    githubReposError = '',
    notionPages = [],
    notionPagesError = '',
    gsc = null,
    formError = ''
  }: {
    brandSlug: string;
    sources?: ConnectorSourceRow[];
    connections?: ConnectorConnectionRow[];
    catalog?: ConnectorCatalogItem[];
    catalogError?: string;
    connectorsConfigured?: boolean;
    githubRepos?: GithubRepoOption[];
    githubReposError?: string;
    notionPages?: NotionPageOption[];
    notionPagesError?: string;
    gsc?: GscConnectorStatus | null;
    formError?: string;
  } = $props();

  let busy = $state(false);
  let query = $state('');
  let onlyConnected = $state(false);
  /** How long we keep asking Composio whether the user finished authorizing. */
  const CLAIM_TIMEOUT_MS = 120_000;
  const CLAIM_INTERVAL_MS = 2500;
  let connecting = $state<string | null>(null);
  /** Which connector's scope picker is open in the modal — the cards themselves stay compact. */
  let scopeOpen = $state<KnowledgeProvider | null>(null);
  let scopeDialog = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    if (!scopeDialog) return;
    // showModal() throws if the dialog is already open, so mirror state rather than re-issuing it.
    if (scopeOpen && !scopeDialog.open) scopeDialog.showModal();
    else if (!scopeOpen && scopeDialog.open) scopeDialog.close();
  });
  let connectError = $state('');
  let selectedRepos = $state<string[]>([]);
  let selectedPages = $state<string[]>([]);

  const sourceByProvider = $derived(new Map(sources.map((s) => [s.provider, s])));
  const connectionByKey = $derived(new Map(connections.map((c) => [c.toolkit_slug, c])));
  const githubSource = $derived(sourceByProvider.get('github') ?? null);
  const notionSource = $derived(sourceByProvider.get('notion') ?? null);
  const gscHref = $derived(searchConsoleSettingsHref(brandSlug));
  const savedGithubKey = $derived(parseGithubRepoSelection(githubSource?.settings).join('\0'));
  const savedNotionKey = $derived(parseNotionPageSelection(notionSource?.settings).map((p) => p.id).join('\0'));

  $effect(() => {
    selectedRepos = savedGithubKey ? savedGithubKey.split('\0') : [];
  });
  $effect(() => {
    selectedPages = savedNotionKey ? savedNotionKey.split('\0') : [];
  });

  const notionPageItems = $derived.by(() => {
    const map = new Map(notionPages.map((p) => [p.id, p]));
    for (const p of parseNotionPageSelection(notionSource?.settings)) {
      if (!map.has(p.id)) map.set(p.id, p);
    }
    return [...map.values()];
  });

  const withBusy: SubmitFunction = () => {
    busy = true;
    return async ({ result }) => {
      busy = false;
      await applyAction(result);
      if (result.type === 'success') await invalidateAll();
    };
  };

  function titleFor(item: CatalogItem): string {
    const p = item.knowledgeProvider;
    if (p) return $_(`app.knowledge.sources.providers.${p}`);
    return item.displayName;
  }

  function hintFor(item: CatalogItem): string {
    const p = item.knowledgeProvider;
    if (p) return $_(`app.knowledge.sources.hints.${p}`);
    return item.kind === 'mcp'
      ? $_('app.settings.connectors.mcpHint')
      : $_('app.settings.connectors.appHint');
  }

  // Composio only ships a logo for some toolkits — the rest fall back to an initial.
  function initialFor(item: CatalogItem): string {
    return (titleFor(item).trim()[0] ?? '?').toUpperCase();
  }

  const SCOPED: KnowledgeProvider[] = ['github', 'google-drive', 'notion'];

  /** One short line ("3 selected") plus the full names for the tooltip — never dumped into the card. */
  function scopeLabel(
    provider: KnowledgeProvider,
    settings: Record<string, unknown> | null | undefined
  ): { text: string; names: string } {
    const key = provider === 'github' ? 'github' : provider === 'google-drive' ? 'drive' : 'notion';
    const names =
      provider === 'github'
        ? parseGithubRepoSelection(settings)
        : provider === 'google-drive'
          ? [...parseDriveFileSelection(settings), ...parseDriveFolderSelection(settings)].map((f) => f.name)
          : parseNotionPageSelection(settings).map((p) => p.title);
    return {
      text: names.length
        ? $_(`app.knowledge.sources.${key}.selected`, { values: { n: names.length } })
        : $_(`app.knowledge.sources.${key}.noneSelected`),
      names: names.join(', ')
    };
  }

  const needle = $derived(query.trim().toLowerCase());

  /**
   * Opening a Connect Link creates a `pending` row and nothing more: the user may never finish
   * authorizing. Only a connection Composio confirmed counts as connected — `error` included,
   * because that is a connection that worked and now needs a reconnect.
   */
  const isConnected = (item: ConnectorCatalogItem) => {
    const conn = connectionByKey.get(item.toolkitSlug);
    if (conn && conn.status !== 'pending') return true;
    const src = item.knowledgeProvider ? sourceByProvider.get(item.knowledgeProvider) : null;
    return Boolean(src);
  };
  const connectedCount = $derived(catalog.filter(isConnected).length);

  /** The whole Composio catalog, ranked by the query. No shortlist, no allow list. */
  const ranked = $derived(
    searchCatalog(onlyConnected ? catalog.filter(isConnected) : catalog, needle)
  );
  const PAGE_SIZE = 60;
  let pages = $state(1);
  $effect(() => {
    needle; // a new query starts from the first page again
    pages = 1;
  });
  const visibleItems = $derived(ranked.slice(0, pages * PAGE_SIZE));
  const showGsc = $derived(
    gsc && (!needle || $_('app.settings.searchConsole.title').toLowerCase().includes(needle))
      ? gsc
      : null
  );

  async function connectIntegration(toolkitSlug: string) {
    connecting = toolkitSlug;
    connectError = '';
    try {
      const res = await fetch(`/app/${brandSlug}/knowledge/connect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'session', toolkit: toolkitSlug })
      });
      const json = (await res.json()) as { error?: string; authorizationUrl?: string | null };
      if (!res.ok) throw new Error(json.error || 'Failed to start connect');

      // A null URL means the toolkit needs no consent — the account is already usable.
      if (json.authorizationUrl) {
        window.open(json.authorizationUrl, 'connect-app', 'popup,width=520,height=720');
      }

      // The provider callback lands in that popup, never on our server, and Composio flips the
      // account to active a moment later — so poll. Nine seconds of polling was the bug behind
      // "I connected it and it says pending": a real OAuth round trip (login, 2FA, authorize)
      // takes far longer than that, and the claim gave up before the user was done.
      const deadline = Date.now() + CLAIM_TIMEOUT_MS;
      let connected = false;
      while (!connected && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, CLAIM_INTERVAL_MS));
        const claim = await fetch(`/app/${brandSlug}/knowledge/connect`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'claim', toolkit: toolkitSlug })
        });
        const claimed = (await claim.json()) as { ok?: boolean; error?: string };
        if (!claim.ok && claimed.error) throw new Error(claimed.error);
        connected = claimed.ok === true;
      }
      if (!connected) throw new Error($_('app.knowledge.sources.connectTimeout'));
      await invalidateAll();
    } catch (e) {
      connectError = e instanceof Error ? e.message : String(e);
    } finally {
      connecting = null;
    }
  }
</script>

{#if formError}
  <p class="banner err">{formError}</p>
{/if}
{#if connectError}
  <p class="banner err">{connectError}</p>
{/if}

{#snippet gscLogo()}
  <!-- Google Search Console mark: Google-blue magnifier over the red/yellow/green bars. -->
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <rect x="3" y="13" width="3" height="7" rx="1" fill="#EA4335" />
    <rect x="8" y="9" width="3" height="11" rx="1" fill="#FBBC05" />
    <rect x="13" y="15" width="3" height="5" rx="1" fill="#34A853" />
    <circle cx="16" cy="8" r="4.4" fill="none" stroke="#4285F4" stroke-width="2" />
    <path d="M19.3 11.3 L22 14" stroke="#4285F4" stroke-width="2" stroke-linecap="round" />
  </svg>
{/snippet}

{#snippet logoFor(item: CatalogItem)}
  <span class="source-icon">
    {#if item.logo}
      <img src={item.logo} alt="" loading="lazy" />
    {:else}
      <span aria-hidden="true">{initialFor(item)}</span>
    {/if}
  </span>
{/snippet}

<div class="toolbar">
  <div class="filters">
    <button
      class="chip" class:on={!onlyConnected} type="button" onclick={() => (onlyConnected = false)}
    >
      {$_('app.settings.connectors.filterAll')}<span class="count">{catalog.length}</span>
    </button>
    <button
      class="chip" class:on={onlyConnected} type="button" onclick={() => (onlyConnected = true)}
    >
      {$_('app.settings.connectors.filterConnected')}<span class="count">{connectedCount}</span>
    </button>
  </div>
  <label class="search">
    <Search size={15} strokeWidth={2} />
    <input type="search" bind:value={query} placeholder={$_('app.settings.connectors.searchPlaceholder')} />
  </label>
</div>

<section class="catalog-section">
  <p class="muted lede">{$_('app.settings.connectors.lede')}</p>
  <p class="muted lede">
    {#if catalogError}
      <span class="banner err tiny">{catalogError}</span>
    {:else if needle}
      {$_('app.settings.connectors.searchResults', { values: { n: ranked.length } })}
    {:else}
      {$_('app.settings.connectors.catalogCount', { values: { n: catalog.length } })}
    {/if}
  </p>
  {#if ranked.length === 0 && !showGsc}
    <p class="muted">
      {onlyConnected && !needle
        ? $_('app.settings.connectors.noneConnected')
        : $_('app.settings.connectors.noMatch')}
    </p>
  {/if}
  <ul class="source-grid">
    {#each visibleItems as item (item.toolkitSlug)}
      {@const provider = item.knowledgeProvider}
      {@const src = provider ? sourceByProvider.get(provider) : null}
      {@const conn = connectionByKey.get(item.toolkitSlug) ?? null}
      {@const connected = !!(src || conn)}
      {@const scoped = !!src && !!provider && SCOPED.includes(provider)}
      {@const status = src?.status ?? conn?.status ?? ''}
      <li class="source-card" class:connected>
        <div class="source-head">
          {@render logoFor(item)}
          <strong>{titleFor(item)}</strong>
          {#if status}
            <span
              class="dot status-{status === 'active' ? 'ready' : status === 'error' ? 'failed' : 'pending'}"
              title={$_(`app.knowledge.sources.status.${status}`, { default: status })}
            ></span>
          {/if}
        </div>
        <p class="hint">{hintFor(item)}</p>
        <p class="meta">
          {#if src}
            {src.display_name || $_(`app.knowledge.sources.status.${src.status}`, { default: src.status })}
            · {src.docs_ingested} {$_('app.knowledge.sources.docs')}
          {:else if conn}
            {conn.display_name || $_(`app.knowledge.sources.status.${conn.status}`, { default: conn.status })}
          {/if}
        </p>
        {#if src?.last_error || conn?.last_error}
          <p class="banner err tiny">{src?.last_error || conn?.last_error}</p>
        {/if}
        <div class="source-actions">
          {#if !connectorsConfigured}
            <span class="muted">{$_('app.knowledge.sources.notConfigured')}</span>
          {:else if connected}
            {#if scoped && provider}
              {@const scope = scopeLabel(provider, src?.settings)}
              <button
                class="btn soft icon"
                type="button"
                title="{scope.text}{scope.names ? ` — ${scope.names}` : ''}"
                aria-label={scope.text}
                onclick={() => (scopeOpen = provider)}
              >
                <ListChecks size={15} strokeWidth={2} />
              </button>
            {/if}
            {#if provider}
              <form method="POST" action="?/syncSource" use:enhance={withBusy}>
                <input type="hidden" name="provider" value={provider} />
                <button
                  class="btn soft icon"
                  type="submit"
                  title={$_('app.knowledge.sources.sync')}
                  aria-label={$_('app.knowledge.sources.sync')}
                  disabled={busy || src?.status === 'syncing' || connectorNeedsScope(provider, src?.settings)}
                >
                  <RefreshCw size={15} strokeWidth={2} />
                </button>
              </form>
            {/if}
            <!-- Reconnect only when the token actually broke — otherwise it reads as a second sync. -->
            {#if status === 'error' || !provider}
              <button
                class="btn ghost icon"
                type="button"
                title={$_('app.knowledge.sources.reconnect')}
                aria-label={$_('app.knowledge.sources.reconnect')}
                disabled={connecting === item.toolkitSlug}
                onclick={() => connectIntegration(item.toolkitSlug)}
              >
                <RotateCw size={15} strokeWidth={2} />
              </button>
            {/if}
            <form method="POST" action="?/disconnectSource" use:enhance={withBusy}>
              <input type="hidden" name="integration" value={item.toolkitSlug} />
              <button
                class="btn danger icon"
                type="submit"
                title={$_('app.knowledge.sources.disconnect')}
                aria-label={$_('app.knowledge.sources.disconnect')}
                disabled={busy}
              >
                <Unplug size={15} strokeWidth={2} />
              </button>
            </form>
          {:else}
            <button
              class="btn primary"
              type="button"
              disabled={connecting === item.toolkitSlug}
              onclick={() => connectIntegration(item.toolkitSlug)}
            >
              <Plug size={14} strokeWidth={2} />
              {connecting === item.toolkitSlug ? $_('app.knowledge.sources.connecting') : $_('app.knowledge.sources.connect')}
            </button>
          {/if}
        </div>
      </li>
    {/each}

    {#if showGsc}
      {@const gsc = showGsc}
      <li class="source-card" class:connected={gsc.connected}>
        <div class="source-head">
          <span class="source-icon">{@render gscLogo()}</span>
          <strong>{$_('app.settings.searchConsole.title')}</strong>
          {#if gsc.connected}
            <span class="dot status-ready" title={$_('app.knowledge.sources.status.active')}></span>
          {/if}
        </div>
        <p class="hint">{$_('app.settings.connectors.gscHint')}</p>
        <p class="meta">{gsc.connected ? (gsc.siteUrl ?? '') : ''}</p>
        <div class="source-actions">
          <a class="btn primary" href={gscHref}>
            <Plug size={14} strokeWidth={2} />
            {gsc.connected ? $_('app.settings.connectors.gscOpen') : $_('app.settings.connectors.gscConnect')}
          </a>
        </div>
      </li>
    {/if}
  </ul>
  {#if ranked.length > visibleItems.length}
    <button class="btn soft more" type="button" onclick={() => (pages += 1)}>
      {$_('app.settings.connectors.showMore', {
        values: { n: Math.min(PAGE_SIZE, ranked.length - visibleItems.length) }
      })}
    </button>
  {/if}
</section>

<dialog bind:this={scopeDialog} class="scope-modal" onclose={() => (scopeOpen = null)}>
  {#if scopeOpen}
    {@const src = sourceByProvider.get(scopeOpen)}
    <div class="scope-head">
      <strong>{$_(`app.knowledge.sources.providers.${scopeOpen}`)}</strong>
      <button class="btn ghost icon" type="button" aria-label="Close" onclick={() => (scopeOpen = null)}>
        <X size={15} strokeWidth={2} />
      </button>
    </div>
    {#if scopeOpen === 'github'}
      <ScopePicker
        action="?/saveGithubRepos"
        inputName="repos"
        items={githubRepos.map((r) => ({ id: r.fullName, label: r.fullName }))}
        listError={githubReposError}
        limit={GITHUB_REPO_LIMIT}
        bind:selected={selectedRepos}
        i18nKey="app.knowledge.sources.github"
        {busy}
        enhanceBusy={withBusy}
      />
    {:else if scopeOpen === 'google-drive'}
      <DriveFilePicker
        {brandSlug}
        files={parseDriveFileSelection(src?.settings)}
        folders={parseDriveFolderSelection(src?.settings)}
        {busy}
      />
    {:else}
      <ScopePicker
        action="?/saveNotionPages"
        inputName="pages"
        items={notionPageItems.map((p) => ({
          id: p.id,
          label: p.kind === 'database' ? `${p.title} (db)` : p.title
        }))}
        listError={notionPagesError}
        limit={NOTION_PAGE_LIMIT}
        bind:selected={selectedPages}
        i18nKey="app.knowledge.sources.notion"
        {busy}
        enhanceBusy={withBusy}
        encodeValue={(it) => {
          const page = notionPageItems.find((p) => p.id === it.id);
          return page ? notionFormValue(page) : it.id;
        }}
      />
    {/if}
  {/if}
</dialog>

<style>
  .catalog-section { margin: 0 0 28px; }
  .catalog-section .lede { margin: 0 0 14px; }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin: 0 0 12px;
  }
  .search {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 180px;
    max-width: 280px;
    padding: 0 12px;
    height: 38px;
    border: 1px solid var(--line, #e5e5e8);
    border-radius: 12px;
    background: var(--paper, #fff);
    color: var(--ink-soft, #6e6e73);
  }
  .more {
    margin: 14px auto 0;
    display: block;
  }
  .filters {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    background: var(--paper-2, #f5f5f7);
    border: 1px solid var(--line, #e5e5e8);
    border-radius: 12px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
    color: var(--ink-soft, #6e6e73);
    background: none;
    border: none;
    border-radius: 9px;
    padding: 8px 14px;
    cursor: pointer;
  }
  .chip.on {
    background: var(--paper, #fff);
    color: var(--ink, #1d1d1f);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }
  .chip:hover:not(.on) { color: var(--ink, #1d1d1f); }
  .count {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    padding: 2px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 12%, transparent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 13px;
    border: none;
    outline: none;
    background: none;
    color: var(--ink, #1d1d1f);
  }
  .search:focus-within { border-color: var(--ink-faint, #b0b0b5); }

  .search {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 180px;
    max-width: 280px;
    padding: 0 12px;
    height: 38px;
    border: 1px solid var(--line, #e5e5e8);
    border-radius: 12px;
    background: var(--paper, #fff);
    color: var(--ink-soft, #6e6e73);
  }
  .more {
    margin: 14px auto 0;
    display: block;
  }
  .filters {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    background: var(--paper-2, #f5f5f7);
    border: 1px solid var(--line, #e5e5e8);
    border-radius: 12px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
    color: var(--ink-soft, #6e6e73);
    background: none;
    border: none;
    border-radius: 9px;
    padding: 8px 14px;
    cursor: pointer;
  }
  .chip.on {
    background: var(--paper, #fff);
    color: var(--ink, #1d1d1f);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }
  .chip:hover:not(.on) { color: var(--ink, #1d1d1f); }
  .count {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    padding: 2px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 12%, transparent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 13px;
    border: none;
    outline: none;
    background: none;
    color: var(--ink, #1d1d1f);
  }
  .search:focus-within { border-color: var(--ink-faint, #b0b0b5); }

  .source-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 10px;
    /* start, not stretch: opening one card's picker must not stretch the rest of its row. */
    align-items: start;
  }
  /* Every collapsed card is the same height: head + 2-line hint + 1-line meta + actions. */
  .source-card {
    display: flex;
    flex-direction: column;
    padding: 14px;
    border: 1px solid var(--line, #e5e5e8);
    border-radius: 12px;
    background: var(--paper-2, #f5f5f7);
  }
  .source-card.connected { background: var(--paper, #fff); }

  .source-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .source-head strong {
    font-size: 14px;
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .source-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 9px;
    background: var(--paper, #fff);
    border: 1px solid var(--line, #e5e5e8);
    font-size: 14px;
    font-weight: 700;
    color: var(--ink-soft, #6e6e73);
    overflow: hidden;
  }
  .source-icon img { width: 20px; height: 20px; object-fit: contain; }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }

  .hint {
    margin: 10px 0 0;
    font-size: 13px;
    line-height: 1.4;
    color: var(--ink-soft, #6e6e73);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: calc(2 * 1.4em);
  }
  .meta {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.4;
    min-height: 1.4em;
    color: var(--ink-faint, #8e8e93);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .source-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--line, #e5e5e8);
  }

  .scope-modal {
    width: min(520px, calc(100vw - 32px));
    max-height: min(680px, calc(100vh - 64px));
    overflow: auto;
    padding: 18px;
    border: 1px solid var(--line, #e5e5e8);
    border-radius: 16px;
    background: var(--paper, #fff);
    color: var(--ink, #1d1d1f);
  }
  .scope-modal::backdrop { background: rgba(0, 0, 0, 0.35); }
  .scope-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 4px;
  }
  .scope-head strong { font-size: 15px; }

  .muted { color: var(--ink-soft, #6e6e73); font-size: 13px; }
  .banner.err { color: #a11; margin: 0 0 12px; }
  .banner.tiny { font-size: 12px; margin: 8px 0 0; }
  .status-ready { color: #1f8a4c; }
  .status-failed { color: #a11; }
  .status-pending { color: #b45309; }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
    border-radius: 10px;
    padding: 9px 14px;
    cursor: pointer;
    border: 1px solid transparent;
    text-decoration: none;
    box-sizing: border-box;
    font-family: inherit;
    color: inherit;
  }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn.icon { padding: 9px; }
  .btn.primary {
    background: var(--invert-surface, #1d1d1f);
    color: #fff;
    border-color: var(--invert-surface, #1d1d1f);
  }
  .btn.ghost {
    background: var(--paper, #fff);
    color: var(--ink, #1d1d1f);
    border-color: var(--line, #e5e5e8);
  }
  .btn.soft {
    background: var(--paper-2, #f5f5f7);
    color: var(--ink, #1d1d1f);
    border-color: var(--line, #e5e5e8);
  }
  .btn.danger {
    background: color-mix(in srgb, #a11 14%, var(--paper, #fff));
    color: #a11;
    border-color: color-mix(in srgb, #a11 28%, var(--line, #e5e5e8));
  }
</style>
