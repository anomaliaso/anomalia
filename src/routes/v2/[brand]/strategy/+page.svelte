<script lang="ts">
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { listOf, pairsOf, platformsOf, stateOf, textOf, weeksOf } from './plan-shape';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const plan = $derived(data.plan);
  const weeks = $derived(weeksOf(plan, data.currentWeek));
  const voice = $derived(plan ? pairsOf(plan) : []);
  const platforms = $derived(plan ? platformsOf(plan) : []);
  const strategy = $derived(textOf(plan, 'strategy'));
  const cadence = $derived(textOf(plan, 'cadence'));
  const changes = $derived(listOf(data.proposed, 'changes_summary'));
  const truth = $derived(data.truth);
</script>

<svelte:head><title>Strategy — {data.brand.name}</title></svelte:head>

<div class="bg-background text-foreground min-h-screen px-4 py-8 sm:px-8">
  <div class="mx-auto flex max-w-3xl flex-col gap-8">
    <header class="flex flex-col gap-1">
      <p class="text-muted-foreground text-xs tracking-wide uppercase">{data.brand.name}</p>
      <h1 class="text-2xl font-semibold">Strategy</h1>
      <p class="text-muted-foreground text-xs">
        {#if cadence}{cadence} · {/if}{data.quota.used} posts used this month, {data.quota
          .remaining} left
      </p>
    </header>

    {#if !plan}
      <p class="border-border rounded-xl border px-4 py-3 text-sm">
        No active editorial plan. Anomalia writes one during onboarding and rewrites it every
        cycle — until then there is nothing here to read.
      </p>
    {:else}
      {#if strategy}
        <section aria-labelledby="bet" class="flex flex-col gap-2">
          <h2 id="bet" class="text-sm font-semibold">The bet</h2>
          <p class="text-sm leading-relaxed">{strategy}</p>
        </section>
      {/if}

      {#if voice.length > 0}
        <section aria-labelledby="voice" class="flex flex-col gap-2">
          <h2 id="voice" class="text-sm font-semibold">Voice</h2>
          <dl class="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {#each voice as pair (pair.label)}
              <div class="flex flex-col">
                <dt class="text-muted-foreground text-xs">{pair.label}</dt>
                <dd>{pair.value}</dd>
              </div>
            {/each}
          </dl>
        </section>
      {/if}

      {#if platforms.length > 0}
        <section aria-labelledby="where" class="flex flex-col gap-2">
          <h2 id="where" class="text-sm font-semibold">Where it goes</h2>
          <ul class="border-border divide-border divide-y rounded-xl border">
            {#each platforms as row (row.platform)}
              <li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <span class="font-medium">{row.platform}</span>
                {#if row.share}<Badge variant="outline">{row.share}</Badge>{/if}
                {#if row.role}<span class="text-muted-foreground">{row.role}</span>{/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <section aria-labelledby="weeks" class="flex flex-col gap-2">
        <h2 id="weeks" class="text-sm font-semibold">The cycle</h2>
        {#if weeks.length === 0}
          <p class="text-muted-foreground text-sm">The plan carries no weeks.</p>
        {:else}
          <ol class="border-border divide-border divide-y rounded-xl border">
            {#each weeks as week (week.index)}
              {@const state = stateOf(week.status)}
              <li class="flex flex-col gap-1 px-4 py-3 {week.current ? 'bg-primary/5' : ''}">
                <div class="flex flex-wrap items-center gap-2 text-xs">
                  <span class="text-muted-foreground">{week.label}</span>
                  <Badge variant={state.tone}>{state.label}</Badge>
                  {#if week.current}
                    <span class="text-primary font-medium">Now</span>
                  {/if}
                </div>
                <p class="text-sm font-medium">{week.theme}</p>
                {#if week.focus}
                  <p class="text-muted-foreground text-sm">{week.focus}</p>
                {/if}
                {#if week.mix}
                  <p class="text-muted-foreground text-xs">{week.mix}</p>
                {/if}
                {#if week.brief}
                  <p class="text-sm">
                    <span class="text-muted-foreground text-xs">Your brief — </span>{week.brief}
                  </p>
                {/if}
              </li>
            {/each}
          </ol>
        {/if}
      </section>
    {/if}

    {#if data.proposed}
      <section aria-labelledby="proposed" class="border-border flex flex-col gap-2 rounded-xl border p-4">
        <h2 id="proposed" class="text-sm font-semibold">A new plan is waiting</h2>
        <p class="text-sm leading-relaxed">{textOf(data.proposed, 'strategy')}</p>
        {#if changes.length > 0}
          <ul class="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
            {#each changes as change (change)}
              <li>{change}</li>
            {/each}
          </ul>
        {/if}
        {#if data.proposedFeedback}
          <p class="text-muted-foreground text-xs">Your feedback: {data.proposedFeedback}</p>
        {/if}
        <p class="text-muted-foreground text-xs">
          Accepting or rejecting it is not done from here yet.
        </p>
      </section>
    {/if}

    <section aria-labelledby="truth" class="flex flex-col gap-3">
      <h2 id="truth" class="text-sm font-semibold">What the plan is built on</h2>

      {#if truth.pillars.length > 0}
        <div class="flex flex-col gap-1.5">
          <p class="text-muted-foreground text-xs">Content pillars</p>
          <ul class="flex flex-wrap gap-1.5">
            {#each truth.pillars as pillar (pillar)}
              <li><Badge variant="secondary">{pillar}</Badge></li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if truth.platforms.length > 0}
        <div class="flex flex-col gap-1.5">
          <p class="text-muted-foreground text-xs">Selected platforms</p>
          <ul class="flex flex-wrap gap-1.5">
            {#each truth.platforms as platform (platform)}
              <li><Badge variant="outline">{platform}</Badge></li>
            {/each}
          </ul>
        </div>
      {/if}

      <dl class="text-muted-foreground flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div class="flex flex-col">
          <dt class="text-xs">Language</dt>
          <dd class="text-foreground">{truth.language}</dd>
        </div>
        <div class="flex flex-col">
          <dt class="text-xs">Products</dt>
          <dd class="text-foreground">{truth.products}</dd>
        </div>
        <div class="flex flex-col">
          <dt class="text-xs">People</dt>
          <dd class="text-foreground">{truth.people}</dd>
        </div>
        <div class="flex flex-col">
          <dt class="text-xs">Competitors</dt>
          <dd class="text-foreground">{truth.competitors}</dd>
        </div>
        <div class="flex flex-col">
          <dt class="text-xs">Documents</dt>
          <dd class="text-foreground">{truth.documents}</dd>
        </div>
        <div class="flex flex-col">
          <dt class="text-xs">Studio filled</dt>
          <dd class="text-foreground">{truth.completeness}%</dd>
        </div>
      </dl>
    </section>
  </div>
</div>
