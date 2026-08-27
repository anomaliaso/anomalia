<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { WorkbenchPageHub } from '$lib/workbench-paths';
  import PageHead from '$lib/components/PageHead.svelte';

  let {
    hub,
    title,
    subtitle,
    badgeByKey = {},
    banner = undefined,
    children,
  }: {
    hub: WorkbenchPageHub;
    title: string;
    subtitle: string;
    /** @deprecated unused — kept for call-site compatibility */
    badgeByKey?: Record<string, number>;
    banner?: Snippet;
    children: Snippet;
  } = $props();

  void hub;
  void badgeByKey;
</script>

<div class="content hub-overview">
  <PageHead {title} {subtitle} />

  {#if banner}
    <div class="hub-overview-banner">
      {@render banner()}
    </div>
  {/if}

  <div class="hub-overview-grid">
    {@render children()}
  </div>
</div>

<style>
  .hub-overview :global(.page-head h2) {
    margin: 0;
  }
  .hub-overview :global(.page-sub) {
    margin: 6px 0 0;
    max-width: 58ch;
    line-height: 1.5;
  }

  .hub-overview-banner {
    margin: 0 0 16px;
    padding: 14px 16px;
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--line));
    background:
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--accent) 10%, var(--paper)) 0%,
        var(--paper) 60%
      );
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .hub-overview-banner :global(p) {
    margin: 0;
    font-size: 13.5px;
    color: var(--ink-soft);
    line-height: 1.45;
    flex: 1;
    min-width: 180px;
  }
  .hub-overview-banner :global(a) {
    font-size: 13px;
    font-weight: 600;
    color: #fff;
    background: var(--accent);
    padding: 8px 14px;
    border-radius: 999px;
    text-decoration: none;
    white-space: nowrap;
  }

  .hub-overview-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }
  @container workbench (min-width: 640px) {
    .hub-overview-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
  }
  @container workbench (min-width: 1100px) {
    .hub-overview-grid {
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }
  }
</style>
