<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ToolPage from '$lib/components/ToolPage.svelte';
  import ToolStats from '$lib/components/ToolStats.svelte';
</script>

<ToolPage toolKey="schema-validator" endpoint="/api/tools/schema-validator">
  {#snippet result(d)}
    <ToolStats
      stats={[
        { label: $_('tools.schema-validator.stats.blocks'), value: d.blocks.length },
        { label: $_('tools.schema-validator.stats.valid'), value: d.blocks.filter((b: any) => b.valid).length },
        { label: $_('tools.schema-validator.stats.types'), value: d.types.length }
      ]}
    />

    {#if d.types.length}
      <div class="chips">
        {#each d.types as t}<span class="chip">{t}</span>{/each}
        {#each d.microdataTypes as t}<span class="chip micro">{t}</span>{/each}
      </div>
    {/if}

    {#each d.blocks as b, i}
      <div class="block" class:invalid={!b.valid}>
        <div class="block-head">
          <strong>#{i + 1}</strong>
          <span>{b.valid ? b.types.join(', ') || '—' : b.error}</span>
        </div>
        <pre>{b.raw}{b.raw.length >= 400 ? $_('tools.common.truncated') : ''}</pre>
      </div>
    {/each}
  {/snippet}
</ToolPage>

<style>
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; }
  .chip {
    background: var(--wash); border: 1px solid var(--line); border-radius: 999px;
    padding: 4px 12px; font-size: 0.82rem;
  }
  .chip.micro { opacity: 0.7; }
  .block {
    border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px;
    background: var(--paper);
  }
  .block.invalid { border-color: #fecaca; background: #fef2f2; }
  .block-head { display: flex; gap: 10px; align-items: baseline; margin-bottom: 8px; font-size: 0.9rem; }
  .block-head span { color: var(--ink-soft); }
  pre {
    margin: 0; overflow-x: auto; font-size: 0.78rem; line-height: 1.5;
    color: var(--ink-soft); white-space: pre-wrap; word-break: break-word;
  }
</style>
