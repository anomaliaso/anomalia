<script lang="ts">
  import { type Snippet } from 'svelte';
  import { clearPageMeta, pageTopActions, setPageMeta } from '$lib/stores/page-meta';

  let {
    title,
    subtitle = null,
    section = null,
    actions
  }: {
    title: string;
    subtitle?: string | null;
    section?: string | null;
    actions?: Snippet;
  } = $props();

  $effect(() => {
    setPageMeta({ title, subtitle, section });
    pageTopActions.set(actions ?? null);
    return () => clearPageMeta();
  });
</script>
