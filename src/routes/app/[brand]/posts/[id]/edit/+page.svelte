<script lang="ts">
  import { goto } from '$app/navigation';
  import { backHref } from '$lib/page-modal-navigation';
  import { pageModalOrigin } from '$lib/stores/page-modal';
  import PostEditor from '$lib/components/PostEditor.svelte';

  let { data } = $props();
  const brand = $derived(data.brand);
  const post = $derived(data.post);
  const calendarHref = $derived(`/app/${brand.slug}/calendar`);
  const returnHref = $derived(backHref($pageModalOrigin, calendarHref));

  async function onLeave() {
    await goto(returnHref);
  }
</script>

<div class="edit-wrap">
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
    panels="edit"
    onClose={onLeave}
  />
</div>

<style>
  .edit-wrap {
    height: min(780px, calc(100dvh - 140px));
    min-height: 520px;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  @media (max-width: 900px) {
    .edit-wrap {
      height: auto;
      min-height: 0;
      max-height: none;
    }
  }
</style>
