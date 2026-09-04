<script lang="ts">
  import '$lib/styles/tailwind.css';
  import { page } from '$app/state';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { navFor } from './nav';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();

  const nav = $derived(navFor(data.slug, page.url.pathname, data.pendingCount));
</script>

<div class="bg-background text-foreground flex min-h-screen flex-col sm:flex-row">
  <aside class="border-border flex flex-col gap-4 border-b p-4 sm:w-56 sm:border-r sm:border-b-0">
    <p class="truncate text-base font-semibold">{data.brandName}</p>

    <nav aria-label="Brand" class="flex flex-wrap gap-1 sm:flex-col">
      {#each nav as item (item.label)}
        <a
          href={item.href}
          aria-current={item.current ? 'page' : undefined}
          class="hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none {item.current
            ? 'bg-muted font-medium'
            : ''}"
        >
          <span>{item.label}</span>
          {#if item.badge > 0}
            <Badge variant="default">{item.badge}</Badge>
          {/if}
        </a>
      {/each}
    </nav>
  </aside>

  <div class="flex min-w-0 flex-1 flex-col">{@render children()}</div>
</div>
