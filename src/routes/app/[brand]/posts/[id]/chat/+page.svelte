<script lang="ts">
  import { goto } from '$app/navigation';
  import { invalidateAll } from '$app/navigation';
  import PostEditor from '$lib/components/PostEditor.svelte';
  import { _ } from 'svelte-i18n';

  let { data } = $props();
  const brand = $derived(data.brand);
  const post = $derived(data.post);
  const studioOn = $derived(!!data.flags?.studio);

  async function onLeave() {
    await invalidateAll();
    await goto(`/app/${brand.slug}/calendar`);
  }
</script>

{#if studioOn}
  <div class="chat-wrap">
    <PostEditor
      post={post}
      brandSlug={brand.slug}
      tz={brand.timezone}
      todayKey={data.todayKey}
      nowISO={data.nowISO}
      busyDays={data.busyDays}
      availablePlatforms={data.connectedPlatforms}
      flags={data.flags}
      embedded
      panels="chat"
      onClose={onLeave}
    />
  </div>
{:else}
  <section class="off">
    <p>{$_('app.post.chat.studioOff')}</p>
    <a href={`/app/${brand.slug}/posts/${post.id}/edit`}>{$_('app.post.chat.goEdit')}</a>
  </section>
{/if}

<style>
  .chat-wrap {
    height: min(780px, calc(100dvh - 140px));
    min-height: 520px;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  @media (max-width: 900px) {
    .chat-wrap {
      height: auto;
      min-height: 0;
      max-height: none;
    }
  }
  .off {
    padding: 48px 24px; text-align: center; border: 1px solid var(--line);
    border-radius: 14px; background: var(--paper);
  }
  .off p { margin: 0 0 12px; color: var(--ink-soft); font-size: 14px; }
  .off a { font-weight: 650; color: var(--accent); text-decoration: none; }
</style>
