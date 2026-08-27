<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { FileText, ArrowUpRight } from '@lucide/svelte';

  let {
    plan,
    brandSlug,
    onopen
  }: {
    plan: { id: string; title: string; summary?: string | null };
    brandSlug: string;
    onopen: (href: string) => void;
  } = $props();

  const href = $derived(`/app/${brandSlug}/plans/${plan.id}`);
</script>

<button type="button" class="plan-card" onclick={() => onopen(href)}>
  <span class="plan-icon"><FileText size={16} /></span>
  <span class="plan-body">
    <span class="plan-title">{plan.title || $_('chat.plan.untitled')}</span>
    {#if plan.summary}
      <span class="plan-summary">{plan.summary}</span>
    {/if}
    <span class="plan-cta">{$_('chat.plan.open')}</span>
  </span>
  <span class="plan-arrow"><ArrowUpRight size={14} /></span>
</button>

<style>
  .plan-card {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
    width: 100%;
    text-align: left;
    padding: 0.75rem 0.85rem;
    border: 1px solid var(--line);
    border-radius: 0.85rem;
    background: var(--paper-2);
    color: var(--ink);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .plan-card:hover {
    background: var(--paper-3);
    border-color: color-mix(in srgb, var(--accent) 35%, var(--line));
  }
  .plan-icon {
    display: inline-flex;
    padding-top: 0.1rem;
    color: var(--ink-faint);
    flex-shrink: 0;
  }
  .plan-body {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 1;
    min-width: 0;
  }
  .plan-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--ink);
  }
  .plan-summary {
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--ink-soft);
  }
  .plan-cta {
    font-size: 0.75rem;
    color: var(--accent);
    margin-top: 0.15rem;
  }
  .plan-arrow {
    display: inline-flex;
    padding-top: 0.15rem;
    color: var(--ink-faint);
    flex-shrink: 0;
  }
</style>
