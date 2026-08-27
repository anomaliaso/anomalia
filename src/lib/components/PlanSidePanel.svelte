<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { X } from '@lucide/svelte';
  import { planPanel, closePlanPanel } from '$lib/stores/plan-panel';
  import PlanDocumentView from '$lib/components/PlanDocumentView.svelte';
  import type { BrandPlanDocument } from '$lib/server/brand-plans';
  import { materialPress } from '$lib/actions/material-press.js';

  let plan = $state<BrandPlanDocument | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let loadedKey = $state<string | null>(null);

  $effect(() => {
    const state = $planPanel;
    if (!state) {
      plan = null;
      error = null;
      loading = false;
      loadedKey = null;
      return;
    }
    const key = `${state.brandSlug}:${state.planId}`;
    if (key === loadedKey && plan) return;

    let cancelled = false;
    loading = true;
    error = null;
    plan = null;
    void (async () => {
      try {
        const res = await fetch(`/app/${state.brandSlug}/plans/${state.planId}/json`, {
          cache: 'no-store'
        });
        if (!res.ok) throw new Error('load_failed');
        const data = await res.json();
        if (cancelled) return;
        plan = data.plan as BrandPlanDocument;
        loadedKey = key;
      } catch {
        if (!cancelled) {
          error = 'load_failed';
          loadedKey = null;
        }
      } finally {
        if (!cancelled) loading = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') closePlanPanel();
  }
</script>

<svelte:window onkeydown={$planPanel ? onKey : undefined} />

{#if $planPanel}
  <div class="plan-overlay" role="presentation">
    <button type="button" class="plan-backdrop" aria-label={$_('app.shell.back')} onclick={closePlanPanel}></button>
    <aside
      class="plan-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={plan?.title || $_('chat.plan.untitled')}
      use:materialPress
      style="--material-press-fill: var(--paper-2)"
    >
      <header class="plan-drawer-bar">
        <span class="plan-drawer-kicker">{$_('chat.plan.open')}</span>
        <button type="button" class="plan-drawer-close" onclick={closePlanPanel} aria-label={$_('app.shell.back')}>
          <X size={18} strokeWidth={2} />
        </button>
      </header>
      <div class="plan-drawer-body">
        {#if loading}
          <div class="plan-skel" aria-busy="true">
            <div class="sk sk-title"></div>
            <div class="sk sk-line"></div>
            <div class="sk sk-line w-70"></div>
            <div class="sk sk-line w-55"></div>
            <div class="sk sk-block"></div>
          </div>
        {:else if error}
          <p class="plan-err">{$_('chat.error')}</p>
        {:else if plan}
          <PlanDocumentView {plan} compact />
        {/if}
      </div>
    </aside>
  </div>
{/if}

<style>
  .plan-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    pointer-events: none;
  }
  .plan-backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    margin: 0;
    background: color-mix(in srgb, #000 28%, transparent);
    cursor: pointer;
    pointer-events: auto;
    animation: plan-fade 0.18s ease;
  }
  .plan-drawer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(440px, 100vw);
    background: var(--paper);
    border-left: 1px solid var(--line);
    box-shadow: -12px 0 40px color-mix(in srgb, #000 12%, transparent);
    display: flex;
    flex-direction: column;
    pointer-events: auto;
    animation: plan-slide 0.22s ease;
  }
  .plan-drawer-bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
    background: var(--paper-2);
  }
  .plan-drawer-kicker {
    font-size: 12px;
    font-weight: 650;
    color: var(--ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .plan-drawer-close {
    appearance: none;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink-soft);
    border-radius: 8px;
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .plan-drawer-close:hover {
    color: var(--ink);
    background: var(--paper-3);
  }
  .plan-drawer-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 18px 28px;
  }
  .plan-err {
    margin: 24px 0;
    color: var(--ink-soft);
    font-size: 14px;
  }
  .plan-skel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 8px;
  }
  .sk {
    border-radius: 10px;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--ink) 4%, var(--paper)) 0%,
      color-mix(in srgb, var(--ink) 9%, var(--paper)) 45%,
      color-mix(in srgb, var(--ink) 4%, var(--paper)) 100%
    );
    background-size: 200% 100%;
    animation: plan-shimmer 1.35s ease-in-out infinite;
  }
  .sk-title { height: 24px; width: 55%; }
  .sk-line { height: 12px; width: 100%; }
  .sk-block { height: 120px; width: 100%; margin-top: 8px; }
  .w-70 { width: 70% !important; }
  .w-55 { width: 55% !important; }

  @keyframes plan-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes plan-slide {
    from { transform: translateX(18px); opacity: 0.6; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes plan-shimmer {
    from { background-position: 200% 0; }
    to { background-position: -200% 0; }
  }

  @media (max-width: 1023px) {
    .plan-overlay {
      display: none;
    }
  }
</style>
