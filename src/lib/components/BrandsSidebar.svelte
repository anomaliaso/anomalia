<script lang="ts">
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils.js';
  import { locale, _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { goto, invalidateAll } from '$app/navigation';
  import { SUPPORTED, localePath, type Locale } from '$lib/i18n/locale';
  import { Sun, Moon, LogOut, Key, Plus, ChevronDown, LayoutGrid, FileText, Mail } from '@lucide/svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { useSidebar } from '$lib/components/ui/sidebar/context.svelte.js';

  let {
    draftCount = 0,
    inviteCount = 0,
    userName = 'User',
    userEmail = '',
    userInitials = 'U',
    signOutLabel = 'Sign out',
  }: {
    draftCount?: number;
    inviteCount?: number;
    userName?: string;
    userEmail?: string;
    userInitials?: string;
    signOutLabel?: string;
  } = $props();

  const sidebar = useSidebar();

  const view = $derived($page.url.searchParams.get('view') ?? 'brands');

  function navTo(url: string) {
    goto(url);
    if (sidebar.isMobile && sidebar.openMobile) sidebar.setOpenMobile(false);
  }

  // Theme toggle
  let theme = $state<'light' | 'dark'>('light');
  $effect(() => {
    if (typeof window === 'undefined') return;
    const read = () => (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') ?? 'light';
    theme = read();
    const obs = new MutationObserver(() => (theme = read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  });
  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    theme = next;
  }

  // Locale
  const currentLocale = $derived(($locale ?? $page.data.locale ?? 'en') as Locale);
  async function chooseLocale(l: Locale) {
    if (l === currentLocale) return;
    document.cookie = `locale=${l};path=/;max-age=31536000;samesite=lax`;
    locale.set(l);
    if (typeof document !== 'undefined') document.documentElement.lang = l;
    fetch('/api/v1/locale', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: l }) }).catch(() => {});
    if ($page.route.id?.startsWith('/[[lang=locale]]')) {
      const basePath = $page.url.pathname.replace(/^\/(en|it)(?=\/|$)/, '') || '/';
      await goto(localePath(basePath, l));
    } else {
      await invalidateAll();
    }
  }
</script>

<Sidebar.Root collapsible="icon">

  <Sidebar.Header class="shell-top-header gap-0 border-b border-sidebar-border px-3 group-data-[collapsible=icon]:px-2">
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <div class="flex items-center w-full group-data-[collapsible=icon]:justify-center">
          <a href="/app" class="sidebar-brand-group flex items-center gap-2 flex-1 min-w-0 group-data-[collapsible=icon]:hidden" style="color: inherit; text-decoration: none;">
            <BrandMark size={36} />
            <span class="truncate text-sm font-semibold">Anomalia</span>
          </a>
          <div class="shrink-0 group-data-[collapsible=icon]:hidden">
            <Sidebar.Trigger />
          </div>
          <div class="hidden group-data-[collapsible=icon]:flex">
            <Sidebar.Trigger />
          </div>
        </div>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Header>

  <Sidebar.Content class="flex-1 overflow-y-auto p-4 group-data-[collapsible=icon]:p-3 group-data-[collapsible=icon]:overflow-visible">
    <!-- New brand button -->
    <div class="mb-3 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
      <Button href="/app/onboarding" size="sm" class="w-full gap-2 group-data-[collapsible=icon]:w-auto group-data-[collapsible=icon]:px-2">
        <Plus class="size-4 shrink-0" strokeWidth={2} />
        <span class="group-data-[collapsible=icon]:hidden">{$_('app.brands.newBrand')}</span>
      </Button>
    </div>

    <!-- Nav items -->
    <Sidebar.Menu class="gap-0">
      <Sidebar.MenuItem>
        <Sidebar.MenuButton
          isActive={view === 'brands'}
          tooltipContent={$_('app.brands.title')}
          class="hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
          onclick={() => navTo('/app')}
        >
          {#snippet child({ props })}
            <a href="/app" {...props} onclick={(e) => { e.preventDefault(); navTo('/app'); }}>
              <LayoutGrid class="size-4 shrink-0" strokeWidth={1.7} />
              <span class="truncate">{$_('app.brands.title')}</span>
            </a>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton
          isActive={view === 'drafts'}
          tooltipContent={$_('app.brands.draftsTitle')}
          class="hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
          onclick={() => navTo('/app?view=drafts')}
        >
          {#snippet child({ props })}
            <a href="/app?view=drafts" {...props} onclick={(e) => { e.preventDefault(); navTo('/app?view=drafts'); }}>
              <FileText class="size-4 shrink-0" strokeWidth={1.7} />
              <span class="truncate">{$_('app.brands.draftsTitle')}</span>
              {#if draftCount > 0}
                <span class="ml-auto text-[10px] font-medium text-muted-foreground tabular-nums">{draftCount}</span>
              {/if}
            </a>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton
          isActive={view === 'invites'}
          tooltipContent={$_('app.brands.invites.title')}
          class="hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
          onclick={() => navTo('/app?view=invites')}
        >
          {#snippet child({ props })}
            <a href="/app?view=invites" {...props} onclick={(e) => { e.preventDefault(); navTo('/app?view=invites'); }}>
              <Mail class="size-4 shrink-0" strokeWidth={1.7} />
              <span class="truncate">{$_('app.brands.invites.title')}</span>
              {#if inviteCount > 0}
                <span class="ml-auto text-[10px] font-medium text-muted-foreground tabular-nums">{inviteCount}</span>
              {/if}
            </a>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>

  </Sidebar.Content>

  <Sidebar.Footer class="p-4 group-data-[collapsible=icon]:p-3">
    <Sidebar.Menu class="group-data-[collapsible=icon]:mx-auto">
      <Sidebar.MenuItem>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Sidebar.MenuButton
                size="lg"
                class="cursor-pointer data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                {...props}
              >
                <div class="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground overflow-hidden">
                  <span class="text-xs font-bold">{userInitials}</span>
                </div>
                <div class="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                  <span class="truncate font-semibold">{userName}</span>
                  {#if userEmail}
                    <span class="truncate text-xs text-muted-foreground">{userEmail}</span>
                  {/if}
                </div>
                <ChevronDown class="size-4 ml-auto text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden" />
              </Sidebar.MenuButton>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content
            side={sidebar.isMobile || sidebar.state !== 'collapsed' ? 'top' : 'right'}
            align={sidebar.isMobile || sidebar.state !== 'collapsed' ? 'start' : 'end'}
            sideOffset={8}
            class="w-[min(14rem,calc(100vw-2rem))]"
          >
            <DropdownMenu.Label class="font-normal">
              <div class="flex flex-col space-y-1">
                <p class="text-sm font-medium">{userName}</p>
                {#if userEmail}
                  <p class="text-xs text-muted-foreground">{userEmail}</p>
                {/if}
              </div>
            </DropdownMenu.Label>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onclick={toggleTheme}>
              {#if theme === 'dark'}
                <Sun class="size-4" />
              {:else}
                <Moon class="size-4" />
              {/if}
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </DropdownMenu.Item>
            <div class="px-2 py-1.5 flex items-center justify-between">
              <span class="text-sm">{$_('common.lang.switch')}</span>
              <div class="flex gap-0.5 bg-muted rounded-md p-0.5">
                {#each SUPPORTED as l (l)}
                  <button
                    type="button"
                    class={cn(
                      'px-2 py-0.5 text-xs font-semibold rounded transition-colors',
                      currentLocale === l
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    onclick={() => chooseLocale(l)}
                  >
                    {l.toUpperCase()}
                  </button>
                {/each}
              </div>
            </div>
            <DropdownMenu.Separator />
            <DropdownMenu.Item>
              <a href="/app/api-keys" class="flex items-center w-full">
                <Key class="size-4 mr-2" strokeWidth={1.7} />
                <span>API Keys</span>
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <form method="POST" action="/auth/signout">
              <DropdownMenu.Item>
                <button type="submit" class="flex items-center w-full">
                  <LogOut class="size-4 mr-2" strokeWidth={1.7} />
                  <span>{signOutLabel}</span>
                </button>
              </DropdownMenu.Item>
            </form>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Footer>

  <Sidebar.Rail />
</Sidebar.Root>

<style>
  :global([data-collapsible="icon"]) [data-sidebar="menu-button"] {
    margin-inline: auto;
  }
</style>
