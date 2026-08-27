<script lang="ts">
  let { label }: { label: string } = $props();
</script>

<span class="dm-speaker">{label}</span>

<style>
  .dm-speaker {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
</style>
