<script lang="ts">
  import { getPlatform } from './platform-meta';

  let { platform, size = 'sm' }: { platform: string | null; size?: 'sm' | 'lg' } = $props();
  const meta = $derived(getPlatform(platform));
</script>

<span class="pglyph" class:lg={size === 'lg'} style={`background:${meta.bg}`}>
  {#if meta.icon}
    <svg viewBox="0 0 24 24" fill="#fff"><path d={meta.icon.path} /></svg>
  {:else}
    {meta.short}
  {/if}
</span>

<style>
  .pglyph {
    width: 16px; height: 16px; border-radius: 5px; display: inline-flex; align-items: center;
    justify-content: center; color: #fff; font-size: 8px; font-weight: 700; flex: 0 0 auto;
  }
  .pglyph svg { width: 11px; height: 11px; }
  .pglyph.lg { width: 30px; height: 30px; border-radius: 9px; font-size: 11px; }
  .pglyph.lg svg { width: 17px; height: 17px; }
</style>
