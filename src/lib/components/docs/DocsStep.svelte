<script lang="ts">
  import * as Collapsible from '$lib/components/ui/collapsible/index.js';

  let {
    step,
    title,
    open = false,
    children,
  }: {
    step: number;
    title: string;
    open?: boolean;
    children: import('svelte').Snippet;
  } = $props();
</script>

<Collapsible.Root bind:open class="docs-step-box">
  <Collapsible.Trigger class="docs-step-trigger">
    <span class="docs-step-num">{step}</span>
    <span class="docs-step-title">{title}</span>
    <svg
      class="docs-step-chevron"
      class:rotated={open}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fill-rule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clip-rule="evenodd"
      />
    </svg>
  </Collapsible.Trigger>
  <Collapsible.Content class="docs-step-content">
    {@render children()}
  </Collapsible.Content>
</Collapsible.Root>

<style>
  :global(.docs-step-box) {
    border: 1px solid var(--line);
    border-radius: 12px;
    margin-bottom: 10px;
    background: var(--paper);
    transition: border-color 0.15s ease;
  }
  :global(.docs-step-box[data-state="open"]) {
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  :global(.docs-step-trigger) {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 14px 18px;
    cursor: pointer;
    background: none;
    border: none;
    text-align: left;
    font-size: 15px;
    font-weight: 600;
    color: var(--ink);
    transition: color 0.15s ease;
  }
  :global(.docs-step-trigger:hover) {
    color: var(--accent);
  }
  .docs-step-num {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--accent);
    font-size: 13px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .docs-step-title {
    flex: 1;
    min-width: 0;
  }
  .docs-step-chevron {
    width: 18px;
    height: 18px;
    color: var(--ink-soft);
    flex-shrink: 0;
    transition: transform 0.2s ease;
  }
  .docs-step-chevron.rotated {
    transform: rotate(180deg);
  }
  :global(.docs-step-content) {
    padding: 0 18px 16px 58px;
    font-size: 15px;
    line-height: 1.7;
    color: var(--ink-soft);
  }
  :global(.docs-step-content p) {
    margin: 0 0 12px;
  }
  :global(.docs-step-content p:last-child) {
    margin-bottom: 0;
  }
  :global(.docs-step-content ul),
  :global(.docs-step-content ol) {
    margin: 0 0 12px;
    padding-left: 20px;
  }
  :global(.docs-step-content code) {
    font-family: var(--sans);
    font-size: 13px;
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 1px 6px;
  }
</style>
