<script lang="ts">
  import type { Component, Snippet } from 'svelte';

  let {
    busy = false,
    disabled = false,
    type = 'submit',
    title = undefined,
    variant = 'primary',
    // PascalCase prop so Svelte treats it as a dynamic component tag.
    Icon = undefined,
    class: className = '',
    children,
    onclick
  }: {
    busy?: boolean;
    disabled?: boolean;
    type?: 'submit' | 'button';
    title?: string;
    variant?: 'primary' | 'ghost';
    /** Lucide (or compatible) icon — shown when not busy; spinner replaces it while loading. */
    Icon?: Component<{ class?: string; strokeWidth?: number | string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
    class?: string;
    children: Snippet;
    onclick?: (e: MouseEvent) => void;
  } = $props();

  const locked = $derived(busy || disabled);
</script>

<button
  class="topbar-cta {className}"
  class:is-busy={busy}
  class:ghost={variant === 'ghost'}
  {type}
  disabled={locked}
  aria-busy={busy}
  aria-disabled={locked}
  {title}
  {onclick}
>
  {#if busy}
    <span class="topbar-cta-spin" aria-hidden="true"></span>
  {:else if Icon}
    <Icon class="topbar-cta-icon" strokeWidth={2.1} aria-hidden="true" />
  {/if}
  <span class="topbar-cta-label">{@render children()}</span>
</button>

<style>
  .topbar-cta {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    appearance: none;
    border: none;
    border-radius: 999px;
    padding: 9px 16px;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
    line-height: 1;
    letter-spacing: 0.01em;
    white-space: nowrap;
    cursor: pointer;
    color: #fff;
    background: var(--accent);
    box-shadow:
      0 1px 0 color-mix(in srgb, #000 12%, transparent),
      0 6px 16px -8px color-mix(in srgb, var(--accent) 70%, transparent);
    transform: translateY(0) scale(1);
    transition:
      transform 0.15s ease,
      background 0.15s ease,
      box-shadow 0.15s ease,
      border-color 0.15s ease,
      opacity 0.15s ease,
      filter 0.15s ease;
    touch-action: manipulation;
    user-select: none;
  }

  .topbar-cta.ghost {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--paper));
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line));
    box-shadow: none;
  }

  .topbar-cta:hover:not(:disabled):not(.is-busy) {
    transform: translateY(-1px);
    background: color-mix(in srgb, var(--accent) 88%, #000);
    box-shadow:
      0 1px 0 color-mix(in srgb, #000 14%, transparent),
      0 10px 20px -10px color-mix(in srgb, var(--accent) 80%, transparent);
  }

  .topbar-cta.ghost:hover:not(:disabled):not(.is-busy) {
    background: color-mix(in srgb, var(--accent) 14%, var(--paper));
    box-shadow: none;
  }

  .topbar-cta:active:not(:disabled):not(.is-busy) {
    transform: translateY(1px) scale(0.98);
    background: color-mix(in srgb, var(--accent) 78%, #000);
    box-shadow:
      0 0 0 color-mix(in srgb, #000 10%, transparent),
      0 2px 8px -4px color-mix(in srgb, var(--accent) 55%, transparent);
  }

  .topbar-cta.ghost:active:not(:disabled):not(.is-busy) {
    background: color-mix(in srgb, var(--accent) 18%, var(--paper));
    box-shadow: none;
  }

  .topbar-cta:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 55%, #fff);
    outline-offset: 2px;
  }

  .topbar-cta:disabled,
  .topbar-cta.is-busy {
    opacity: 0.72;
    cursor: not-allowed;
    pointer-events: none;
    transform: none;
    box-shadow: none;
    filter: saturate(0.92);
  }

  .topbar-cta-label {
    display: inline-flex;
    align-items: center;
  }

  .topbar-cta :global(.topbar-cta-icon) {
    width: 15px;
    height: 15px;
    flex: 0 0 15px;
  }

  .topbar-cta-spin {
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #fff;
    animation: topbar-cta-spin 0.7s linear infinite;
  }

  .topbar-cta.ghost .topbar-cta-spin {
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
    border-top-color: var(--accent);
  }

  @keyframes topbar-cta-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
