<script lang="ts">
  import { _ } from 'svelte-i18n';

  type PagerItem = { title: string; href: string };

  let {
    prev = null,
    next = null,
  }: {
    prev?: PagerItem | null;
    next?: PagerItem | null;
  } = $props();
</script>

{#if prev || next}
  <nav class="docs-pager" aria-label={$_('docs.layout.s58')}>
    {#if prev}
      <a href={prev.href} class="prev">
        <div class="docs-pager-label">{$_('docs.layout.s56')}</div>
        <div class="docs-pager-title">{prev.title}</div>
      </a>
    {/if}
    {#if next}
      <a href={next.href} class="next">
        <div class="docs-pager-label">{$_('docs.layout.s57')}</div>
        <div class="docs-pager-title">{next.title}</div>
      </a>
    {/if}
  </nav>
{/if}
