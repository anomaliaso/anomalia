<script lang="ts">
  import '$lib/styles/tailwind.css';
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import LegalFooter from './LegalFooter.svelte';
  import { legal } from '$lib/legal';
  import type { Snippet } from 'svelte';

  let { children, activePage }: { children: Snippet; activePage: 'privacy' | 'terms' | 'cookies' } = $props();
</script>

<svelte:head>
  <meta name="robots" content="index,follow" />
</svelte:head>

<nav class="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-border">
  <div class="max-w-[760px] mx-auto px-6 flex items-center justify-between h-[52px]">
    <a class="font-bold text-lg tracking-tight text-foreground no-underline" href="/">0<span class="text-inherit">2</span>1</a>
    <div class="flex items-center">
      <a
        href="/privacy"
        class="text-sm text-muted-foreground no-underline ml-5 hover:text-foreground transition-colors"
        class:font-semibold={activePage === 'privacy'}
        class:text-primary={activePage === 'privacy'}
      >{$_('legal.privacy.nav.privacy')}</a>
      <a
        href="/terms"
        class="text-sm text-muted-foreground no-underline ml-5 hover:text-foreground transition-colors"
        class:font-semibold={activePage === 'terms'}
        class:text-primary={activePage === 'terms'}
      >{$_('legal.terms.nav.terms')}</a>
      <a
        href="/cookies"
        class="text-sm text-muted-foreground no-underline ml-5 hover:text-foreground transition-colors"
        class:font-semibold={activePage === 'cookies'}
        class:text-primary={activePage === 'cookies'}
      >{$_('legal.privacy.foot.cookies')}</a>
    </div>
  </div>
</nav>

<main class="py-14 pb-24">
  <div class="max-w-[760px] mx-auto px-6">
    {@render children()}
  </div>
</main>

<LegalFooter {legal} />
