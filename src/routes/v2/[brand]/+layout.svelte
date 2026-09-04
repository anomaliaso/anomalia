<script lang="ts">
  import '$lib/styles/tailwind.css';
  import { page } from '$app/state';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();

  const base = $derived(`/v2/${data.slug}`);

  // Le voci senza `href` non sono link: la pagina non esiste ancora, e un 404 è peggio di una
  // riga spenta. Quando la superficie arriva, qui cambia solo l'href.
  const NAV = $derived([
    { label: 'Home', href: base, badge: 0 },
    { label: 'Materials', href: null, badge: 0 },
    { label: 'Strategy', href: null, badge: 0 },
    { label: 'Calendar', href: `${base}/calendar`, badge: data.pendingCount },
    { label: 'Posts', href: `${base}/posts`, badge: 0 },
    { label: 'Results', href: null, badge: 0 }
  ]);

  function isCurrent(href: string): boolean {
    return href === base ? page.url.pathname === base : page.url.pathname.startsWith(href);
  }
</script>

<div class="bg-background text-foreground flex min-h-screen flex-col sm:flex-row">
  <aside class="border-border flex flex-col gap-4 border-b p-4 sm:w-56 sm:border-r sm:border-b-0">
    <p class="truncate text-base font-semibold">{data.brandName}</p>

    <nav aria-label="Brand" class="flex flex-wrap gap-1 sm:flex-col">
      {#each NAV as item (item.label)}
        {#if item.href}
          <a
            href={item.href}
            aria-current={isCurrent(item.href) ? 'page' : undefined}
            class="hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none {isCurrent(
              item.href
            )
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

  <div class="flex min-w-0 flex-1 flex-col">{@render children()}</div>
</div>
