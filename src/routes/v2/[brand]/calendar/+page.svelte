<script lang="ts">
  import '$lib/styles/tailwind.css';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { buildMonthGrid, timeInZone } from './calendar-month';
  import { stateOf } from '../post-state';
  import type { PostRow } from '../post-state';
  import type { PageProps } from './$types';

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  let { data, form }: PageProps = $props();

  const calendar = $derived(data.calendar);
  const grid = $derived(
    buildMonthGrid(calendar.year, calendar.month, calendar.posts, calendar.timezone)
  );
  const pendingCount = $derived(calendar.posts.filter((p) => p.status === 'pending_user').length);
  const datedCount = $derived(calendar.posts.length - grid.undated.length);

  let selectedId = $state<string | null>(data.selectedPostId);
  let PostPanel = $state<typeof import('../PostPanel.svelte').default | null>(null);

  const selected = $derived(calendar.posts.find((p) => p.id === selectedId) ?? null);

  $effect(() => {
    if (selectedId && !PostPanel) {
      import('../PostPanel.svelte').then((m) => (PostPanel = m.default));
    }
  });

  function monthHref(ym: string): string {
    return `?month=${ym}`;
  }

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

  function summary(post: PostRow): string {
    return (post.caption ?? '').trim().slice(0, 60) || 'Untitled';
  }
</script>

<svelte:head><title>{calendar.monthLabel} — {data.brand}</title></svelte:head>

<div class="bg-background text-foreground min-h-screen px-4 py-8 sm:px-8">
  <div class="mx-auto flex max-w-6xl flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div class="flex flex-col gap-1">
        <p class="text-muted-foreground text-xs tracking-wide uppercase">{data.brand}</p>
        <h1 class="text-2xl font-semibold">{calendar.monthLabel}</h1>
        <p class="text-muted-foreground text-xs">
          Times shown in {calendar.timezone}
          {#if pendingCount > 0}
            · <strong class="text-foreground">{pendingCount} waiting for review</strong>
          {/if}
        </p>
      </div>

      <nav class="flex items-center gap-2" aria-label="Month">
        <a
          href={monthHref(calendar.prevYM)}
          class="border-border hover:bg-muted focus-visible:ring-ring/50 rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none"
          aria-label="Previous month">←</a
        >
        <a
          href="?"
          class="border-border hover:bg-muted focus-visible:ring-ring/50 rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none"
          >Today</a
        >
        <a
          href={monthHref(calendar.nextYM)}
          class="border-border hover:bg-muted focus-visible:ring-ring/50 rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none"
          aria-label="Next month">→</a
        >
      </nav>
    </header>

    {#if form && form.id !== selectedId}
      <p
        role={form.message && !form.approved ? 'alert' : 'status'}
        class="rounded-lg border px-3 py-2 text-sm {form.message && !form.approved
          ? 'border-destructive/40 text-destructive'
          : 'border-border'}"
      >
        {form.message ?? (form.approved ? `Approved — the post is now ${form.status}.` : 'Copy saved.')}
      </p>
    {/if}

    <section aria-label="Month calendar" class="overflow-x-auto">
      <div class="min-w-[42rem]">
        <div class="text-muted-foreground grid grid-cols-7 gap-px pb-1 text-xs font-medium">
          {#each WEEKDAYS as weekday (weekday)}
            <div class="px-2">{weekday}</div>
          {/each}
        </div>

        <div class="bg-border grid grid-cols-7 gap-px overflow-hidden rounded-xl border-0">
          {#each grid.weeks as week, w (w)}
            {#each week as day (day.date)}
              <div
                class="bg-background flex h-full min-h-24 flex-col gap-1 p-2 {day.inMonth
                  ? ''
                  : 'opacity-45'}"
              >
                <div class="flex items-baseline gap-1">
                  <span
                    class="text-xs {day.date === data.today
                      ? 'bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 font-semibold'
                      : 'text-muted-foreground'}">{day.dayOfMonth}</span
                  >
                </div>

                {#each day.posts as post (post.id)}
                  {@const postState = stateOf(post.status)}
                  <button
                    type="button"
                    onclick={() => open(post)}
                    class="hover:bg-muted focus-visible:ring-ring/50 w-full rounded-md border px-1.5 py-1 text-left text-xs focus-visible:ring-3 focus-visible:outline-none {postState.canApprove
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-border'}"
                  >
                    <span class="block font-medium">
                      {post.scheduled_for ? timeInZone(post.scheduled_for, calendar.timezone) : '—'}
                      · {post.platform ?? 'post'}
                    </span>
                    <span class="text-muted-foreground line-clamp-2 block">{summary(post)}</span>
                  </button>
                {/each}
              </div>
            {/each}
          {/each}
        </div>
      </div>
    </section>

    {#if datedCount === 0}
      <p class="text-muted-foreground text-sm">Nothing planned in {calendar.monthLabel}.</p>
    {/if}

    <section aria-labelledby="undated-heading" class="flex flex-col gap-2">
      <h2 id="undated-heading" class="text-sm font-semibold">
        Drafts without a date ({grid.undated.length})
      </h2>
      <p class="text-muted-foreground text-xs">
        Written, not on the calendar. They stay here until a date is set.
      </p>

      {#if grid.undated.length === 0}
        <p class="text-muted-foreground text-sm">None.</p>
      {:else}
        <ul class="flex flex-wrap gap-2">
          {#each grid.undated as post (post.id)}
            {@const postState = stateOf(post.status)}
            <li>
              <button
                type="button"
                onclick={() => open(post)}
                class="border-border hover:bg-muted focus-visible:ring-ring/50 flex max-w-xs flex-col gap-1 rounded-lg border border-dashed px-3 py-2 text-left text-xs focus-visible:ring-3 focus-visible:outline-none"
              >
                <span class="flex items-center gap-2">
                  <span class="font-medium">{post.platform ?? 'post'}</span>
                  <Badge variant={postState.tone}>{postState.label}</Badge>
                </span>
                <span class="text-muted-foreground line-clamp-2">{summary(post)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</div>

{#if PostPanel && selected}
  {#key selected.id}
    <PostPanel post={selected} timezone={calendar.timezone} {form} onclose={close} />
  {/key}
{/if}
