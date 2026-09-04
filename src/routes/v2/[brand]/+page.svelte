<script lang="ts">
  import '$lib/styles/tailwind.css';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import McpGuide from './McpGuide.svelte';
  import { attentionLine } from './dashboard';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const brand = $derived(data.brand);
  const facts = $derived(data.facts);

  // Le voci senza `href` non sono link: la pagina non esiste ancora, e un 404 è peggio di una
  // riga spenta. Quando la superficie arriva, qui cambia solo l'href.
  const NAV = $derived([
    { label: 'Home', href: `/v2/${data.slug}`, badge: 0 },
    { label: 'Materials', href: null, badge: 0 },
    { label: 'Strategy', href: null, badge: 0 },
    { label: 'Calendar', href: `/v2/${data.slug}/calendar`, badge: facts.pending },
    { label: 'Posts', href: `/v2/${data.slug}/posts`, badge: 0 },
    { label: 'Results', href: null, badge: 0 }
  ]);

  const TILES = $derived([
    { label: 'Published', value: facts.published },
    { label: 'Scheduled', value: facts.scheduled },
    { label: 'Waiting for you', value: facts.pending }
  ]);
</script>

<svelte:head><title>{brand.name}</title></svelte:head>

<div class="bg-background text-foreground flex min-h-screen flex-col sm:flex-row">
  <aside class="border-border flex flex-col gap-4 border-b p-4 sm:w-56 sm:border-r sm:border-b-0">
    <p class="truncate text-base font-semibold">{brand.name}</p>

    <nav aria-label="Brand" class="flex flex-wrap gap-1 sm:flex-col">
      {#each NAV as item (item.label)}
        {#if item.href}
          <a
            href={item.href}
            aria-current={item.label === 'Home' ? 'page' : undefined}
            class="hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none {item.label ===
            'Home'
              ? 'bg-muted font-medium'
              : ''}"
          >
            <span>{item.label}</span>
            {#if item.badge > 0}
              <Badge variant="default">{item.badge}</Badge>
            {/if}
          </a>
        {:else}
          <span
            aria-disabled="true"
            title="Not built yet"
            class="text-muted-foreground/60 flex items-center rounded-lg px-3 py-1.5 text-sm"
            >{item.label}</span
          >
        {/if}
      {/each}
    </nav>
  </aside>

  <main class="flex min-w-0 flex-1 flex-col gap-6 px-4 py-6 sm:px-8">
    <McpGuide />

    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex flex-col gap-0.5">
        <h1 class="text-2xl font-semibold">To do</h1>
        <p class="text-muted-foreground text-sm">{attentionLine(data.todos.length)}</p>
      </div>

      <details class="relative">
        <summary
          class="border-border hover:bg-muted focus-visible:ring-ring/50 cursor-pointer list-none rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none"
          >Share</summary
        >
        <div
          class="border-border bg-card absolute right-0 z-10 mt-2 flex w-80 flex-col gap-3 rounded-xl border p-3 text-sm shadow-lg"
        >
          <p class="text-muted-foreground text-xs">
            A read-only snapshot of this month for the client: what went out, what is planned, and
            the reach. No actions, no setup, no account.
          </p>

          <form method="POST" action="?/share">
            <button
              type="submit"
              class="border-border hover:bg-muted focus-visible:ring-ring/50 w-full rounded-lg border px-3 py-1.5 focus-visible:ring-3 focus-visible:outline-none"
              >Create a client link</button
            >
          </form>

          {#if form?.message}
            <p role="alert" class="text-destructive text-xs">{form.message}</p>
          {/if}

          {#if form?.revoked}
            <p role="status" class="text-muted-foreground text-xs">
              Revoked. It now answers like a link that never existed.
            </p>
          {/if}

          {#if form?.url}
            <label class="flex flex-col gap-1 text-xs">
              <span>Copy it now — it is shown once.</span>
              <input
                readonly
                value={form.url}
                onfocus={(e) => e.currentTarget.select()}
                class="border-border bg-background w-full rounded-md border px-2 py-1 font-mono text-xs"
              />
            </label>
          {/if}

          {#if data.liveShares.length > 0}
            <ul class="flex flex-col gap-1 text-xs">
              {#each data.liveShares as share (share.id)}
                <li class="flex items-center justify-between gap-2">
                  <span class="text-muted-foreground"
                    >Link of {new Date(share.created_at).toLocaleDateString()}</span
                  >
                  <form method="POST" action="?/revoke">
                    <input type="hidden" name="id" value={share.id} />
                    <button type="submit" class="text-destructive underline underline-offset-4"
                      >Revoke</button
                    >
                  </form>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </details>
    </header>

    <section aria-label="To do" class="flex flex-col gap-2">
      {#if data.todos.length === 0}
        <p class="text-muted-foreground text-sm">Nothing needs you right now.</p>
      {:else}
        {#each data.todos as todo (todo.id)}
          <article
            class="border-border bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
          >
            <div class="flex min-w-0 flex-col">
              <p class="font-medium">{todo.title}</p>
              <p class="text-muted-foreground text-sm">{todo.detail}</p>
            </div>
            {#if todo.action}
              <a
                href={todo.action.href}
                class="border-border hover:bg-muted focus-visible:ring-ring/50 flex-none rounded-lg border px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none"
                >{todo.action.label}</a
              >
            {/if}
          </article>
        {/each}
      {/if}
    </section>

    <section aria-labelledby="next-out" class="flex flex-col gap-2">
      <h2 id="next-out" class="text-muted-foreground text-sm">Next out</h2>

      {#if data.upcoming.length === 0}
        <p class="text-muted-foreground text-sm">Nothing dated ahead.</p>
      {:else}
        <ul class="divide-border flex flex-col divide-y">
          {#each data.upcoming as row (row.id)}
            <li>
              <a
                href="/v2/{data.slug}/posts?post={row.id}"
                class="hover:bg-muted focus-visible:ring-ring/50 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md px-1 py-2 text-sm focus-visible:ring-3 focus-visible:outline-none"
              >
                <span class="text-muted-foreground w-16 flex-none">{row.day}</span>
                <span class="text-muted-foreground w-20 flex-none truncate text-xs"
                  >{row.platform}</span
                >
                <span class="min-w-0 flex-1 truncate font-medium">{row.title}</span>
                <Badge variant={row.state.tone}>{row.state.label}</Badge>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section aria-label="Numbers" class="flex flex-wrap gap-3">
      {#each TILES as tile (tile.label)}
        <div
          class="border-border bg-card flex min-w-36 flex-1 flex-col gap-1 rounded-xl border px-4 py-3"
        >
          <span class="text-muted-foreground text-xs">{tile.label}</span>
          <span class="text-2xl font-semibold">{tile.value}</span>
        </div>
      {/each}
    </section>

    <p class="text-muted-foreground text-xs">Times shown in {brand.timezone}</p>
  </main>
</div>
