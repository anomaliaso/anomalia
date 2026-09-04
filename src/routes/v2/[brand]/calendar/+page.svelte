<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { buildMonthGrid, timeInZone } from './calendar-month';
  import { platformsOf, stateOf, summarise, whenLabel, STATUS_FILTERS, VIEWS } from '../post-state';
  import type { PageProps } from './$types';

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  let { data, form }: PageProps = $props();

  const month = $derived(data.month);
  const grid = $derived(
    month ? buildMonthGrid(month.year, month.month, data.posts, data.timezone) : null
  );
  const pending = $derived(data.posts.filter((p) => p.status === 'pending_user').length);

  let PostPanel = $state<typeof import('../PostPanel.svelte').default | null>(null);

  $effect(() => {
    if (data.detail && !PostPanel) {
      import('../PostPanel.svelte').then((m) => (PostPanel = m.default));
    }
  });

  function hrefWith(patch: Record<string, string | null>): string {
    const url = new URL(page.url);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, value);
      }
    }

    return `${url.pathname}${url.search}`;
  }

  function close() {
    goto(hrefWith({ post: null }), { noScroll: true, keepFocus: true });
  }
</script>

<svelte:head><title>{data.heading} — {data.brand}</title></svelte:head>

<div class="bg-background text-foreground min-h-screen px-4 py-8 sm:px-8">
  <div class="mx-auto flex max-w-6xl flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div class="flex flex-col gap-1">
        <p class="text-muted-foreground text-xs tracking-wide uppercase">{data.brand}</p>
        <h1 class="text-2xl font-semibold">{data.heading}</h1>
        <p class="text-muted-foreground text-xs">
          Times shown in {data.timezone}
          {#if pending > 0}
            · <strong class="text-foreground">{pending} waiting for review</strong>
          {/if}
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-4">
        <nav class="flex items-center gap-1" aria-label="View">
          {#each Object.entries(VIEWS) as [value, label] (value)}
            <a
              href={hrefWith({ view: value, post: null })}
              aria-current={data.view === value ? 'page' : undefined}
              class="focus-visible:ring-ring/50 rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none {data.view ===
              value
                ? 'border-primary bg-primary/10 font-medium'
                : 'border-border hover:bg-muted'}">{label}</a
            >
          {/each}
        </nav>

        {#if month}
          <nav class="flex items-center gap-2" aria-label="Month">
            <a
              href={hrefWith({ month: month.prevYM, post: null })}
              class="border-border hover:bg-muted focus-visible:ring-ring/50 rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none"
              aria-label="Previous month">←</a
            >
            <a
              href={hrefWith({ month: null, post: null })}
              class="border-border hover:bg-muted focus-visible:ring-ring/50 rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none"
              >Today</a
            >
            <a
              href={hrefWith({ month: month.nextYM, post: null })}
              class="border-border hover:bg-muted focus-visible:ring-ring/50 rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none"
              aria-label="Next month">→</a
            >
          </nav>
        {/if}
      </div>
    </header>

    {#if form && form.id !== data.selectedId}
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

    {#if grid}
      <section aria-label="Month calendar" class="overflow-x-auto">
        <div class="min-w-[42rem]">
          <div class="text-muted-foreground flex pb-1 text-xs font-medium">
            {#each WEEKDAYS as weekday (weekday)}
              <div class="min-w-0 flex-1 basis-0 px-2">{weekday}</div>
            {/each}
          </div>

          <div class="bg-border flex flex-col gap-px overflow-hidden rounded-xl">
            {#each grid.weeks as week, w (w)}
              <div class="flex gap-px">
                {#each week as day (day.date)}
                  <div
                    class="bg-background flex min-h-24 min-w-0 flex-1 basis-0 flex-col gap-1 p-2 {day.inMonth
                      ? ''
                      : 'opacity-45'}"
                  >
                    <span
                      class="w-fit text-xs {day.date === data.today
                        ? 'bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 font-semibold'
                        : 'text-muted-foreground'}">{day.dayOfMonth}</span
                    >

                    {#each day.posts as post (post.id)}
                      {@const postState = stateOf(post.status)}
                      <a
                        href={hrefWith({ post: post.id })}
                        class="hover:bg-muted focus-visible:ring-ring/50 block rounded-md border px-1.5 py-1 text-xs focus-visible:ring-3 focus-visible:outline-none {postState.canApprove
                          ? 'border-primary/60 bg-primary/5'
                          : 'border-border'}"
                      >
                        <span class="block font-medium">
                          {post.scheduled_for ? timeInZone(post.scheduled_for, data.timezone) : '—'}
                          · {post.platform ?? 'post'}
                        </span>
                        <span class="text-muted-foreground line-clamp-2 block"
                          >{summarise(post)}</span
                        >
                      </a>
                    {/each}
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        </div>
      </section>

      {#if grid.undated.length > 0}
        <section aria-labelledby="undated-heading" class="flex flex-col gap-2">
          <h2 id="undated-heading" class="text-sm font-semibold">
            Drafts without a date ({grid.undated.length})
          </h2>
          <ul class="flex flex-wrap gap-2">
            {#each grid.undated as post (post.id)}
              {@const postState = stateOf(post.status)}
              <li>
                <a
                  href={hrefWith({ post: post.id })}
                  class="border-border hover:bg-muted focus-visible:ring-ring/50 flex max-w-xs flex-col gap-1 rounded-lg border border-dashed px-3 py-2 text-xs focus-visible:ring-3 focus-visible:outline-none"
                >
                  <span class="flex items-center gap-2">
                    <span class="font-medium">{post.platform ?? 'post'}</span>
                    <Badge variant={postState.tone}>{postState.label}</Badge>
                  </span>
                  <span class="text-muted-foreground line-clamp-2">{summarise(post)}</span>
                </a>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {:else}
      <nav aria-label="Filter by status" class="flex flex-wrap gap-2">
        {#each STATUS_FILTERS as filter (filter.value)}
          <a
            href={hrefWith({ status: filter.value === 'all' ? null : filter.value, post: null })}
            aria-current={data.status === filter.value ? 'page' : undefined}
            class="focus-visible:ring-ring/50 rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none {data.status ===
            filter.value
              ? 'border-primary bg-primary/10 font-medium'
              : 'border-border hover:bg-muted'}">{filter.label}</a
          >
        {/each}
      </nav>

      {#if data.posts.length === 0}
        <p class="text-muted-foreground text-sm">Nothing here.</p>
      {:else}
        <ul class="border-border divide-border divide-y overflow-hidden rounded-xl border">
          {#each data.posts as post (post.id)}
            {@const postState = stateOf(post.status)}
            <li>
              <a
                href={hrefWith({ post: post.id })}
                class="hover:bg-muted focus-visible:ring-ring/50 flex flex-col gap-1 px-4 py-3 focus-visible:ring-3 focus-visible:outline-none"
              >
                <span class="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant={postState.tone}>{postState.label}</Badge>
                  <span class="font-medium">{platformsOf(post).join(' · ') || 'post'}</span>
                  <span class="text-muted-foreground">{whenLabel(post, data.timezone)}</span>
                </span>
                <span class="line-clamp-2 text-sm">{summarise(post)}</span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</div>

{#if PostPanel && data.detail && data.selectedId}
  {#key data.selectedId}
    <PostPanel
      id={data.selectedId}
      detail={data.detail}
      timezone={data.timezone}
      {form}
      onclose={close}
    />
  {/key}
{/if}
