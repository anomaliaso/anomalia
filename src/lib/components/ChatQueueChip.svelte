<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { Pencil, Send, Trash2 } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import type { QueuedChatItem } from '$lib/stores/chat-session';

  let {
    items = [],
    busy = false,
    onedit = async (_id: string, _text: string) => {},
    ondelete = async (_id: string) => {},
    onsendnow = async (_id: string) => {}
  }: {
    items?: QueuedChatItem[];
    /** Disables send-now while a local action is in flight. */
    busy?: boolean;
    onedit?: (id: string, text: string) => void | Promise<void>;
    ondelete?: (id: string) => void | Promise<void>;
    onsendnow?: (id: string) => void | Promise<void>;
  } = $props();

  let open = $state(false);
  let editingId = $state<string | null>(null);
  let editDraft = $state('');
  let actionBusy = $state(false);

  const count = $derived(items.length);

  function startEdit(item: QueuedChatItem) {
    editingId = item.id;
    editDraft = item.text;
  }

  function cancelEdit() {
    editingId = null;
    editDraft = '';
  }

  async function saveEdit(id: string) {
    const text = editDraft.trim();
    if (!text || actionBusy) return;
    actionBusy = true;
    try {
      await onedit(id, text);
      editingId = null;
      editDraft = '';
    } finally {
      actionBusy = false;
    }
  }

  async function remove(id: string) {
    if (actionBusy) return;
    actionBusy = true;
    try {
      await ondelete(id);
      if (editingId === id) cancelEdit();
    } finally {
      actionBusy = false;
    }
  }

  async function sendNow(id: string) {
    if (actionBusy || busy) return;
    actionBusy = true;
    try {
      open = false;
      await onsendnow(id);
    } finally {
      actionBusy = false;
    }
  }
</script>

{#if count > 0}
  <div class="q-bar">
    <button type="button" class="q-chip" onclick={() => (open = true)}>
      {$_('chat.queue.chip', { values: { count } })}
    </button>
  </div>
{/if}

<Dialog.Root bind:open>
  <Dialog.Content class="flex flex-col gap-4 p-5 sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="text-base">{$_('chat.queue.title')}</Dialog.Title>
      <Dialog.Description class="text-sm text-muted-foreground">
        {$_('chat.queue.description')}
      </Dialog.Description>
    </Dialog.Header>

    {#if items.length === 0}
      <p class="text-sm text-muted-foreground py-4 text-center">{$_('chat.queue.empty')}</p>
    {:else}
      <ul class="q-list">
        {#each items as item (item.id)}
          <li class="q-item">
            {#if editingId === item.id}
              <textarea
                class="q-edit"
                rows="3"
                bind:value={editDraft}
                disabled={actionBusy}
              ></textarea>
              <div class="q-edit-actions">
                <button type="button" class="q-text-btn" disabled={actionBusy} onclick={cancelEdit}>
                  {$_('chat.queue.cancel')}
                </button>
                <button
                  type="button"
                  class="q-text-btn primary"
                  disabled={actionBusy || !editDraft.trim()}
                  onclick={() => saveEdit(item.id)}
                >
                  {$_('chat.queue.save')}
                </button>
              </div>
            {:else}
              <p class="q-text">{item.text}</p>
              <div class="q-actions">
                <button
                  type="button"
                  class="q-icon"
                  title={$_('chat.queue.edit')}
                  aria-label={$_('chat.queue.edit')}
                  disabled={actionBusy}
                  onclick={() => startEdit(item)}
                >
                  <Pencil size={15} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  class="q-icon"
                  title={$_('chat.queue.sendNow')}
                  aria-label={$_('chat.queue.sendNow')}
                  disabled={actionBusy || busy}
                  onclick={() => sendNow(item.id)}
                >
                  <Send size={15} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  class="q-icon danger"
                  title={$_('chat.queue.delete')}
                  aria-label={$_('chat.queue.delete')}
                  disabled={actionBusy}
                  onclick={() => remove(item.id)}
                >
                  <Trash2 size={15} strokeWidth={2} />
                </button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  .q-bar {
    display: flex;
    justify-content: flex-start;
    padding: 0 2px 8px;
  }
  /* Riga quieta, non pillola: stessa grammatica delle righe di sistema in chat (niente
     bordo/sfondo, hover che scurisce il testo). Resta a sinistra: parla della coda
     dell'utente, non è un evento della conversazione. */
  .q-chip {
    border: none;
    background: none;
    color: var(--ink-soft);
    font: 600 12px/1.2 inherit;
    letter-spacing: 0.01em;
    padding: 2px 0;
    cursor: pointer;
    transition: color 0.12s ease;
  }
  .q-chip:hover,
  .q-chip:focus-visible {
    color: var(--ink);
  }
  .q-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: min(50vh, 360px);
    overflow: auto;
  }
  .q-item {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid color-mix(in oklab, var(--ink) 10%, transparent);
    background: color-mix(in oklab, var(--ink) 2%, transparent);
  }
  .q-text {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .q-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }
  .q-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: color-mix(in oklab, var(--ink) 70%, transparent);
    cursor: pointer;
  }
  .q-icon:hover:not(:disabled) {
    background: color-mix(in oklab, var(--ink) 8%, transparent);
    color: var(--ink);
  }
  .q-icon.danger:hover:not(:disabled) {
    background: color-mix(in oklab, #c62828 12%, transparent);
    color: #c62828;
  }
  .q-icon:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .q-edit {
    width: 100%;
    resize: vertical;
    min-height: 64px;
    font: inherit;
    font-size: 13px;
    line-height: 1.45;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid color-mix(in oklab, var(--ink) 16%, transparent);
    background: var(--paper, #fff);
    color: inherit;
  }
  .q-edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .q-text-btn {
    border: none;
    background: transparent;
    font: 500 12px/1 inherit;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    color: color-mix(in oklab, var(--ink) 65%, transparent);
  }
  .q-text-btn.primary {
    color: var(--ink);
    background: color-mix(in oklab, var(--ink) 8%, transparent);
  }
  .q-text-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
