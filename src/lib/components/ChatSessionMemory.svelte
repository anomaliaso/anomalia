<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { ChevronDown, ChevronRight, BookmarkPlus, Pencil, Trash2, Check, X } from '@lucide/svelte';

  type SessionMemory = {
    id: string;
    key: string;
    value: string;
    category: string;
  };

  let {
    brandSlug,
    threadId,
    entries = $bindable([] as SessionMemory[])
  }: {
    brandSlug: string;
    threadId: string;
    entries?: SessionMemory[];
  } = $props();

  let open = $state(false);
  let editingId = $state<string | null>(null);
  let editValue = $state('');
  let busyId = $state<string | null>(null);

  const base = $derived(`/app/${brandSlug}/chat/memory`);

  function startEdit(entry: SessionMemory) {
    editingId = entry.id;
    editValue = entry.value;
  }

  function cancelEdit() {
    editingId = null;
    editValue = '';
  }

  async function saveEdit(id: string) {
    const value = editValue.trim();
    if (!value) return;
    busyId = id;
    try {
      const res = await fetch(base, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, value })
      });
      if (res.ok) {
        entries = entries.map((e) => (e.id === id ? { ...e, value } : e));
        cancelEdit();
      }
    } finally {
      busyId = null;
    }
  }

  async function promote(id: string) {
    busyId = id;
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'promote', id })
      });
      if (res.ok) entries = entries.filter((e) => e.id !== id);
    } finally {
      busyId = null;
    }
  }

  async function remove(id: string) {
    busyId = id;
    try {
      const res = await fetch(base, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (res.ok) entries = entries.filter((e) => e.id !== id);
    } finally {
      busyId = null;
    }
  }
</script>

{#if entries.length > 0}
  <div class="session-mem">
    <button type="button" class="sm-toggle" onclick={() => (open = !open)}>
      {#if open}
        <ChevronDown size={14} />
      {:else}
        <ChevronRight size={14} />
      {/if}
      <span>{$_('chat.sessionMemory.title')}</span>
      <span class="sm-count">{entries.length}</span>
    </button>

    {#if open}
      <ul class="sm-list">
        {#each entries as entry (entry.id)}
          <li class="sm-item" class:busy={busyId === entry.id}>
            {#if editingId === entry.id}
              <textarea class="sm-edit" rows="2" bind:value={editValue}></textarea>
              <div class="sm-actions">
                <button type="button" class="sm-btn" title={$_('chat.sessionMemory.save')} onclick={() => saveEdit(entry.id)}>
                  <Check size={14} />
                </button>
                <button type="button" class="sm-btn" title={$_('chat.sessionMemory.cancel')} onclick={cancelEdit}>
                  <X size={14} />
                </button>
              </div>
            {:else}
              <p class="sm-value">{entry.value}</p>
              <div class="sm-actions">
                <button
                  type="button"
                  class="sm-btn"
                  title={$_('chat.sessionMemory.promote')}
                  onclick={() => promote(entry.id)}
                >
                  <BookmarkPlus size={14} />
                </button>
                <button
                  type="button"
                  class="sm-btn"
                  title={$_('chat.sessionMemory.edit')}
                  onclick={() => startEdit(entry)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  class="sm-btn danger"
                  title={$_('chat.sessionMemory.delete')}
                  onclick={() => remove(entry.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .session-mem {
    width: 100%;
    border-top: 1px solid color-mix(in oklab, var(--border) 70%, transparent);
    padding: 0.35rem 0 0.15rem;
  }
  .sm-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 0;
    background: transparent;
    color: var(--muted-foreground);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0.25rem 0;
  }
  .sm-count {
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
  }
  .sm-list {
    list-style: none;
    margin: 0.25rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .sm-item {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    justify-content: space-between;
    padding: 0.4rem 0.5rem;
    border-radius: 0.4rem;
    background: color-mix(in oklab, var(--muted) 55%, transparent);
  }
  .sm-item.busy {
    opacity: 0.55;
    pointer-events: none;
  }
  .sm-value {
    margin: 0;
    flex: 1;
    font-size: 0.8rem;
    line-height: 1.35;
    color: var(--foreground);
  }
  .sm-edit {
    flex: 1;
    font-size: 0.8rem;
    line-height: 1.35;
    resize: vertical;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    padding: 0.35rem 0.45rem;
    background: var(--background);
    color: var(--foreground);
  }
  .sm-actions {
    display: flex;
    gap: 0.15rem;
    flex-shrink: 0;
  }
  .sm-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    border: 0;
    border-radius: 0.3rem;
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .sm-btn:hover {
    background: color-mix(in oklab, var(--foreground) 8%, transparent);
    color: var(--foreground);
  }
  .sm-btn.danger:hover {
    color: var(--destructive, #b91c1c);
  }
</style>
