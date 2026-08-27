<script lang="ts">
  import SocialPostMockup from '$lib/components/SocialPostMockup.svelte';
  import { _ } from 'svelte-i18n';

  let { data } = $props();
  const brand = $derived(data.brand);
  const post = $derived(data.post);
</script>

<section class="panel">
  <div class="panel-head">
    <div class="t">{$_('app.post.preview.title')}</div>
    <div class="s">{$_('app.post.preview.subtitle')}</div>
  </div>
  <SocialPostMockup
    post={post}
    brandName={brand.name}
    brandAvatar={data.brandAvatar}
  />
</section>

<style>
  .panel { padding: 8px 0 24px; }
  .panel-head { text-align: center; margin-bottom: 8px; }
  .t { font-size: 15px; font-weight: 700; color: var(--ink); }
  .s { font-size: 13px; color: var(--ink-soft); margin-top: 4px; }
</style>
