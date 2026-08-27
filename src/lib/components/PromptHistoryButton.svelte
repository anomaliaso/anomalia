<script lang="ts">
  import History from '@lucide/svelte/icons/history';

  let {
    label,
    onclick
  }: {
    label: string;
    onclick: () => void;
  } = $props();
</script>

<button type="button" class="ph-history-btn" {onclick}>
  <History size={15} strokeWidth={1.8} />
  <span>{label}</span>
</button>

<style>
  .ph-history-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .ph-history-btn:hover {
    border-color: var(--accent);
  }
</style>
