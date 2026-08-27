<script lang="ts">
  import X from '@lucide/svelte/icons/x';

  export type PromptHistoryEntry = {
    id: string;
    prompt: string;
    at: number;
    meta?: string;
  };

  let {
    open,
    entries,
    title,
    empty,
    reuseLabel,
    onclose,
    onreuse
  }: {
    open: boolean;
    entries: PromptHistoryEntry[];
    title: string;
    empty: string;
    reuseLabel: string;
    onclose: () => void;
    onreuse: (entry: PromptHistoryEntry) => void;
  } = $props();

  function whenLabel(ts: number) {
    return new Date(ts).toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
</script>

{#if open}
  <div class="ph-drawer-backdrop" role="presentation" onclick={onclose}></div>
  <div class="ph-drawer" role="dialog" aria-modal="true" aria-label={title}>
    <header class="ph-drawer-head">
      <h2>{title}</h2>
      <button type="button" class="ph-icon-btn" onclick={onclose} aria-label="Close">
        <X size={16} />
      </button>
    </header>
    {#if entries.length === 0}
      <p class="ph-drawer-empty">{empty}</p>
    {:else}
      <ul class="ph-drawer-list">
        {#each entries as entry (entry.id)}
          <li>
            <button type="button" class="ph-hist-row" onclick={() => onreuse(entry)}>
              <span class="ph-hist-prompt">{entry.prompt}</span>
              <span class="ph-hist-meta">
                {whenLabel(entry.at)}
                {#if entry.meta}
                  · {entry.meta}
                {/if}
                · {reuseLabel}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .ph-drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.28);
    z-index: 40;
  }
  .ph-drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(380px, 92vw);
    background: var(--paper);
    border-left: 1px solid var(--line);
    z-index: 41;
    display: flex;
    flex-direction: column;
    box-shadow: -12px 0 40px rgba(0, 0, 0, 0.08);
  }
  .ph-drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px;
    border-bottom: 1px solid var(--line);
  }
  .ph-drawer-head h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .ph-icon-btn {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    color: var(--ink-soft);
    display: grid;
    place-items: center;
  }
  .ph-drawer-empty {
    padding: 24px 18px;
    color: var(--ink-soft);
    font-size: 14px;
  }
  .ph-drawer-list {
    list-style: none;
    margin: 0;
    padding: 8px;
    overflow-y: auto;
    flex: 1;
  }
  .ph-hist-row {
    width: 100%;
    text-align: left;
    border: none;
    background: transparent;
    border-radius: 12px;
    padding: 12px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ph-hist-row:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .ph-hist-prompt {
    font-size: 13.5px;
    color: var(--ink);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .ph-hist-meta {
    font-size: 11px;
    color: var(--ink-faint);
  }
</style>
