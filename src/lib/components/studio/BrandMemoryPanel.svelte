<script lang="ts">
  import { page } from '$app/stores';
  import { _ } from 'svelte-i18n';
  import {
    buildMemoryGraph,
    layoutMemoryGraph,
    type MemoryGraphNode
  } from '$lib/memory-graph';

  type MemoryRow = MemoryGraphNode & {
    id: string;
    created_at?: string;
    last_used_at?: string | null;
  };

  const PAGE_SIZE = 12;
  const CAT_COLORS: Record<string, string> = {
    voice: '#7c5cff',
    constraint: '#c0392b',
    fact: '#2563eb',
    preference: '#059669',
    insight: '#d97706'
  };

  let memoryEntries = $state<MemoryRow[]>([]);
  let memoryLoading = $state(false);
  let memoryExpanded = $state<Record<string, boolean>>({});
  let newMemoryKey = $state('');
  let newMemoryValue = $state('');
  let newMemoryCategory = $state('fact');
  let view = $state<'list' | 'graph'>('list');
  let pageIndex = $state(0);
  let categoryFilter = $state<string>('all');
  let selectedId = $state<string | null>(null);

  const filtered = $derived(
    categoryFilter === 'all'
      ? memoryEntries
      : memoryEntries.filter((m) => m.category === categoryFilter)
  );
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const pageItems = $derived(
    filtered.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE)
  );

  $effect(() => {
    // Reset page when filter or dataset changes.
    void filtered.length;
    void categoryFilter;
    if (pageIndex >= pageCount) pageIndex = 0;
  });

  const graph = $derived(buildMemoryGraph(filtered));
  const W = 640;
  const H = 420;
  const positions = $derived(layoutMemoryGraph(graph.nodes, W, H));
  const selected = $derived(memoryEntries.find((m) => m.id === selectedId) ?? null);

  async function fetchMemory() {
    memoryLoading = true;
    try {
      const slug = $page.params.brand;
      const res = await fetch(`/api/v1/brands/${slug}/studio/memory`);
      const data = await res.json();
      memoryEntries = (data.entries ?? []).map((e: MemoryRow) => ({
        ...e,
        times_used: e.times_used ?? 0,
        times_reinforced: e.times_reinforced ?? 0
      }));
    } catch {
      /* ignore */
    }
    memoryLoading = false;
  }

  async function addMemoryEntry() {
    if (!newMemoryKey.trim() || !newMemoryValue.trim()) return;
    const slug = $page.params.brand;
    await fetch(`/api/v1/brands/${slug}/studio/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: newMemoryKey,
        value: newMemoryValue,
        category: newMemoryCategory
      })
    });
    newMemoryKey = '';
    newMemoryValue = '';
    await fetchMemory();
  }

  async function deleteMemoryEntry(id: string) {
    const slug = $page.params.brand;
    await fetch(`/api/v1/brands/${slug}/studio/memory/${id}`, { method: 'DELETE' });
    if (selectedId === id) selectedId = null;
    await fetchMemory();
  }

  $effect(() => {
    if (!memoryEntries.length && !memoryLoading) fetchMemory();
  });

  function meta(m: MemoryRow) {
    const used = m.times_used ?? 0;
    const rein = m.times_reinforced ?? 0;
    return `conf ${Math.round(m.confidence * 100)}% · ${m.source} · used ${used}× · reinforced ${rein}×`;
  }
</script>

<section class="card span2 memory-panel">
  <div class="section-head">
    <div class="kt" style="margin-bottom:0;">{$_('app.studio.memory.title', { default: 'Brand Memory' })}</div>
    <div class="memory-actions">
      <div class="view-toggle" role="tablist">
        <button
          type="button"
          class="view-btn"
          class:active={view === 'list'}
          role="tab"
          aria-selected={view === 'list'}
          onclick={() => (view = 'list')}
        >
          {$_('app.studio.memory.viewList', { default: 'List' })}
        </button>
        <button
          type="button"
          class="view-btn"
          class:active={view === 'graph'}
          role="tab"
          aria-selected={view === 'graph'}
          onclick={() => (view = 'graph')}
        >
          {$_('app.studio.memory.viewGraph', { default: 'Graph' })}
        </button>
      </div>
      <button class="btn ghost" type="button" onclick={fetchMemory} disabled={memoryLoading}>
        {memoryLoading ? '...' : $_('app.studio.memory.refresh', { default: 'Refresh' })}
      </button>
    </div>
  </div>

  <p class="muted" style="margin-top:6px;margin-bottom:12px;">
    {$_('app.studio.memory.desc', {
      default:
        'Structured facts the AI has learned about your brand. “Used” counts how many times an entry was injected into an AI prompt; “reinforced” counts how many times it was rewritten or confirmed.'
    })}
  </p>

  {#if memoryEntries.length}
    <div class="memory-filters">
      <label class="filter-label">
        <span>{$_('app.studio.memory.filterCategory', { default: 'Category' })}</span>
        <select bind:value={categoryFilter}>
          <option value="all">{$_('app.studio.memory.allCategories', { default: 'All' })}</option>
          <option value="fact">Fact</option>
          <option value="constraint">Constraint</option>
          <option value="preference">Preference</option>
          <option value="voice">Voice</option>
          <option value="insight">Insight</option>
        </select>
      </label>
      <span class="muted filter-count">
        {$_('app.studio.memory.count', {
          values: { shown: view === 'list' ? pageItems.length : filtered.length, total: filtered.length },
          default: '{shown} of {total}'
        })}
      </span>
    </div>
  {/if}

  {#if view === 'list'}
    {#if pageItems.length}
      <ul class="source-list">
        {#each pageItems as m (m.id)}
          <li class="source-item">
            <div class="source-row">
              <span class="source-kind" style={`background:${CAT_COLORS[m.category] ?? '#888'}22;color:${CAT_COLORS[m.category] ?? '#888'}`}>{m.category}</span>
              <span class="source-title" style="font-weight:600;">{m.key}</span>
              <span class="muted" style="font-size:0.75rem;">{meta(m)}</span>
              <button class="btn link" type="button" onclick={() => (memoryExpanded[m.id] = !memoryExpanded[m.id])}>
                {memoryExpanded[m.id]
                  ? $_('app.studio.hideContent', { default: 'Hide' })
                  : $_('app.studio.viewContent', { default: 'View' })}
              </button>
              <button class="btn link" type="button" onclick={() => deleteMemoryEntry(m.id)}>
                {$_('app.studio.remove', { default: 'Remove' })}
              </button>
            </div>
            {#if memoryExpanded[m.id]}
              <pre class="source-content">{m.value}</pre>
            {/if}
          </li>
        {/each}
      </ul>

      {#if pageCount > 1}
        <div class="pager">
          <button
            class="btn ghost"
            type="button"
            disabled={pageIndex === 0}
            onclick={() => (pageIndex = Math.max(0, pageIndex - 1))}
          >
            {$_('app.studio.memory.prev', { default: 'Previous' })}
          </button>
          <span class="muted">
            {$_('app.studio.memory.page', {
              values: { page: pageIndex + 1, pages: pageCount },
              default: 'Page {page} / {pages}'
            })}
          </span>
          <button
            class="btn ghost"
            type="button"
            disabled={pageIndex >= pageCount - 1}
            onclick={() => (pageIndex = Math.min(pageCount - 1, pageIndex + 1))}
          >
            {$_('app.studio.memory.next', { default: 'Next' })}
          </button>
        </div>
      {/if}
    {:else if !memoryLoading}
      <p class="muted">{$_('app.studio.memory.empty', { default: 'No memory entries yet. The AI will learn about your brand as you chat and run research.' })}</p>
    {/if}
  {:else if filtered.length}
    <div class="graph-wrap">
      <svg class="memory-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={$_('app.studio.memory.graphLabel', { default: 'Memory correlation graph' })}>
        {#each graph.edges as e (e.sourceId + e.targetId)}
          {@const a = positions.get(e.sourceId)}
          {@const b = positions.get(e.targetId)}
          {#if a && b}
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              class="graph-edge"
              class:strong={e.reason === 'tokens'}
              stroke-width={e.reason === 'tokens' ? 1.5 + e.weight * 0.4 : 1}
            />
          {/if}
        {/each}
        {#each graph.nodes as n (n.id)}
          {@const p = positions.get(n.id)}
          {#if p}
            <g
              class="graph-node"
              class:selected={selectedId === n.id}
              transform={`translate(${p.x}, ${p.y})`}
              onclick={() => (selectedId = n.id)}
              onkeydown={(ev) => ev.key === 'Enter' && (selectedId = n.id)}
              role="button"
              tabindex="0"
            >
              <circle
                r={8 + Math.min(10, Math.log2(1 + (n.times_used ?? 0)) * 3)}
                fill={CAT_COLORS[n.category] ?? '#888'}
                opacity="0.92"
              />
              <title>{n.key}: {n.value}</title>
              <text y="22" text-anchor="middle">{n.key.length > 16 ? n.key.slice(0, 14) + '…' : n.key}</text>
            </g>
          {/if}
        {/each}
      </svg>

      <div class="graph-legend">
        {#each Object.entries(CAT_COLORS) as [cat, color] (cat)}
          <span class="legend-item"><i style={`background:${color}`}></i>{cat}</span>
        {/each}
        <span class="legend-item soft">{$_('app.studio.memory.edgeCategory', { default: 'Soft line = same category' })}</span>
        <span class="legend-item soft">{$_('app.studio.memory.edgeTokens', { default: 'Strong line = shared terms' })}</span>
      </div>

      {#if selected}
        <div class="graph-detail">
          <div class="source-row">
            <span class="source-kind" style={`background:${CAT_COLORS[selected.category] ?? '#888'}22;color:${CAT_COLORS[selected.category] ?? '#888'}`}>{selected.category}</span>
            <span class="source-title" style="font-weight:600;">{selected.key}</span>
            <span class="muted" style="font-size:0.75rem;">{meta(selected)}</span>
          </div>
          <pre class="source-content">{selected.value}</pre>
          {#if graph.edges.some((e) => e.sourceId === selected.id || e.targetId === selected.id)}
            <div class="related">
              <div class="kt" style="margin-bottom:6px;font-size:0.75rem;">
                {$_('app.studio.memory.related', { default: 'Related' })}
              </div>
              <ul>
                {#each graph.edges.filter((e) => e.sourceId === selected.id || e.targetId === selected.id) as e (e.sourceId + e.targetId)}
                  {@const otherId = e.sourceId === selected.id ? e.targetId : e.sourceId}
                  {@const other = graph.nodes.find((n) => n.id === otherId)}
                  {#if other}
                    <li>
                      <button type="button" class="btn link" onclick={() => (selectedId = other.id)}>
                        {other.key}
                      </button>
                      <span class="muted">· {e.reason === 'tokens' ? 'shared terms' : 'same category'}</span>
                    </li>
                  {/if}
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {:else if !memoryLoading}
    <p class="muted">{$_('app.studio.memory.empty', { default: 'No memory entries yet. The AI will learn about your brand as you chat and run research.' })}</p>
  {/if}

  <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px;">
    <div class="kt" style="margin-bottom:8px;font-size:0.8rem;">{$_('app.studio.memory.addManual', { default: 'Add memory entry' })}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
      <input bind:value={newMemoryKey} placeholder={$_('app.studio.memory.keyPlaceholder', { default: 'Key (e.g. brand_tone)' })} style="flex:0 0 160px;" />
      <select bind:value={newMemoryCategory} style="flex:0 0 120px;">
        <option value="fact">Fact</option>
        <option value="constraint">Constraint</option>
        <option value="preference">Preference</option>
        <option value="voice">Voice</option>
        <option value="insight">Insight</option>
      </select>
      <input bind:value={newMemoryValue} placeholder={$_('app.studio.memory.valuePlaceholder', { default: 'The fact to remember...' })} style="flex:1;min-width:200px;" />
      <button class="btn primary" type="button" onclick={addMemoryEntry} disabled={!newMemoryKey.trim() || !newMemoryValue.trim()}>
        {$_('app.studio.memory.add', { default: 'Add' })}
      </button>
    </div>
  </div>
</section>

<style>
  .memory-actions { display: flex; align-items: center; gap: 8px; }
  .view-toggle {
    display: inline-flex; gap: 2px; padding: 2px; border-radius: 10px;
    background: var(--paper-2, #f5f5f7); border: 1px solid var(--line, #e3e3e6);
  }
  .view-btn {
    border: none; background: transparent; font: inherit; font-size: 12px; font-weight: 600;
    padding: 6px 10px; border-radius: 8px; cursor: pointer; color: var(--ink-soft, #6e6e73);
  }
  .view-btn.active { background: var(--paper, #fff); color: var(--ink, #1d1d1f); box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  .memory-filters { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .filter-label { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-soft); }
  .filter-label select {
    font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 10px;
    border: 1px solid var(--line-2, #d2d2d7); background: var(--paper, #fff);
  }
  .filter-count { font-size: 12px; }
  .pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 14px; }
  .graph-wrap { display: flex; flex-direction: column; gap: 12px; }
  .memory-graph {
    width: 100%; height: auto; background: var(--paper-2, #f5f5f7);
    border: 1px solid var(--line, #e3e3e6); border-radius: 16px;
  }
  .graph-edge { stroke: rgba(0,0,0,.12); }
  .graph-edge.strong { stroke: rgba(124, 92, 255, .45); }
  .graph-node { cursor: pointer; }
  .graph-node text { font-size: 9px; fill: var(--ink-soft, #6e6e73); pointer-events: none; }
  .graph-node.selected circle { stroke: var(--ink, #1d1d1f); stroke-width: 2; }
  .graph-legend { display: flex; flex-wrap: wrap; gap: 10px 14px; font-size: 11.5px; color: var(--ink-soft); }
  .legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .legend-item i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .legend-item.soft { opacity: .8; }
  .graph-detail {
    border: 1px solid var(--line, #e3e3e6); border-radius: 14px; padding: 12px 14px;
    background: var(--paper, #fff);
  }
  .related ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .related li { font-size: 13px; }
</style>
