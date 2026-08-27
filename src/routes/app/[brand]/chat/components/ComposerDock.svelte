<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte';
  import {
    notifyChatReady,
    requestChatNotificationPermission,
    shouldShowChatNotifyBanner,
  } from '$lib/chat-notifications';
  import ChatQueueChip from '$lib/components/ChatQueueChip.svelte';
  import ChatPrompt from '$lib/components/ChatPrompt.svelte';
  import ChatBackgroundJobs from '$lib/components/ChatBackgroundJobs.svelte';
  import type { QueuedChatItem } from '$lib/stores/chat-session';
  import type { BackgroundToolJob } from '$lib/stores/chat-session';
  import type { ChatMode } from '$lib/chat-modes';
  import type { ChatTier } from '$lib/chat-tiers';
  import type { ChatReasoning } from '$lib/chat-reasoning';
  import type { AgentMeta } from '$lib/agent-icons';
  import type { ChatAttachmentsPayload } from '$lib/chat-attachments';
  import type { ChatDocument } from '$lib/chat-documents';

  type SubmitMeta = {
    mode: ChatMode;
    tier?: ChatTier;
    reasoning?: ChatReasoning;
    command?: string;
    attachments?: ChatAttachmentsPayload;
    thumbs?: string[];
    documents?: ChatDocument[];
  };

  let {
    brandSlug,
    threadId,
    loading,
    dmViewOnly,
    bgJobs,
    bgActive,
    queueItems,
    queueBusy,
    value = $bindable(''),
    mode = $bindable('agent' as ChatMode),
    tier = $bindable('auto' as ChatTier),
    reasoning = $bindable(),
    agentOptions,
    agentLocked,
    agent,
    webHubEnabled,
    remoteBusy,
    onsubmit,
    onstop,
    onagentchange,
    onmodelchange,
    onqueueedit,
    onqueuedelete,
    onqueuesendnow
  }: {
    brandSlug: string;
    threadId: string;
    loading: boolean;
    /** Il server ha ancora un turno vivo su questo thread, anche se questa scheda non lo streamma. */
    remoteBusy?: boolean;
    dmViewOnly: boolean;
    bgJobs: BackgroundToolJob[];
    bgActive: boolean;
    queueItems: QueuedChatItem[];
    queueBusy: boolean;
    value?: string;
    mode?: ChatMode;
    tier?: ChatTier;
    reasoning?: ChatReasoning;
    agentOptions: AgentMeta[] | null;
    agentLocked: boolean;
    agent: string;
    webHubEnabled: boolean;
    onsubmit: (text?: string, meta?: SubmitMeta, opts?: { resend?: boolean; redoMessageId?: string; truncateFromMessageId?: string }) => void | Promise<void>;
    onstop: () => void;
    onagentchange: (id: string) => void | Promise<void>;
    onmodelchange?: (choice: { tier: ChatTier; reasoning: ChatReasoning }) => void;
    onqueueedit: (jobId: string, text: string) => void | Promise<void>;
    onqueuedelete: (jobId: string) => void | Promise<void>;
    onqueuesendnow: (jobId: string) => void | Promise<void>;
  } = $props();

  let notifyBannerVisible = $state(false);
  let notifyRequesting = $state(false);
  const isMobile = new IsMobile();

  function refreshNotifyBanner() {
    notifyBannerVisible = !isMobile.current && shouldShowChatNotifyBanner();
  }

  async function enableChatNotifications() {
    if (notifyRequesting) return;
    notifyRequesting = true;
    try {
      await requestChatNotificationPermission();
      refreshNotifyBanner();
    } finally {
      notifyRequesting = false;
    }
  }

  $effect(() => {
    void isMobile.current;
    refreshNotifyBanner();
  });
</script>

<div class="ch-dock floating">
  <div class="ch-dock-inner">
  <!-- Il lavoro in sottofondo sta qui e non nel transcript: scorrendo, spariva proprio mentre serviva. -->
  <ChatBackgroundJobs jobs={bgJobs} active={bgActive} />
  {#if dmViewOnly}
    <!-- Sola lettura: il server rifiuta comunque ogni POST (dm_view_only). -->
    <div class="dm-viewonly" role="note">{$_('chat.dmViewOnly')}</div>
  {:else}
  {#if loading && notifyBannerVisible}
    <div class="ch-notify-banner" role="status">
      <span class="ch-notify-text">{$_('chat.notifyBanner')}</span>
      <button
        type="button"
        class="ch-notify-cta"
        onclick={enableChatNotifications}
        disabled={notifyRequesting}
      >
        {$_('chat.notifyCta')}
      </button>
    </div>
  {/if}
  <ChatQueueChip
    items={queueItems}
    busy={queueBusy}
    onedit={onqueueedit}
    ondelete={onqueuedelete}
    onsendnow={onqueuesendnow}
  />
  <ChatPrompt
    bind:value={value}
    bind:mode={mode}
    bind:tier={tier}
    bind:reasoning={reasoning}
    {brandSlug}
    draftKey={`anomalia:chat-draft:${threadId}`}
    {loading}
    {remoteBusy}
    onsubmit={onsubmit}
    onstop={onstop}
    {agentOptions}
    {agentLocked}
    {agent}
    onagentchange={onagentchange}
    {onmodelchange}
    {webHubEnabled}
  />
  {/if}
  </div>
</div>

<style>
  .ch-dock { width: 100%; }
  .ch-dock.floating {
    position: sticky;
    bottom: 0;
    width: 100%;
    max-width: none;
    padding: 10px 0 22px;
    background: var(--paper);
    box-sizing: border-box;
  }
  .ch-dock-inner {
    width: 100%;
    max-width: var(--chat-col);
    margin-inline: auto;
    padding-inline: 24px;
    box-sizing: border-box;
  }
  .ch-notify-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
    padding: 10px 14px;
    border: 1px solid var(--line, #e3e3e6);
    border-radius: 14px;
    background: var(--paper-2, #f5f5f7);
  }
  .ch-notify-text {
    font-size: 13px;
    line-height: 1.35;
    color: var(--ink-soft, #6e6e73);
  }
  .ch-notify-cta {
    flex: 0 0 auto;
    border: none;
    border-radius: 10px;
    padding: 7px 14px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    background: var(--accent, #7c5cff);
    color: #fff;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .ch-notify-cta:hover:not(:disabled) { opacity: 0.9; }
  .ch-notify-cta:disabled { opacity: 0.5; cursor: default; }
  @media (max-width: 1023px) {
    .ch-dock.floating {
      padding: 10px 0 16px;
    }
    .ch-dock-inner {
      padding-inline: 16px;
    }
  }
  @media (max-width: 767px) {
    .ch-notify-banner { display: none; }
  }
  .dm-viewonly {
    text-align: center;
    font-size: 12px;
    color: var(--ink-soft);
    padding: 10px 14px;
    border: 1px dashed var(--line);
    border-radius: 12px;
    background: var(--paper-2);
  }
</style>
