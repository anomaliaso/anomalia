<script lang="ts">
  import { goto } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { getReplyNotices, type ReplyNotice } from '$lib/chat-reply-notifications';
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

  const AUTO_DISMISS_MS = 6000;
  const SWIPE_DISMISS_PX = 90;
  const DRAG_SLOP_PX = 6;

  let { brandSlug }: { brandSlug: string } = $props();

  const isMobile = new IsMobile(SHELL_MOBILE_BREAKPOINT);
  let dismissed = $state(new Map<string, number>());
  const notices = $derived(
    getReplyNotices($chatThreads, $unreadThreadIds, $chatThreadId, dismissed)
  );

  let drag = $state<{ id: string; startX: number; dx: number } | null>(null);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function dismiss(notice: ReplyNotice) {
    clearTimeout(timers.get(notice.thread.id));
    timers.delete(notice.thread.id);
    dismissed = new Map(dismissed).set(notice.thread.id, notice.unreadCount);
  }

  $effect(() => {
    for (const notice of notices) {
      if (timers.has(notice.thread.id)) continue;
      timers.set(
        notice.thread.id,
        setTimeout(() => dismiss(notice), AUTO_DISMISS_MS)
      );
    }
  });

  $effect(() => () => {
    timers.forEach(clearTimeout);
    timers.clear();
  });

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

  function startDrag(event: PointerEvent, id: string) {
    if (event.button !== 0) return;
    drag = { id, startX: event.clientX, dx: 0 };
  }

  function moveDrag(event: PointerEvent) {
    if (!drag) return;
    drag = { ...drag, dx: event.clientX - drag.startX };
  }

  function endDrag(notice: ReplyNotice) {
    const travelled = Math.abs(drag?.dx ?? 0);
    drag = null;
    if (travelled >= SWIPE_DISMISS_PX) dismiss(notice);
  }

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
      {@const dx = drag?.id === notice.thread.id ? drag.dx : 0}
      <div
        class="reply-notice"
        role="group"
        class:sliding={dx !== 0}
        style:transform={`translateX(${dx}px)`}
        onpointerdown={(event) => startDrag(event, notice.thread.id)}
        onpointermove={moveDrag}
        onpointerup={() => endDrag(notice)}
        onpointercancel={() => endDrag(notice)}
        onpointerleave={() => endDrag(notice)}
      >
        <a
          class="reply-notice-open"
          href={`/app/${brandSlug}/chat/${notice.thread.id}`}
          data-testid={`chat-reply-notification-${notice.thread.id}`}
          aria-label={$_('chat.replyNotification.open', { values: { name: who.name } })}
          onclick={(event) => {
            event.preventDefault();
            if (Math.abs(dx) > DRAG_SLOP_PX) return;
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
            aria-label={$_('chat.replyNotification.count', {
              values: { count: notice.unreadCount }
            })}
          >{notice.unreadCount > 9 ? '9+' : notice.unreadCount}</span>
        </a>
        <button
          type="button"
          class="reply-notice-close"
          data-testid={`chat-reply-notification-close-${notice.thread.id}`}
          aria-label={$_('chat.replyNotification.dismiss')}
          onpointerdown={(event) => event.stopPropagation()}
          onclick={() => dismiss(notice)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
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
    min-height: 62px;
    padding-right: 6px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: color-mix(in srgb, var(--paper) 96%, transparent);
    box-shadow: 0 12px 30px color-mix(in srgb, var(--ink) 13%, transparent);
    color: var(--ink);
    pointer-events: auto;
    touch-action: pan-y;
    transition: transform 160ms ease;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  .reply-notice.sliding {
    transition: none;
  }

  .reply-notice:hover {
    border-color: var(--ink-faint);
  }

  .reply-notice-open {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    align-items: center;
    gap: 10px;
    padding: 10px 4px 10px 12px;
    color: inherit;
    text-decoration: none;
  }

  .reply-notice-close {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--ink-faint);
    cursor: pointer;
  }

  .reply-notice-close:hover {
    background: color-mix(in srgb, var(--ink) 8%, transparent);
    color: var(--ink);
  }

  .reply-notice-close svg {
    width: 14px;
    height: 14px;
    fill: none;
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
