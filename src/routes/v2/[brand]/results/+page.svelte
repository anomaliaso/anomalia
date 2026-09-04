<script lang="ts">
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { METRIC_LABELS, compact, reachOf } from './tally';
  import type { TopPost } from './tally';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const reach = $derived(reachOf(data.platforms));

  const headline = $derived([
    { label: 'Published', value: compact(reach.posts) },
    { label: 'Scheduled', value: compact(data.counts.scheduled) },
    { label: 'Awaiting review', value: compact(data.counts.pending) },
    { label: 'Views', value: compact(reach.views) }
  ]);

  function scoreOf(post: TopPost): string {
    return METRIC_LABELS.map(({ key, label }) => ({ label, value: post.metrics[key] }))
      .filter((m) => typeof m.value === 'number')
      .map((m) => `${compact(m.value)} ${m.label.toLowerCase()}`)
      .join(' · ');
  }

  function excerpt(caption: string | null): string {
    const copy = (caption ?? '').trim().replace(/\s+/g, ' ');
    return copy.length > 80 ? `${copy.slice(0, 80)}…` : copy || 'Untitled';
  }

  function dayOf(iso: string): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: data.brand.timezone,
      day: 'numeric',
      month: 'short'
    }).format(new Date(iso));
  }
</script>

<svelte:head><title>Results — {data.brand.name}</title></svelte:head>

<div class="bg-background text-foreground min-h-screen px-4 py-8 sm:px-8">
  <div class="mx-auto flex max-w-4xl flex-col gap-8">
    <header class="flex flex-col gap-1">
      <p class="text-muted-foreground text-xs tracking-wide uppercase">{data.brand.name}</p>
      <h1 class="text-2xl font-semibold">Results</h1>
      <p class="text-muted-foreground text-xs">
        Everything below is measured, not estimated. Platform numbers come from the accounts
        themselves — {data.counts.accounts} connected.
      </p>
    </header>

    <section aria-label="Headline numbers" class="flex flex-wrap gap-3">
      {#each headline as tile (tile.label)}
        <div class="border-border flex min-w-36 flex-1 flex-col gap-1 rounded-xl border px-4 py-3">
          <span class="text-muted-foreground text-xs">{tile.label}</span>
          <span class="text-2xl font-semibold">{tile.value}</span>
        </div>
      {/each}
    </section>

    <section aria-labelledby="platforms" class="flex flex-col gap-2">
      <h2 id="platforms" class="text-sm font-semibold">By platform</h2>
      {#if data.platforms.length === 0}
        <p class="text-muted-foreground text-sm">
          Nothing published yet, so there is nothing to measure.
        </p>
      {:else}
        <ul class="border-border divide-border divide-y rounded-xl border">
          {#each data.platforms as row (row.platform)}
            <li class="flex flex-col gap-1 px-4 py-3">
              <span class="flex items-baseline gap-2 text-sm">
                <span class="font-medium">{row.platform || 'unknown'}</span>
                <span class="text-muted-foreground text-xs">{row.posts} published</span>
              </span>
              <span class="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {#each METRIC_LABELS as metric (metric.key)}
                  <span
                    ><span class="text-foreground font-medium"
                      >{compact(row.totals[metric.key] ?? 0)}</span
                    >
                    {metric.label.toLowerCase()}</span
                  >
                {/each}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if data.topPosts.length > 0}
      <section aria-labelledby="best" class="flex flex-col gap-2">
        <h2 id="best" class="text-sm font-semibold">What worked</h2>
        <ul class="border-border divide-border divide-y rounded-xl border">
          {#each data.topPosts as post (post.id)}
            <li class="flex items-start gap-3 px-4 py-3">
              {#if post.thumbnail_url}
                <img
                  src={post.thumbnail_url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  class="border-border h-14 w-14 shrink-0 rounded-lg border object-cover"
                />
              {/if}
              <div class="flex min-w-0 flex-col gap-1">
                <span class="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">{post.platform ?? 'post'}</Badge>
                  {#if post.published_at}
                    <span class="text-muted-foreground">{dayOf(post.published_at)}</span>
                  {/if}
                </span>
                <span class="line-clamp-2 text-sm">{excerpt(post.caption)}</span>
                <span class="text-muted-foreground text-xs">{scoreOf(post)}</span>
                {#if post.url}
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noreferrer"
                    class="text-xs underline underline-offset-4">See it live</a
                  >
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section aria-labelledby="delivery" class="flex flex-col gap-2">
      <h2 id="delivery" class="text-sm font-semibold">Delivery</h2>
      <p class="text-muted-foreground text-sm">
        {data.counts.total} posts in the brand, {data.counts.failed} of them failed to go out.
      </p>
      {#if data.failures.length > 0}
        <ul class="border-destructive/40 divide-border divide-y rounded-xl border">
          {#each data.failures as failure (failure.id)}
            <li class="flex flex-col gap-1 px-4 py-3 text-sm">
              <span class="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="destructive">{failure.status}</Badge>
                <span class="font-medium">{failure.platform ?? 'unknown'}</span>
                <span class="text-muted-foreground">{dayOf(failure.created_at)}</span>
              </span>
              <span class="line-clamp-1">{excerpt(failure.caption)}</span>
              {#if failure.error}
                <span class="text-destructive text-xs">{failure.error}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if data.web.length > 0}
      <section aria-labelledby="web" class="flex flex-col gap-2">
        <h2 id="web" class="text-sm font-semibold">Web</h2>
        <ul class="flex flex-wrap gap-3">
          {#each data.web as metric (metric.label)}
            <li
              class="border-border flex min-w-32 flex-col gap-1 rounded-xl border px-3 py-2 text-sm"
            >
              <span class="text-muted-foreground text-xs">{metric.label}</span>
              <span class="font-semibold">{metric.value}</span>
            </li>
          {/each}
        </ul>
        <p class="text-muted-foreground text-xs">
          Only the figures the last audit actually measured are listed.
        </p>
      </section>
    {/if}
  </div>
</div>
