<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { Check, Copy, Pencil, RotateCcw, ThumbsDown, ThumbsUp } from '@lucide/svelte';
  import { formatChatDuration, formatChatMetaTooltip } from '$lib/chat-duration';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { onDestroy } from 'svelte';

  let {
    role = 'user',
    showEdit = true,
    showResend = false,
    disabled = false,
    feedback = null,
    durationMs = null,
    model = null,
    tier = null,
    inputTokens = null,
    outputTokens = null,
    // Who answered — shown next to the actions, so a thread with several agents stays legible.
    agentName = null,
    agentFace = null,
    agentColor = null,
    oncopy,
    onedit,
    onresend,
    onredo,
    onfeedback
  }: {
    role?: 'user' | 'assistant';
    showEdit?: boolean;
    showResend?: boolean;
    disabled?: boolean;
    feedback?: 1 | -1 | null;
    durationMs?: number | null;
    model?: string | null;
    tier?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    agentName?: string | null;
    agentFace?: string | null;
    agentColor?: string | null;
    oncopy?: () => void;
    onedit?: () => void;
    onresend?: () => void;
    onredo?: () => void;
    /** Next feedback value (null clears). Note only for thumbs-down. */
    onfeedback?: (value: 1 | -1 | null, note?: string) => void;
  } = $props();

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let noteOpen = $state(false);
  let noteText = $state('');

  const durationLabel = $derived(
    durationMs != null && durationMs >= 0 ? formatChatDuration(durationMs) : ''
  );
  const metaTooltip = $derived(
    formatChatMetaTooltip({ model, tier, inputTokens, outputTokens })
  );

  onDestroy(() => {
    if (copyTimer) clearTimeout(copyTimer);
  });

  function handleCopy() {
    if (disabled || !oncopy) return;
    oncopy();
    copied = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied = false;
      copyTimer = null;
    }, 1500);
  }

  function thumbUp() {
    if (disabled) return;
    noteOpen = false;
    onfeedback?.(feedback === 1 ? null : 1);
  }

  function thumbDown() {
    if (disabled) return;
    if (feedback === -1) {
      noteOpen = false;
      onfeedback?.(null);
      return;
    }
    noteOpen = true;
  }

  function submitDownNote() {
    if (disabled) return;
    onfeedback?.(-1, noteText.trim() || undefined);
    noteOpen = false;
    noteText = '';
  }

  function skipNote() {
    if (disabled) return;
    onfeedback?.(-1);
    noteOpen = false;
    noteText = '';
  }
</script>

<div class="user-actions" class:disabled class:assistant={role === 'assistant'}>
  {#if role === 'assistant' && agentName}
    <span class="ua-agent" title={agentName}>
      {#if agentFace}
        <AgentAvatar face={agentFace} color={agentColor ?? '#111111'} size={14} />
      {/if}
      <span class="ua-agent-name">{agentName}</span>
    </span>
  {/if}
  {#if oncopy}
    <button
      type="button"
      class="ua-btn"
      class:ok={copied}
      title={$_('chat.copy')}
      aria-label={$_('chat.copy')}
      disabled={disabled}
      onclick={handleCopy}
    >
      {#if copied}
        <Check size={14} strokeWidth={2.2} />
      {:else}
        <Copy size={14} strokeWidth={2} />
      {/if}
    </button>
  {/if}

  {#if role === 'user'}
    {#if showEdit && onedit}
      <button
        type="button"
        class="ua-btn"
        title={$_('chat.edit')}
        aria-label={$_('chat.edit')}
        disabled={disabled}
        onclick={() => onedit?.()}
      >
        <Pencil size={14} strokeWidth={2} />
      </button>
    {/if}
    {#if showResend && onresend}
      <button
        type="button"
        class="ua-btn"
        title={$_('chat.resend')}
        aria-label={$_('chat.resend')}
        disabled={disabled}
        onclick={() => onresend?.()}
      >
        <RotateCcw size={14} strokeWidth={2} />
      </button>
    {/if}
  {:else}
    {#if onredo}
      <button
        type="button"
        class="ua-btn"
        title={$_('chat.redo')}
        aria-label={$_('chat.redo')}
        disabled={disabled}
        onclick={() => onredo?.()}
      >
        <RotateCcw size={14} strokeWidth={2} />
      </button>
    {/if}
    {#if onfeedback}
      <button
        type="button"
        class="ua-btn"
        class:active={feedback === 1}
        title={$_('chat.feedbackUp')}
        aria-label={$_('chat.feedbackUp')}
        aria-pressed={feedback === 1}
        disabled={disabled}
        onclick={thumbUp}
      >
        <ThumbsUp size={14} strokeWidth={2} />
      </button>
      <button
        type="button"
        class="ua-btn"
        class:active={feedback === -1}
        title={$_('chat.feedbackDown')}
        aria-label={$_('chat.feedbackDown')}
        aria-pressed={feedback === -1}
        disabled={disabled}
        onclick={thumbDown}
      >
        <ThumbsDown size={14} strokeWidth={2} />
      </button>
    {/if}
    {#if durationLabel}
      <span class="ua-time" title={metaTooltip || undefined}>{durationLabel}</span>
    {/if}
  {/if}
</div>

{#if role === 'assistant' && noteOpen}
  <div class="ua-note">
    <input
      type="text"
      class="ua-note-input"
      placeholder={$_('chat.feedbackNotePlaceholder')}
      bind:value={noteText}
      disabled={disabled}
      maxlength={500}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitDownNote();
        } else if (e.key === 'Escape') {
          skipNote();
        }
      }}
    />
    <button type="button" class="ua-note-btn" disabled={disabled} onclick={submitDownNote}>
      {$_('chat.feedbackNoteSend')}
    </button>
    <button type="button" class="ua-note-btn muted" disabled={disabled} onclick={skipNote}>
      {$_('chat.feedbackNoteSkip')}
    </button>
  </div>
{/if}

<style>
  .user-actions {
    display: flex;
    align-items: center;
    /* La riga segue il lato del messaggio: a destra sotto la bolla utente, a sinistra
       sotto la risposta dell'AI (regola .assistant qui sotto). */
    align-self: flex-end;
    gap: 2px;
    opacity: 0.7;
    transition: opacity 0.15s ease;
    padding: 0;
  }
  @media (hover: hover) {
    .user-actions {
      opacity: 0.45;
    }
    .user-actions:hover,
    .user-actions:focus-within {
      opacity: 1;
    }
  }
  .user-actions.assistant {
    align-self: flex-start;
    opacity: 0.7;
  }
  @media (hover: hover) {
    .user-actions.assistant {
      opacity: 0.45;
    }
    .user-actions.assistant:hover,
    .user-actions.assistant:focus-within {
      opacity: 1;
    }
  }
  .user-actions.disabled {
    opacity: 0.35;
    pointer-events: none;
  }
  .ua-btn {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--ink-soft);
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
  }
  .ua-btn:hover:not(:disabled) {
    background: var(--paper-3);
    color: var(--ink);
  }
  .ua-btn.ok {
    color: var(--accent);
  }
  .ua-btn.active {
    color: var(--ink);
    background: var(--paper-3);
  }
  .ua-btn:disabled {
    cursor: default;
  }
  .ua-time {
    font-size: 11px;
    line-height: 1;
    color: var(--ink-soft);
    padding: 0 6px;
    font-variant-numeric: tabular-nums;
    user-select: none;
  }
  .ua-note {
    display: flex;
    align-items: center;
    align-self: flex-start;
    gap: 6px;
    margin-top: 4px;
    max-width: 100%;
  }
  .ua-note-input {
    flex: 1;
    min-width: 0;
    height: 28px;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0 10px;
    font-size: 12px;
    background: var(--paper);
    color: var(--ink);
  }
  .ua-note-btn {
    appearance: none;
    border: none;
    background: var(--paper-3);
    color: var(--ink);
    font-size: 12px;
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    cursor: pointer;
    white-space: nowrap;
  }
  .ua-note-btn.muted {
    background: transparent;
    color: var(--ink-soft);
  }
  .ua-note-btn:hover:not(:disabled) {
    opacity: 0.85;
  }

  .ua-agent {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-right: 2px;
    max-width: 170px;
    color: var(--ink-faint);
    font-size: 11.5px;
    font-weight: 550;
  }
  .ua-agent-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
