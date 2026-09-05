<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { enhance, applyAction } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Plus, Pin, Trash2, Settings2, BadgeCheck, Sparkles } from '@lucide/svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import PageHead from '$lib/components/PageHead.svelte';
  import { marked } from 'marked';
  import { isConnectorSourceType, type KnowledgeProvider } from '$lib/knowledge-providers';
  import { parseGithubRepoSelection } from '$lib/github-repos';
  import { parseDriveFileSelection, parseDriveFolderSelection } from '$lib/drive-folders';
  import { parseNotionPageSelection } from '$lib/notion-pages';
  import { connectorsSettingsHref } from '$lib/connectors';

  let { data, form } = $props();
  const brand = $derived((data as { brand?: { id: string; slug: string } }).brand);
  const brandSlug = $derived(brand?.slug ?? $page.params.brand ?? '');

  let busy = $state(false);
  let selectedId = $state<string | null>(null);
  let showChunks = $state(false);
  let editMd = $state(false);
  let mdDraft = $state('');
  let memoryFilter = $state('all');
  let docFilter = $state('all');
  let docQuery = $state('');
  let detail = $state<{ document: Record<string, unknown>; chunks: DocChunk[] } | null>(null);
  let detailLoading = $state(false);

  const MEM_PAGE_SIZE = 12;
  let memPage = $state(0);
  let settingsOpen = $state(false);
  let settingsMem = $state<{
    id: string;
    key: string;
    value: string;
    category: string;
    pinned?: boolean;
    importance?: number;
    confidence?: number;
    times_used?: number;
  } | null>(null);

  const q = (key: string) => $page.url.searchParams.get(key);
  $effect(() => {
    const doc = q('doc');
    if (doc && doc !== selectedId) {
      void openDoc(doc);
      if (q('section')) showChunks = true;
    }
  });

  type DocChunk = { id: string; idx: number; heading_path: string | null; content: string; tokens: number | null };
  type DocRow = {
    id: string;
    title: string | null;
    file_name: string | null;
    summary: string | null;
    status: string | null;
    collection: string | null;
    chunk_count: number | null;
    bytes: number | null;
    error: string | null;
    source_type: string | null;
  };

  type SourceRow = {
    provider: KnowledgeProvider;
    status: string;
    display_name: string | null;
    last_sync_at: string | null;
    last_error: string | null;
    docs_ingested: number;
    settings?: Record<string, unknown> | null;
  };

  const COLLECTIONS = ['brand', 'product', 'commercial', 'legal', 'operations', 'research'];

  const documents = $derived(data.documents ?? []);
  const memories = $derived(data.memories ?? []);
  const contradict = $derived(new Set(data.contradictMemoryIds ?? []));
  const sources = $derived((data.sources ?? []) as SourceRow[]);
  const selected = $derived(documents.find((d: { id: string }) => d.id === selectedId) ?? null);
  const selectedMarkdown = $derived((detail?.document?.markdown as string | null) ?? '');
  const selectedChunks = $derived(detail?.chunks ?? []);
  const collectionCounts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const d of documents as DocRow[]) {
      const k = d.collection ?? 'other';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  });
  const visibleDocuments = $derived.by(() => {
    const q = docQuery.trim().toLowerCase();
    return (documents as DocRow[]).filter((d) => {
      if (docFilter !== 'all' && (d.collection ?? 'other') !== docFilter) return false;
      if (!q) return true;
      return [d.title, d.file_name, d.summary].some((v) => (v ?? '').toLowerCase().includes(q));
    });
  });
  const filteredMemories = $derived(
    memoryFilter === 'all' ? memories : memories.filter((m: { category: string }) => m.category === memoryFilter)
  );
  const memPageCount = $derived(Math.max(1, Math.ceil(filteredMemories.length / MEM_PAGE_SIZE)));
  const pagedMemories = $derived(
    filteredMemories.slice(memPage * MEM_PAGE_SIZE, memPage * MEM_PAGE_SIZE + MEM_PAGE_SIZE)
  );

  $effect(() => {
    void memoryFilter;
    memPage = 0;
  });
  $effect(() => {
    if (memPage >= memPageCount) memPage = Math.max(0, memPageCount - 1);
  });

  const withBusy: SubmitFunction = () => {
    busy = true;
    return async ({ result }) => {
      busy = false;
      await applyAction(result);
      if (result.type === 'success') {
        settingsOpen = false;
        settingsMem = null;
        await invalidateAll();
      }
    };
  };

  $effect(() => {
    if (!data.pending) return;
    const t = setInterval(() => {
      void invalidateAll();
    }, 5000);
    return () => clearInterval(t);
  });

  function statusLabel(s: string | null | undefined) {
    const key = s || 'ready';
    return $_(`app.knowledge.status.${key}`, { default: key });
  }

  async function openDoc(id: string) {
    selectedId = id;
    showChunks = false;
    editMd = false;
    detail = null;
    detailLoading = true;
    try {
      const res = await fetch(`/app/${$page.params.brand}/knowledge/${id}`);
      detail = res.ok ? await res.json() : null;
      mdDraft = (detail?.document?.markdown as string | null) ?? '';
    } finally {
      detailLoading = false;
    }
  }

  function openMemSettings(m: (typeof settingsMem) & object) {
    settingsMem = m;
    settingsOpen = true;
  }

  function renderMd(md: string) {
    try {
      return marked.parse(md || '', { async: false }) as string;
    } catch {
      return md;
    }
  }

  function formatBytes(n: number | null | undefined) {
    if (n == null) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<svelte:head>
  <title>Anomalia — {$_('app.hub.brand.knowledge')}</title>
</svelte:head>

<div class="content knowledge-page">
  <PageHead title={$_('app.knowledge.title')} subtitle={$_('app.knowledge.subtitle')} />

  {#if form?.error}
    <p class="banner err">{form.error}</p>
  {/if}

  <section class="block panel">
    <div class="sec-head">
      <div>
        <h3>{$_('app.knowledge.sources.title')}</h3>
        <p class="muted">{$_('app.knowledge.sources.desc')}</p>
      </div>
      {#if $page.data.flags?.connectors !== false}
        <a class="btn ghost" href={connectorsSettingsHref(brandSlug)}>
          {$_('app.knowledge.sources.manageInSettings')} →
        </a>
      {/if}
    </div>
    {#if sources.length}
      <p class="source-summary">
        {#each sources as src (src.provider)}
          {@const githubRepos = src.provider === 'github' ? parseGithubRepoSelection(src.settings) : []}
          {@const driveFiles = src.provider === 'google-drive' ? parseDriveFileSelection(src.settings) : []}
          {@const driveFolders = src.provider === 'google-drive' ? parseDriveFolderSelection(src.settings) : []}
          {@const drivePicked = [...driveFiles, ...driveFolders]}
          {@const notionPages = src.provider === 'notion' ? parseNotionPageSelection(src.settings) : []}
          <span class="chip status-{src.status === 'active' ? 'ready' : src.status === 'error' ? 'failed' : 'pending'}">
            {$_(`app.knowledge.sources.providers.${src.provider}`)}
            ·
            {#if src.provider === 'github' && !githubRepos.length}
              {$_('app.knowledge.sources.github.noneSelected')}
            {:else if src.provider === 'google-drive' && !drivePicked.length}
              {$_('app.knowledge.sources.drive.noneSelected')}
            {:else if src.provider === 'notion' && !notionPages.length}
              {$_('app.knowledge.sources.notion.noneSelected')}
            {:else}
              {$_(`app.knowledge.sources.status.${src.status}`, { default: src.status })}
              {#if githubRepos.length}
                · {githubRepos.join(', ')}
              {:else if drivePicked.length}
                · {drivePicked.map((f) => f.name).join(', ')}
              {:else if notionPages.length}
                · {notionPages.map((p) => p.title).join(', ')}
              {/if}
            {/if}
          </span>
        {/each}
      </p>
    {/if}
  </section>

  <!-- A. Corpus -->
  <section class="block panel">
    <div class="sec-head">
      <div>
        <h3>{$_('app.knowledge.corpus')}</h3>
        <p class="muted">{$_('app.knowledge.corpusDesc')}</p>
      </div>
      <a class="btn primary add-cta" href={`/app/${brandSlug}/knowledge/new`}>
        <Plus size={16} strokeWidth={2} />
        {$_('app.knowledge.addDocument')}
      </a>
    </div>

    {#if documents.length === 0}
      <div class="empty-box">
        <p class="muted">{$_('app.knowledge.emptyDocs')}</p>
        <a class="btn ghost" href={`/app/${brandSlug}/knowledge/new`}>{$_('app.knowledge.addDocument')}</a>
      </div>
    {:else}
      <div class="toolbar">
        <input
          class="doc-search"
          type="search"
          bind:value={docQuery}
          placeholder={$_('app.knowledge.searchDocs')}
        />
        <div class="chips">
          <button type="button" class="chip-btn" class:active={docFilter === 'all'} onclick={() => (docFilter = 'all')}>
            {$_('app.knowledge.allCollections')} ({documents.length})
          </button>
          {#each [...collectionCounts.entries()] as [c, n] (c)}
            <button type="button" class="chip-btn" class:active={docFilter === c} onclick={() => (docFilter = c)}>
              {$_(`app.knowledge.collection.${c}`, { default: c })} ({n})
            </button>
          {/each}
        </div>
      </div>
      <ul class="doc-list">
        {#each visibleDocuments as d (d.id)}
          <li class="doc-row" data-doc-id={d.id}>
            <button type="button" class="doc-main" onclick={() => openDoc(d.id)}>
              <span class="chip status-{d.status ?? 'ready'}">{statusLabel(d.status)}</span>
              <span class="doc-title">{d.title || d.file_name || $_('app.knowledge.untitled')}</span>
              {#if d.collection}
                <span class="chip coll">{$_(`app.knowledge.collection.${d.collection}`, { default: d.collection })}</span>
              {/if}
              {#if isConnectorSourceType(d.source_type)}
                <span class="chip coll">{$_(`app.knowledge.sources.chip.${d.source_type}`)}</span>
              {/if}
              <span class="muted meta">{d.chunk_count ?? 0} {$_('app.knowledge.chunks')} · {formatBytes(d.bytes)}</span>
            </button>
            <div class="doc-actions">
              <form method="POST" action="?/reprocess" use:enhance={withBusy}>
                <input type="hidden" name="id" value={d.id} />
                <button class="btn soft" type="submit" disabled={busy}>{$_('app.knowledge.reprocess')}</button>
              </form>
              <form method="POST" action="?/deleteDocument" use:enhance={withBusy}>
                <input type="hidden" name="id" value={d.id} />
                <button class="btn danger" type="submit" disabled={busy}>{$_('app.knowledge.delete')}</button>
              </form>
            </div>
            {#if d.error}<p class="banner err tiny">{d.error}</p>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- B. Memory -->
  <section class="block panel">
    <div class="sec-head">
      <div>
        <h3>{$_('app.knowledge.memory')}</h3>
        <p class="muted">{$_('app.knowledge.memoryDesc')}</p>
      </div>
      <a class="btn primary add-cta" href={`/app/${brandSlug}/knowledge/memory/new`}>
        <Plus size={16} strokeWidth={2} />
        {$_('app.knowledge.addMemory')}
      </a>
    </div>

    <div class="filters">
      {#each ['all', 'skill', 'fact', 'constraint', 'preference', 'voice', 'insight'] as cat}
        <button type="button" class="subtab" class:active={memoryFilter === cat} onclick={() => (memoryFilter = cat)}>{cat}</button>
      {/each}
    </div>

    {#if filteredMemories.length === 0}
      <div class="empty-box">
        <p class="muted">{$_('app.knowledge.emptyMemory')}</p>
        <a class="btn ghost" href={`/app/${brandSlug}/knowledge/memory/new`}>{$_('app.knowledge.addMemory')}</a>
      </div>
    {:else}
      <Tooltip.Provider>
      <div class="mem-grid">
        {#each pagedMemories as m (m.id)}
          <article class="mem-card" class:conflict={contradict.has(m.id)} class:pinned={m.pinned}>
            <div class="mem-card-top">
              <span class="chip">{m.category}</span>
              <!-- Una nota di MESTIERE di un agente, non conoscenza del brand: senza questo
                   distintivo le due cose sono indistinguibili in questa griglia. -->
              {#if m.agent}<span class="chip">{m.agent.replace('custom:', '')}</span>{/if}
              {#if m.pinned}<span class="pin-badge"><Pin size={12} strokeWidth={2.5} /></span>{/if}
              {#if contradict.has(m.id)}<span class="chip bad">{$_('app.knowledge.contradicts')}</span>{/if}
              <button
                type="button"
                class="icon-btn"
                title={$_('app.knowledge.memSettings')}
                aria-label={$_('app.knowledge.memSettings')}
                onclick={() => openMemSettings(m)}
              >
                <Settings2 size={15} strokeWidth={2} />
              </button>
            </div>
            <p class="mem-value">{m.value}</p>
            <div class="mem-footer">
              <Tooltip.Root>
                <Tooltip.Trigger
                  type="button"
                  class="mem-stat"
                  aria-label={$_('app.knowledge.confidenceTip')}
                >
                  <BadgeCheck size={11} strokeWidth={2} />
                  {Math.round((m.confidence ?? 0) * 100)}%
                </Tooltip.Trigger>
                <Tooltip.Content side="top">{$_('app.knowledge.confidenceTip')}</Tooltip.Content>
              </Tooltip.Root>
              <Tooltip.Root>
                <Tooltip.Trigger
                  type="button"
                  class="mem-stat"
                  aria-label={$_('app.knowledge.usedTip')}
                >
                  <Sparkles size={11} strokeWidth={2} />
                  {m.times_used ?? 0}
                </Tooltip.Trigger>
                <Tooltip.Content side="top">{$_('app.knowledge.usedTip')}</Tooltip.Content>
              </Tooltip.Root>
            </div>
          </article>
        {/each}
      </div>
      </Tooltip.Provider>

      {#if memPageCount > 1}
        <div class="pager">
          <button type="button" class="btn ghost" disabled={memPage === 0} onclick={() => (memPage = Math.max(0, memPage - 1))}>
            {$_('app.knowledge.prevPage')}
          </button>
          <span class="muted">
            {$_('app.knowledge.pageOf', { values: { page: memPage + 1, pages: memPageCount, total: filteredMemories.length } })}
          </span>
          <button
            type="button"
            class="btn ghost"
            disabled={memPage >= memPageCount - 1}
            onclick={() => (memPage = Math.min(memPageCount - 1, memPage + 1))}
          >
            {$_('app.knowledge.nextPage')}
          </button>
        </div>
      {/if}
    {/if}
  </section>
</div>

{#if selected}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="drawer-backdrop" onclick={() => (selectedId = null)}></div>
  <aside class="drawer" role="dialog" aria-label={selected.title || 'Document'}>
    <header class="drawer-head">
      <div class="drawer-head-copy">
        <h3>{selected.title || selected.file_name || $_('app.knowledge.untitled')}</h3>
        <div class="drawer-meta">
          <span class="chip status-{selected.status ?? 'ready'}">{statusLabel(selected.status)}</span>
          <span class="muted">{selected.chunk_count ?? 0} {$_('app.knowledge.chunks')}</span>
          {#if selected.collection}
            <span class="chip coll">{$_(`app.knowledge.collection.${selected.collection}`, { default: selected.collection })}</span>
          {/if}
        </div>
      </div>
      <button type="button" class="btn ghost icon-close" onclick={() => (selectedId = null)} aria-label="Close">×</button>
    </header>

    {#if selected.summary}
      <section class="drawer-section">
        <h4 class="drawer-sec-title">{$_('app.knowledge.docSummary')}</h4>
        <p class="summary">{selected.summary}</p>
      </section>
    {/if}

    <section class="drawer-section">
      <h4 class="drawer-sec-title">{$_('app.knowledge.docActions')}</h4>
      <div class="drawer-tools">
        <button type="button" class="btn soft" class:active={showChunks && !editMd} onclick={() => { showChunks = !showChunks; if (showChunks) editMd = false; }}>
          {showChunks ? $_('app.knowledge.hideChunks') : $_('app.knowledge.showChunks')}
        </button>
        <button type="button" class="btn soft" class:active={editMd} onclick={() => { editMd = !editMd; if (editMd) showChunks = false; }}>
          {editMd ? $_('app.knowledge.preview') : $_('app.knowledge.editMd')}
        </button>
      </div>
      <form method="POST" action="?/setCollection" use:enhance={withBusy} class="coll-form">
        <label class="coll-label">
          <span>{$_('app.knowledge.docCollection')}</span>
          <input type="hidden" name="id" value={selected.id} />
          <select name="collection" value={selected.collection ?? ''} onchange={(e) => (e.currentTarget.form as HTMLFormElement)?.requestSubmit()}>
            <option value="">{$_('app.knowledge.noCollection')}</option>
            {#each COLLECTIONS as c (c)}
              <option value={c}>{$_(`app.knowledge.collection.${c}`, { default: c })}</option>
            {/each}
          </select>
        </label>
      </form>
    </section>

    <section class="drawer-section drawer-content">
      <h4 class="drawer-sec-title">
        {#if showChunks}
          {$_('app.knowledge.docChunks')}
        {:else if editMd}
          {$_('app.knowledge.editMd')}
        {:else}
          {$_('app.knowledge.docContent')}
        {/if}
      </h4>
      {#if detailLoading}
        <p class="muted">{$_('app.knowledge.loading')}</p>
      {:else if showChunks}
        <ul class="chunk-list">
          {#each selectedChunks as c (c.id)}
            <li>
              <div class="chunk-path">{c.heading_path || '—'}</div>
              <pre>{c.content}</pre>
            </li>
          {:else}
            <li class="chunk-empty"><p class="muted">{$_('app.knowledge.loading')}</p></li>
          {/each}
        </ul>
      {:else if editMd}
        <form method="POST" action="?/saveMarkdown" use:enhance={withBusy} class="stack">
          <input type="hidden" name="id" value={selected.id} />
          <textarea name="markdown" rows="18" bind:value={mdDraft}></textarea>
          <button class="btn primary" type="submit" disabled={busy}>{$_('app.knowledge.saveReprocess')}</button>
        </form>
      {:else}
        <div class="md-body">{@html renderMd(selectedMarkdown)}</div>
      {/if}
    </section>
  </aside>
{/if}

<Dialog.Root bind:open={settingsOpen}>
  <Dialog.Content class="mem-dialog flex flex-col sm:max-w-md">
    {#if settingsMem}
      <div class="mem-dialog-body">
        <Dialog.Header class="mem-dialog-head">
          <Dialog.Title>{$_('app.knowledge.memSettings')}</Dialog.Title>
          <Dialog.Description class="sr-only">{$_('app.knowledge.memSettingsDesc')}</Dialog.Description>
        </Dialog.Header>

        <section class="ms-box ms-fact">
          <div class="ms-box-label">
            <span class="chip">{settingsMem.category}</span>
            {#if settingsMem.pinned}<span class="pin-badge"><Pin size={12} strokeWidth={2.5} /></span>{/if}
          </div>
          <p class="ms-fact-text">{settingsMem.value}</p>
        </section>

        <section class="ms-box">
          <h4 class="ms-box-title">{$_('app.knowledge.memPrefs')}</h4>

          <form method="POST" action="?/updateMemory" use:enhance={withBusy} class="ms-block">
            <input type="hidden" name="id" value={settingsMem.id} />
            <input type="hidden" name="pinned" value={settingsMem.pinned ? 'false' : 'true'} />
            <div class="ms-block-head">
              <span class="ms-row-icon"><Pin size={16} strokeWidth={2} /></span>
              <div class="ms-block-copy">
                <div class="ms-row-title">{$_('app.knowledge.pin')}</div>
                <p class="ms-row-hint">{$_('app.knowledge.pinHint')}</p>
              </div>
            </div>
            <button class="btn ghost ms-full-btn" type="submit" disabled={busy}>
              {settingsMem.pinned ? $_('app.knowledge.unpin') : $_('app.knowledge.pin')}
            </button>
          </form>

          <div class="ms-divider"></div>

          <form method="POST" action="?/updateMemory" use:enhance={withBusy} class="ms-block">
            <input type="hidden" name="id" value={settingsMem.id} />
            <div class="ms-block-head">
              <span class="ms-row-icon">★</span>
              <div class="ms-block-copy">
                <div class="ms-row-title">{$_('app.knowledge.importance')}</div>
                <p class="ms-row-hint">{$_('app.knowledge.importanceHint')}</p>
              </div>
            </div>
            <select
              class="ms-select ms-full-select"
              name="importance"
              onchange={(e) => (e.currentTarget.form?.requestSubmit())}
            >
              {#each [1, 2, 3, 4, 5] as n}
                <option value={n} selected={(settingsMem.importance ?? 3) === n}>{n}</option>
              {/each}
            </select>
          </form>
        </section>

        <section class="ms-box ms-danger">
          <h4 class="ms-box-title">{$_('app.knowledge.memDanger')}</h4>
          <form method="POST" action="?/deleteMemory" use:enhance={withBusy} class="ms-block">
            <input type="hidden" name="id" value={settingsMem.id} />
            <div class="ms-block-head">
              <span class="ms-row-icon danger"><Trash2 size={16} strokeWidth={2} /></span>
              <div class="ms-block-copy">
                <div class="ms-row-title">{$_('app.knowledge.delete')}</div>
                <p class="ms-row-hint">{$_('app.knowledge.deleteMemHint')}</p>
              </div>
            </div>
            <button class="btn ghost ms-full-btn danger" type="submit" disabled={busy}>
              {$_('app.knowledge.delete')}
            </button>
          </form>
        </section>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  .knowledge-page { max-width: var(--content-max, 960px); }

  /* —— Buttons (page-local; global .btn has no variants) —— */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
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
    transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
  }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn.sm { padding: 6px 10px; font-size: 12px; border-radius: 8px; }
  .btn.primary {
    background: var(--invert-surface, #1d1d1f);
    color: #fff;
    border-color: var(--invert-surface, #1d1d1f);
  }
  .btn.primary:hover:not(:disabled) { filter: brightness(1.15); }
  .btn.ghost {
    background: var(--paper, #fff);
    color: var(--ink, #1d1d1f);
    border-color: var(--line, #e5e5e8);
  }
  .btn.ghost:hover:not(:disabled) { background: var(--paper-2, #f5f5f7); }
  .btn.soft {
    background: var(--paper-2, #f5f5f7);
    color: var(--ink, #1d1d1f);
    border-color: var(--line, #e5e5e8);
  }
  .btn.soft:hover:not(:disabled) {
    background: var(--paper-3, #f4f4f4);
  }
  .btn.danger {
    background: color-mix(in srgb, #a11 14%, var(--paper, #fff));
    color: #a11;
    border-color: color-mix(in srgb, #a11 28%, var(--line, #e5e5e8));
  }
  .btn.danger:hover:not(:disabled) {
    background: color-mix(in srgb, #a11 22%, var(--paper, #fff));
  }
  :global(:root[data-theme='dark']) .btn.primary {
    background: var(--accent, #c485fe);
    color: #0a0a0a;
    border-color: var(--accent, #c485fe);
  }
  :global(:root[data-theme='dark']) .btn.primary:hover:not(:disabled) {
    background: var(--accent-2, #ecb2ed);
    filter: none;
  }
  :global(:root[data-theme='dark']) .btn.danger {
    color: #ff8f8f;
  }
  .btn.link {
    background: var(--paper-2, #f5f5f7);
    color: var(--ink-soft, #6e6e73);
    border-color: var(--line, #e5e5e8);
    padding: 6px 10px;
    font-weight: 600;
  }

  .page-head {
    display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between;
    gap: 12px; margin-bottom: 8px;
  }
  .page-sub, .muted { color: var(--ink-soft); font-size: 13px; margin: 0; }

  .block { margin: 20px 0; }
  .panel {
    border: 1px solid var(--line, #e5e5e8);
    border-radius: 14px;
    background: var(--paper, #fff);
    padding: 18px;
  }
  .block h3 { font-size: 16px; margin: 0 0 4px; }
  .sec-head {
    display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between;
    gap: 12px; margin-bottom: 14px;
  }
  .add-cta { white-space: nowrap; }

  .source-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0;
  }

  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: 12px;
    background: var(--paper-2, #f5f5f7);
    border: 1px solid var(--line, #e5e5e8);
    margin-bottom: 12px;
  }
  .doc-search {
    width: 100%;
    border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px;
    background: var(--paper); color: var(--ink); font: inherit; box-sizing: border-box;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip-btn {
    appearance: none;
    border: 1px solid var(--line, #e5e5e8);
    background: var(--paper, #fff);
    border-radius: 999px;
    padding: 5px 11px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    color: var(--ink-soft, #6e6e73);
  }
  .chip-btn.active {
    background: var(--invert-surface, #1d1d1f);
    color: #fff;
    border-color: transparent;
  }
  :global(:root[data-theme='dark']) .chip-btn.active {
    background: var(--accent, #c485fe);
    color: #0a0a0a;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px;
    margin: 0 0 14px;
    border-radius: 12px;
    background: var(--paper-2, #f5f5f7);
    border: 1px solid var(--line, #e5e5e8);
  }
  .subtab {
    border: none;
    background: transparent;
    border-radius: 8px;
    padding: 7px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    color: var(--ink-soft);
  }
  .subtab.active {
    background: var(--paper, #fff);
    color: var(--ink);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  .empty-box {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 16px;
    border-radius: 12px;
    background: var(--paper-2, #f5f5f7);
    border: 1px dashed var(--line, #e5e5e8);
  }

  .stack { display: flex; flex-direction: column; gap: 8px; }
  .doc-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
  .doc-row {
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 12px 14px;
    background: var(--paper-2, #fafafa);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .doc-main {
    all: unset;
    cursor: pointer;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    width: 100%;
  }
  .doc-title { font-weight: 600; color: var(--ink); }
  .doc-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    padding-top: 10px;
    border-top: 1px solid var(--line, #e5e5e8);
  }
  .meta { font-size: 11px; }
  .chip {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
    padding: 2px 6px; border-radius: 999px; background: var(--paper, #fff); color: var(--ink-soft);
    border: 1px solid var(--line, #e5e5e8);
  }
  .chip.bad { background: #fde8e8; color: #a11; border-color: transparent; }
  .chip.coll { font-size: 11px; opacity: 0.85; }
  .status-pending, .status-processing { background: #fff4d6; color: #8a6a00; border-color: transparent; }
  .status-failed { background: #fde8e8; color: #a11; border-color: transparent; }
  .status-ready { background: #e7f6ec; color: #1a7a3a; border-color: transparent; }
  .banner.err { color: #a11; font-size: 13px; }
  .banner.err.tiny { margin: 0; font-size: 12px; }

  .mem-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
  }
  .mem-card {
    border: 1px solid var(--line); border-radius: 12px; padding: 12px;
    background: var(--paper-2, #fafafa); display: flex; flex-direction: column; gap: 8px; min-height: 140px;
  }
  .mem-card.conflict { border-color: #c44; }
  .mem-card.pinned { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent, #5b5fc7) 35%, transparent); }
  .mem-card-top { display: flex; align-items: center; gap: 6px; }
  .mem-card-top .icon-btn { margin-left: auto; }
  .pin-badge { color: var(--accent, #5b5fc7); flex-shrink: 0; display: inline-flex; }
  .mem-value {
    margin: 0; font-size: 14px; line-height: 1.45; color: var(--ink); font-weight: 500;
    display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
    flex: 1;
  }
  .mem-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: auto;
    padding-top: 4px;
  }
  .mem-footer :global(.mem-stat) {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    gap: 3px;
    border: none;
    background: transparent;
    padding: 0;
    margin: 0;
    font-size: 10px;
    font-weight: 500;
    line-height: 1;
    color: var(--ink-soft, #6e6e73);
    opacity: 0.85;
    cursor: help;
    white-space: nowrap;
  }
  .mem-footer :global(.mem-stat svg) {
    width: 11px;
    height: 11px;
    flex-shrink: 0;
    display: block;
  }
  .icon-btn {
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    border-radius: 8px;
    color: var(--ink-soft);
    background: var(--paper, #fff);
    border: 1px solid var(--line, #e5e5e8);
  }
  .icon-btn:hover { background: var(--paper-2); color: var(--ink); }
  .pager {
    display: flex; align-items: center; justify-content: center; gap: 14px;
    margin-top: 16px; flex-wrap: wrap;
    padding-top: 14px;
    border-top: 1px solid var(--line, #e5e5e8);
  }

  .mem-dialog-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    min-width: 0;
  }
  .ms-box {
    border: 1px solid var(--line, #e5e5e8);
    border-radius: 12px;
    background: var(--paper, #fff);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    box-sizing: border-box;
  }
  .ms-fact { background: var(--paper-2, #f5f5f7); gap: 10px; }
  .ms-danger {
    border-color: color-mix(in srgb, #a11 28%, var(--line, #e5e5e8));
    background: color-mix(in srgb, #a11 4%, var(--paper, #fff));
  }
  .ms-box-label { display: flex; align-items: center; gap: 8px; }
  .ms-box-title {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-soft, #6e6e73);
  }
  .ms-fact-text {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    color: var(--ink, #1d1d1f);
    font-weight: 500;
    /* A skill's value is a multi-line procedure — collapsing it would run the steps together. */
    white-space: pre-line;
  }
  .ms-block {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }
  .ms-block-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
  }
  .ms-block-copy { min-width: 0; flex: 1; }
  .ms-row-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--paper-2, #f5f5f7);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-soft, #6e6e73);
    flex-shrink: 0;
    font-size: 13px;
  }
  .ms-row-icon.danger {
    background: color-mix(in srgb, #a11 10%, transparent);
    color: #a11;
  }
  .ms-row-title { font-size: 13px; font-weight: 600; color: var(--ink, #1d1d1f); line-height: 1.3; }
  .ms-row-hint { margin: 2px 0 0; font-size: 12px; line-height: 1.35; color: var(--ink-soft, #6e6e73); }
  .ms-full-btn { width: 100%; }
  .ms-full-btn.danger {
    background: color-mix(in srgb, #a11 14%, var(--paper, #fff));
    color: #c44;
    border-color: color-mix(in srgb, #a11 28%, var(--line, #e5e5e8));
  }
  :global(:root[data-theme='dark']) .ms-full-btn.danger {
    color: #ff8f8f;
  }
  .ms-select {
    border: 1px solid var(--line, #e5e5e8);
    border-radius: 8px;
    padding: 8px 10px;
    background: var(--paper, #fff);
    color: var(--ink, #1d1d1f);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
  }
  .ms-full-select { width: 100%; box-sizing: border-box; }
  .ms-divider {
    height: 1px;
    background: var(--line, #e5e5e8);
    margin: 0;
  }
  :global(.mem-dialog) {
    display: flex !important;
    flex-direction: column !important;
    align-items: stretch !important;
    padding: 20px !important;
    gap: 0 !important;
    width: min(100%, 28rem) !important;
  }
  :global(.mem-dialog-head) {
    padding-right: 28px;
    text-align: left;
    width: 100%;
  }

  .drawer-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.25); z-index: 40; }
  .drawer {
    position: fixed; top: 0; right: 0; width: min(540px, 100vw); height: 100vh; z-index: 41;
    background: var(--paper); border-left: 1px solid var(--line);
    padding: 28px 28px 36px;
    overflow: auto;
    box-shadow: -8px 0 24px rgba(0,0,0,0.08);
    display: flex;
    flex-direction: column;
    gap: 0;
    box-sizing: border-box;
  }
  .drawer-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
    padding-bottom: 18px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--line, #e5e5e8);
  }
  .drawer-head-copy { min-width: 0; flex: 1; }
  .drawer-head h3 {
    margin: 0 0 10px;
    font-size: 1.15rem;
    line-height: 1.3;
    word-break: break-word;
  }
  .drawer-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .icon-close {
    width: 36px;
    height: 36px;
    padding: 0;
    font-size: 20px;
    line-height: 1;
    flex-shrink: 0;
  }
  .drawer-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px 0;
    border-bottom: 1px solid var(--line, #e5e5e8);
  }
  .drawer-section:last-child { border-bottom: none; padding-bottom: 0; }
  .drawer-sec-title {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-soft, #6e6e73);
  }
  .drawer-tools {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .drawer-tools .btn.soft.active {
    background: var(--invert-surface, #1d1d1f);
    color: #fff;
    border-color: var(--invert-surface, #1d1d1f);
  }
  :global(:root[data-theme='dark']) .drawer-tools .btn.soft.active {
    background: var(--accent, #c485fe);
    color: #0a0a0a;
    border-color: var(--accent, #c485fe);
  }
  .coll-form { margin: 0; }
  .coll-label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .coll-form select {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 9px 12px;
    background: var(--paper-2, #f5f5f7);
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    width: 100%;
    box-sizing: border-box;
  }
  .summary {
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink-soft);
    margin: 0;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--paper-2);
    border: 1px solid var(--line, #e5e5e8);
  }
  .drawer-content { flex: 1; min-height: 0; }
  .md-body {
    padding: 14px;
    border-radius: 12px;
    background: var(--paper-2, #f5f5f7);
    border: 1px solid var(--line, #e5e5e8);
  }
  .md-body :global(h1), .md-body :global(h2), .md-body :global(h3) { margin-top: 1em; }
  .md-body :global(h1:first-child), .md-body :global(h2:first-child), .md-body :global(h3:first-child) { margin-top: 0; }
  .md-body :global(p) { line-height: 1.5; }
  .chunk-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
  .chunk-list li {
    border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px;
    background: var(--paper-2);
  }
  .chunk-path { font-size: 11px; font-weight: 700; color: var(--ink-soft); margin-bottom: 6px; }
  .chunk-list pre, .md-body { white-space: pre-wrap; font-size: 12px; line-height: 1.45; }
  .chunk-empty { background: transparent !important; border-style: dashed !important; }
  .stack textarea {
    border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--paper);
    color: var(--ink); font: inherit; width: 100%; box-sizing: border-box;
  }

  @media (max-width: 720px) {
    .panel { padding: 14px; }
    .drawer { padding: 22px 20px 28px; }
  }
</style>
