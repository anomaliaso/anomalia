<script lang="ts">
  import '$lib/styles/tailwind.css';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { platformsOf, stateOf, summarise, whenLabel, STATUS_FILTERS } from './post-state';
  import type { PostRow } from './post-state';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const brand = $derived(data.brand);
  const posts = $derived(data.posts);

  let selectedId = $state<string | null>(data.selectedPostId);
  let PostPanel = $state<typeof import('./PostPanel.svelte').default | null>(null);

  const selected = $derived(posts.find((p) => p.id === selectedId) ?? null);

  $effect(() => {
    if (selectedId && !PostPanel) {
      import('./PostPanel.svelte').then((m) => (PostPanel = m.default));
    }
  });

  function syncUrl(postId: string | null) {
    const url = new URL(page.url);
    if (postId) {
      url.searchParams.set('post', postId);
    } else {
      url.searchParams.delete('post');
    }
    replaceState(url, page.state);
  }

  function open(post: PostRow) {
    selectedId = post.id;
    syncUrl(post.id);
  }

  function close() {
    selectedId = null;
    syncUrl(null);
  }

  function filterHref(value: string): string {
    return value === 'all' ? '?' : `?status=${value}`;
  }
</script>

<svelte:head><title>Posts — {brand.name}</title></svelte:head>

<div class="bg-background text-foreground min-h-screen px-4 py-8 sm:px-8">
  <div class="mx-auto flex max-w-4xl flex-col gap-6">
    <header class="flex flex-col gap-1">
      <p class="text-muted-foreground text-xs tracking-wide uppercase">{brand.name}</p>
      <h1 class="text-2xl font-semibold">Posts</h1>
      <p class="text-muted-foreground text-xs">Times shown in {brand.timezone}</p>
    </header>

    <nav aria-label="Filter by status" class="flex flex-wrap gap-2">
      {#each STATUS_FILTERS as filter (filter.value)}
        <a
          href={filterHref(filter.value)}
          aria-current={data.status === filter.value ? 'page' : undefined}
          class="focus-visible:ring-ring/50 rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none {data.status ===
          filter.value
            ? 'border-primary bg-primary/10 font-medium'
            : 'border-border hover:bg-muted'}">{filter.label}</a
        >
      {/each}
    </nav>

    {#if form && form.id !== selectedId}
      <p
        role={form.message && !form.approved ? 'alert' : 'status'}
        class="rounded-lg border px-3 py-2 text-sm {form.message && !form.approved
          ? 'border-destructive/40 text-destructive'
          : 'border-border'}"
      >
        {form.message ??
          (form.approved ? `Approved — the post is now ${form.status}.` : 'Copy saved.')}
      </p>
    {/if}

    {#if posts.length === 0}
      <p class="text-muted-foreground text-sm">Nothing here.</p>
    {:else}
      <ul class="border-border divide-border divide-y overflow-hidden rounded-xl border">
        {#each posts as post (post.id)}
          {@const postState = stateOf(post.status)}
          <li>
            <button
              type="button"
              onclick={() => open(post)}
              class="hover:bg-muted focus-visible:ring-ring/50 flex w-full flex-col gap-1 px-4 py-3 text-left focus-visible:ring-3 focus-visible:outline-none"
            >
              <span class="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant={postState.tone}>{postState.label}</Badge>
                <span class="font-medium">{platformsOf(post).join(' · ') || 'post'}</span>
                <span class="text-muted-foreground">{whenLabel(post, brand.timezone)}</span>
              </span>
              <span class="line-clamp-2 text-sm">{summarise(post)}</span>
            </button>
          </li>
        {/each}
      </ul>
      <p class="text-muted-foreground text-xs">
        Showing the {posts.length} most recent. Older posts stay in the calendar.
      </p>
    {/if}
  </div>
</div>

{#if PostPanel && selected}
  {#key selected.id}
    <PostPanel post={selected} timezone={brand.timezone} {form} onclose={close} />
  {/key}
{/if}
