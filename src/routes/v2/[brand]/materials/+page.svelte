<script lang="ts">
  import '$lib/styles/tailwind.css';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { KIND_FILTERS, addedOn, labelOf } from './media-kind';
  import type { MediaRow } from './media-kind';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const brand = $derived(data.brand);
  const media = $derived(data.media);

  let selectedId = $state<string | null>(data.selectedMediaId);
  let MediaPanel = $state<typeof import('./MediaPanel.svelte').default | null>(null);

  const selected = $derived(media.find((m) => m.id === selectedId) ?? null);

  $effect(() => {
    if (selectedId && !MediaPanel) {
      import('./MediaPanel.svelte').then((m) => (MediaPanel = m.default));
    }
  });

  function syncUrl(mediaId: string | null) {
    const url = new URL(page.url);
    if (mediaId) {
      url.searchParams.set('item', mediaId);
    } else {
      url.searchParams.delete('item');
    }
    replaceState(url, page.state);
  }

  function open(item: MediaRow) {
    selectedId = item.id;
    syncUrl(item.id);
  }

  function close() {
    selectedId = null;
    syncUrl(null);
  }

  function filterHref(value: string): string {
    const params = new URLSearchParams();
    if (value !== 'all') {
      params.set('kind', value);
    }
    if (data.query) {
      params.set('q', data.query);
    }
    return `?${params}`;
  }
</script>

<svelte:head><title>Materials — {brand.name}</title></svelte:head>

<div class="bg-background text-foreground min-h-screen px-4 py-8 sm:px-8">
  <div class="mx-auto flex max-w-5xl flex-col gap-6">
    <header class="flex flex-col gap-1">
      <p class="text-muted-foreground text-xs tracking-wide uppercase">{brand.name}</p>
      <h1 class="text-2xl font-semibold">Materials</h1>
      <p class="text-muted-foreground text-xs">
        Everything the brand can reuse in a post. Read-only here — assets arrive from uploads,
        renders and agents.
      </p>
    </header>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Filter by type" class="flex flex-wrap gap-2">
        {#each KIND_FILTERS as filter (filter.value)}
          <a
            href={filterHref(filter.value)}
            aria-current={data.kind === filter.value ? 'page' : undefined}
            class="focus-visible:ring-ring/50 rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none {data.kind ===
            filter.value
              ? 'border-primary bg-primary/10 font-medium'
              : 'border-border hover:bg-muted'}">{filter.label}</a
          >
        {/each}
      </nav>

      <form method="GET" class="flex items-center gap-2">
        {#if data.kind !== 'all'}
          <input type="hidden" name="kind" value={data.kind} />
        {/if}
        <label class="sr-only" for="q">Search materials</label>
        <input
          id="q"
          name="q"
          type="search"
          value={data.query}
          placeholder="Search title, description, tags"
          class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 w-56 rounded-lg border bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:ring-3"
        />
        <button
          type="submit"
          class="border-border hover:bg-muted focus-visible:ring-ring/50 rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none"
          >Search</button
        >
      </form>
    </div>

    {#if media.length === 0}
      <p class="text-muted-foreground text-sm">
        {data.query ? `Nothing matches “${data.query}”.` : 'The library is empty.'}
      </p>
    {:else}
      <ul class="flex flex-wrap gap-3">
        {#each media as item (item.id)}
          <li class="w-[calc(50%-0.375rem)] sm:w-40">
            <button
              type="button"
              onclick={() => open(item)}
              class="border-border hover:bg-muted focus-visible:ring-ring/50 flex w-full flex-col overflow-hidden rounded-xl border text-left focus-visible:ring-3 focus-visible:outline-none"
            >
              <span class="bg-muted flex h-32 w-full items-center justify-center overflow-hidden">
                {#if item.kind === 'image' && item.signed_url}
                  <img
                    src={item.signed_url}
                    alt={labelOf(item)}
                    loading="lazy"
                    decoding="async"
                    class="h-full w-full object-cover"
                  />
                {:else}
                  <span class="text-muted-foreground text-xs">{item.kind}</span>
                {/if}
              </span>
              <span class="flex flex-col gap-1 px-2.5 py-2">
                <span class="line-clamp-2 text-sm font-medium">{labelOf(item)}</span>
                <span class="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <Badge variant="outline">{item.kind}</Badge>
                  {addedOn(item, brand.timezone)}
                </span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
      <p class="text-muted-foreground text-xs">
        {media.length} shown. The library returns the newest first.
      </p>
    {/if}
  </div>
</div>

{#if MediaPanel && selected}
  {#key selected.id}
    <MediaPanel item={selected} timezone={brand.timezone} onclose={close} />
  {/key}
{/if}
