<script lang="ts">
  import { goto } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { getReplyNotices } from '$lib/chat-reply-notifications';
  import { SHELL_MOBILE_BREAKPOINT, IsMobile } from '$lib/hooks/is-mobile.svelte';
  import { brandChannel } from '$lib/realtime/brand-channel.svelte';
  import {
    chatThreadId,
    chatThreads,
    markThreadRead,
    refreshThreads,
    unreadThreadIds
  } from '$lib/stores/chat';
  import { threadIdentity } from '$lib/thread-identity';

  let { brandSlug }: { brandSlug: string } = $props();

  const isMobile = new IsMobile(SHELL_MOBILE_BREAKPOINT);
  const notices = $derived(getReplyNotices($chatThreads, $unreadThreadIds, $chatThreadId));

  $effect(() => {
    const slug = brandSlug;
    if (!slug) return;

    let active = true;
    const refresh = () => {
      if (active) void refreshThreads(slug);
    };

    refresh();
    const stop = brandChannel.onConnected(refresh);
    return () => {
      active = false;
      stop();
    };
  });

  function openNotice(threadId: string) {
    markThreadRead(brandSlug, threadId);
    chatThreadId.set(threadId);
    void goto(`/app/${brandSlug}/chat/${threadId}`, { noScroll: true, keepFocus: true });
  }
</script>

{#if notices.length}
  <div
    class="reply-notifications"
    class:mobile={isMobile.current}
    aria-label={$_('chat.replyNotification.region')}
    aria-live="polite"
    data-testid="chat-reply-notifications"
  >
    {#each notices as notice (notice.thread.id)}
      {@const who = threadIdentity(notice.thread, (key) => $_(key))}
      <a
        class="reply-notice"
        href={`/app/${brandSlug}/chat/${notice.thread.id}`}
        data-testid={`chat-reply-notification-${notice.thread.id}`}
        aria-label={$_('chat.replyNotification.open', { values: { name: who.name } })}
        onclick={(event) => {
          event.preventDefault();
          openNotice(notice.thread.id);
        }}
      >
        <AgentAvatar face={who.face} color={who.color} size={34} />
        <span class="reply-notice-copy">
          <span class="reply-notice-label">{$_('chat.replyNotification.label')}</span>
          <strong>{who.name}</strong>
          <span class="reply-notice-preview">
            {notice.thread.preview || $_('chat.replyNotification.message')}
          </span>
        </span>
        <span
          class="reply-notice-count"
          aria-label={$_('chat.replyNotification.count', { values: { count: notice.unreadCount } })}
        >{notice.unreadCount > 9 ? '9+' : notice.unreadCount}</span>
      </a>
    {/each}
  </div>
{/if}

<style>
  .reply-notifications {
    position: fixed;
    top: calc(var(--shell-top-h, 56px) + 12px);
    right: 20px;
    z-index: 35;
    display: grid;
    gap: 8px;
    width: min(360px, calc(100vw - 40px));
    pointer-events: none;
  }

  .reply-notice {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 62px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: color-mix(in srgb, var(--paper) 96%, transparent);
    box-shadow: 0 12px 30px color-mix(in srgb, var(--ink) 13%, transparent);
    color: var(--ink);
    text-decoration: none;
    pointer-events: auto;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  .reply-notice:hover {
    border-color: var(--ink-faint);
  }

  .reply-notice-copy {
    display: grid;
    min-width: 0;
    flex: 1 1 auto;
    gap: 2px;
  }

  .reply-notice-label {
    color: var(--ink-faint);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    line-height: 1.1;
    text-transform: uppercase;
  }

  .reply-notice-copy strong,
  .reply-notice-preview {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reply-notice-copy strong {
    font-size: 13px;
    line-height: 1.2;
  }

  .reply-notice-preview {
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 1.25;
  }

  .reply-notice-count {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--accent-solid, #7c5cff);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
  }

  @media (max-width: 1023px) {
    .reply-notifications,
    .reply-notifications.mobile {
      top: calc(var(--shell-top-h, 56px) + 8px);
      right: 12px;
      left: 12px;
      width: auto;
    }
  }
</style>
