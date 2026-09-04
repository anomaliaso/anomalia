<script lang="ts">
  import '$lib/styles/tailwind.css';
  import { momentInZone } from './overview';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const brand = $derived(data.brand);
  const counts = $derived(data.counts);
  const next = $derived(data.next);
  const lastRun = $derived(data.lastRun);

  const facts = $derived([
    { label: 'Brand status', value: brand.status },
    { label: 'Plan', value: brand.plan ?? 'none' },
    { label: 'Connected accounts', value: String(counts.accounts) },
    { label: 'Editorial plan', value: data.hasEditorialPlan ? 'active' : 'none' },
    { label: 'Scheduled', value: String(counts.scheduled) },
    { label: 'Published', value: String(counts.published) },
    { label: 'Timezone', value: brand.timezone }
  ]);

  function summary(caption: string | null): string {
    const copy = (caption ?? '').trim().replace(/\s+/g, ' ');
    return copy.length > 120 ? `${copy.slice(0, 120)}…` : copy || 'Untitled';
  }
</script>

<svelte:head><title>{brand.name}</title></svelte:head>

<div class="bg-background text-foreground min-h-screen px-4 py-8 sm:px-8">
  <div class="mx-auto flex max-w-3xl flex-col gap-8">
    <header class="flex flex-col gap-1">
      <p class="text-muted-foreground text-xs tracking-wide uppercase">{data.slug}</p>
      <h1 class="text-2xl font-semibold">{brand.name}</h1>
    </header>

    <section aria-labelledby="waiting" class="flex flex-col gap-2">
      <h2 id="waiting" class="text-sm font-semibold">Waiting for you</h2>
      {#if counts.pending === 0}
        <p class="text-muted-foreground text-sm">Nothing to approve.</p>
      {:else}
        <p class="text-3xl font-semibold">{counts.pending}</p>
        <p class="text-sm">
          <a href="/v2/{data.slug}/posts?status=pending_user" class="underline underline-offset-4">
            {counts.pending === 1 ? 'Review it' : 'Review them'}
          </a>
        </p>
      {/if}
    </section>

    <section aria-labelledby="next-out" class="flex flex-col gap-2">
      <h2 id="next-out" class="text-sm font-semibold">Next out</h2>
      {#if !next}
        <p class="text-muted-foreground text-sm">Nothing scheduled.</p>
      {:else}
        <p class="text-sm">
          <span class="font-medium">{next.platform ?? 'post'}</span> ·
          {momentInZone(next.scheduled_for as string, brand.timezone)}
        </p>
        <p class="text-muted-foreground text-sm">{summary(next.caption)}</p>
        <p class="text-sm">
          <a href="/v2/{data.slug}/posts?post={next.id}" class="underline underline-offset-4"
            >Open it</a
          >
        </p>
      {/if}
    </section>

    <section aria-labelledby="state" class="flex flex-col gap-2">
      <h2 id="state" class="text-sm font-semibold">Brand state</h2>
      <dl class="border-border divide-border divide-y overflow-hidden rounded-xl border text-sm">
        {#each facts as fact (fact.label)}
          <div class="flex items-baseline justify-between gap-4 px-4 py-2">
            <dt class="text-muted-foreground">{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        {/each}
      </dl>

      {#if lastRun}
        <p class="text-muted-foreground text-xs">
          Last automation run: {lastRun.status}
          {#if lastRun.posts_created}· {lastRun.posts_created} posts{/if}
          · {momentInZone(lastRun.created_at, brand.timezone)}
        </p>
        {#if lastRun.error}
          <p role="alert" class="text-destructive text-xs">{lastRun.error}</p>
        {/if}
      {:else}
        <p class="text-muted-foreground text-xs">No automation run recorded yet.</p>
      {/if}
    </section>

    <nav aria-label="Brand" class="flex flex-wrap gap-2">
      <a
        href="/v2/{data.slug}/calendar"
        class="border-border hover:bg-muted focus-visible:ring-ring/50 rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none"
        >Calendar</a
      >
      <a
        href="/v2/{data.slug}/posts"
        class="border-border hover:bg-muted focus-visible:ring-ring/50 rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none"
        >Posts</a
      >
    </nav>
  </div>
</div>
