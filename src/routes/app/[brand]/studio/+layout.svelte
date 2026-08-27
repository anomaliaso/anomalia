<script lang="ts">
  /** Legacy /studio/* routes redirect to /settings/* — keep a minimal shell. */
  let { children } = $props();
</script>

{@render children()}
