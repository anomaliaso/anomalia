<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { renderMd } from '$lib/chat-markdown';
  import type { BrandPlanDocument } from '$lib/server/brand-plans';

  let {
    plan,
    compact = false
  }: {
    plan: BrandPlanDocument;
    /** Tighter padding for the side panel. */
    compact?: boolean;
  } = $props();

  const html = $derived(renderMd(plan.markdown));
  const updated = $derived(
    new Intl.DateTimeFormat($locale ?? 'it', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(plan.updatedAt ?? plan.createdAt)
    )
  );

  function copyMarkdown() {
    void navigator.clipboard?.writeText(plan.markdown);
  }
</script>

<div class="plan-doc" class:compact>
  <header class="plan-header">
    <div class="plan-heading">
      <h1>{plan.title || $_('chat.plan.untitled')}</h1>
      {#if plan.summary}<p class="plan-sub">{plan.summary}</p>{/if}
      <p class="plan-meta">{updated}</p>
    </div>
    <button type="button" class="plan-copy" onclick={copyMarkdown}>
      {$_('chat.plan.copy')}
    </button>
  </header>

  <article class="plan-md">{@html html}</article>
</div>

<style>
  .plan-doc {
    color: var(--ink);
  }
  .plan-doc:not(.compact) {
    max-width: 48rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 4rem;
  }
  .plan-doc.compact {
    padding: 0 0 2rem;
  }
  .plan-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 1rem;
    margin-bottom: 1.25rem;
    border-bottom: 1px solid var(--line);
  }
  .plan-heading {
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-size: 1.375rem;
    font-weight: 650;
    line-height: 1.25;
    color: var(--ink);
  }
  .compact h1 {
    font-size: 1.15rem;
  }
  .plan-sub {
    margin: 0.35rem 0 0;
    font-size: 0.875rem;
    color: var(--ink-soft);
  }
  .plan-meta {
    margin: 0.35rem 0 0;
    font-size: 0.75rem;
    color: var(--ink-faint);
  }
  .plan-copy {
    flex-shrink: 0;
    appearance: none;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    border-radius: 0.5rem;
    padding: 0.35rem 0.75rem;
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .plan-copy:hover {
    background: var(--paper-3);
    border-color: color-mix(in srgb, var(--accent) 35%, var(--line));
  }

  .plan-md {
    font-size: 0.9375rem;
    line-height: 1.65;
    color: var(--ink);
    user-select: text;
  }
  .plan-md :global(h1),
  .plan-md :global(h2),
  .plan-md :global(h3) {
    margin: 1.75rem 0 0.6rem;
    line-height: 1.3;
    font-weight: 650;
    color: var(--ink);
  }
  .plan-md :global(h1) { font-size: 1.25rem; }
  .plan-md :global(h2) { font-size: 1.0625rem; }
  .plan-md :global(h3) { font-size: 0.9375rem; }
  .plan-md :global(p) { margin: 0.7rem 0; }
  .plan-md :global(ul),
  .plan-md :global(ol) { margin: 0.7rem 0; padding-left: 1.35rem; }
  .plan-md :global(li) { margin: 0.3rem 0; }
  .plan-md :global(a) { color: var(--accent); }
  .plan-md :global(code) {
    font-size: 0.875em;
    background: var(--paper-3);
    color: var(--ink);
    border-radius: 0.25rem;
    padding: 0.1em 0.35em;
  }
  .plan-md :global(pre) {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 0.6rem;
    padding: 0.85rem 1rem;
    overflow-x: auto;
    color: var(--ink);
  }
  .plan-md :global(pre code) {
    background: transparent;
    padding: 0;
  }
  .plan-md :global(blockquote) {
    margin: 0.9rem 0;
    padding-left: 0.9rem;
    border-left: 3px solid var(--line);
    color: var(--ink-soft);
  }
  .plan-md :global(table) {
    display: block;
    overflow-x: auto;
    max-width: 100%;
    border-collapse: collapse;
    margin: 0.9rem 0;
    font-size: 0.875rem;
  }
  .plan-md :global(th),
  .plan-md :global(td) {
    border: 1px solid var(--line);
    padding: 0.4rem 0.6rem;
    text-align: left;
    color: var(--ink);
  }
  .plan-md :global(th) {
    background: var(--paper-2);
    font-weight: 600;
  }
</style>
