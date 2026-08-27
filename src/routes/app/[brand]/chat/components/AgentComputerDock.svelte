<script lang="ts">
  import * as Sheet from '$lib/components/ui/sheet';
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    narrow,
    children
  }: {
    open?: boolean;
    narrow: boolean;
    children: Snippet;
  } = $props();
</script>

{#if open && !narrow}
  <aside class="agent-computer-dock">
    {@render children()}
  </aside>
{/if}

{#if narrow}
  <Sheet.Root bind:open>
    <Sheet.Content
      side="right"
      showCloseButton={false}
      style="width: min(calc(100vw - 1rem), 24rem); max-width: calc(100vw - 1rem); border-left: 1px solid var(--line); background: var(--paper); padding: 0; display: flex; flex-direction: column;"
    >
      {@render children()}
    </Sheet.Content>
  </Sheet.Root>
{/if}

<style>
  .agent-computer-dock {
    flex: 0 0 340px;
    width: 340px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--line);
    background: var(--paper);
    overflow: hidden;
  }
</style>
