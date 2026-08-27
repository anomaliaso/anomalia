<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import {
    clearPageMeta,
    emptyPageMeta,
    pageTopActions,
    setPageMeta,
    PAGE_META_SINK,
    type PageMetaSink
  } from '$lib/stores/page-meta';

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

  // Se qualcuno ci ospita fuori dal nostro posto (PageModal, sopra una pagina viva) ha
  // messo un raccoglitore in contesto: si scrive lì. Il topbar globale appartiene alla
  // pagina SOTTO e non va toccato — vedi il perché in stores/page-meta.ts.
  const sink = getContext<PageMetaSink | undefined>(PAGE_META_SINK);

  $effect(() => {
    if (sink) {
      sink.set({ meta: { title, subtitle, section }, actions: actions ?? null });
      return () => sink.set({ meta: emptyPageMeta, actions: null });
    }
    setPageMeta({ title, subtitle, section });
    pageTopActions.set(actions ?? null);
    return () => clearPageMeta();
  });
</script>
