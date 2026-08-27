<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import MarcoWidget from '$lib/components/MarcoWidget.svelte';
  import BrandsSidebar from '$lib/components/BrandsSidebar.svelte';
  import BrandsMobileNav from '$lib/components/BrandsMobileNav.svelte';
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import { Badge } from '$lib/components/ui/badge';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Plus, MoreVertical, Pencil, ExternalLink } from '@lucide/svelte';
  let { data, form } = $props();

  const userInitials = $derived(
    (data.userName ?? '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w: string) => w[0])
      .join('')
      .toUpperCase() || '?'
  );

  const view = $derived($page.url.searchParams.get('view') ?? 'brands');
  const showDrafts = $derived(view === 'drafts');
  const showInvites = $derived(view === 'invites');

  const statusFilter = $derived($page.url.searchParams.get('status') ?? 'all');
  const filteredBrands = $derived(
    statusFilter === 'all'
      ? data.brands
      : statusFilter === 'active'
        ? data.brands.filter((b) => b.status === 'active')
        : data.brands.filter((b) => b.status !== 'active')
  );

  let renameOpen = $state(false);
  let renameId = $state('');
  let renameName = $state('');
  let renameInput = $state<HTMLInputElement | null>(null);

  function openRename(id: string, name: string) {
    renameId = id;
    renameName = name;
    renameOpen = true;
    setTimeout(() => renameInput?.focus(), 50);
  }
</script>

<svelte:head><title>{$_('app.brands.metaTitle')}</title></svelte:head>

<div class="page">
<Sidebar.Provider style="--sidebar-width: 16rem; --sidebar-width-icon: 3.5rem;">
  <BrandsSidebar
    draftCount={data.drafts?.length ?? 0}
    inviteCount={data.invites?.length ?? 0}
    userName={data.userName}
    userEmail={data.userEmail ?? ''}
    userInitials={userInitials}
    signOutLabel={$_('app.account.signOut')}
  />

  <Sidebar.Inset class="bg-[var(--paper-2)] border-0">
    <BrandsMobileNav />

    <main class="main">
      <div class="mx-auto w-full max-w-[900px] px-6 py-12">
        <header class="mb-8">
          <h1 class="text-3xl font-semibold tracking-tight">
            {showDrafts ? $_('app.brands.draftsTitle') : showInvites ? $_('app.brands.invites.title') : $_('app.brands.title')}
          </h1>
          <p class="text-muted-foreground mt-2">{showInvites ? $_('app.brands.invites.subtitle') : $_('app.brands.subtitle')}</p>
          {#if !showDrafts && !showInvites}
            <div class="flex gap-2 mt-4">
              <a
                href="/app"
                class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition {statusFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}"
              >
                {$_('app.brands.filterAll')}
              </a>
              <a
                href="/app?status=active"
                class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition {statusFilter === 'active' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}"
              >
                {$_('app.brands.filterActive')}
              </a>
              <a
                href="/app?status=inactive"
                class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition {statusFilter === 'inactive' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}"
              >
                {$_('app.brands.filterInactive')}
              </a>
            </div>
          {/if}
        </header>

        {#if showInvites}
          <!-- Invites view: brands other users shared with me, accept → member access -->
          {#if form?.inviteError}
            <div class="mb-4 text-sm" style="color:#c0392b;">{$_('app.brands.invites.error')}</div>
          {/if}
          {#if data.invites?.length}
            <div class="grid grid-cols-2 gap-4 max-[600px]:grid-cols-1">
              {#each data.invites as inv (inv.id)}
                <div class="bg-card ring-border flex items-center gap-3 rounded-2xl p-5 ring-1">
                  <div class="min-w-0 flex-1">
                    <div class="truncate font-semibold">{inv.brand_name}</div>
                    <div class="text-muted-foreground mt-0.5 truncate text-xs">
                      {$_('app.brands.invites.invitedBy', { values: { email: inv.inviter_email ?? '—' } })}
                    </div>
                  </div>
                  <form method="POST" action="?/acceptInvite" use:enhance>
                    <input type="hidden" name="token" value={inv.token} />
                    <button
                      class="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 shrink-0 items-center justify-center rounded-full px-4 text-sm font-semibold"
                      type="submit"
                    >{$_('app.brands.invites.accept')}</button>
                  </form>
                </div>
              {/each}
            </div>
          {:else}
            <div class="text-center py-16 text-muted-foreground">
              <p class="text-sm">{$_('app.brands.invites.empty')}</p>
            </div>
          {/if}
        {:else if showDrafts}
          <!-- Drafts view -->
          {#if data.drafts?.length}
            <div class="grid grid-cols-2 gap-4 max-[600px]:grid-cols-1">
              {#each data.drafts as d (d.id)}
                <div class="bg-card ring-border group flex items-center gap-3 rounded-2xl p-5 ring-1 transition hover:-translate-y-0.5 hover:ring-primary/40">
                  <a href={`/app/onboarding?draft=${d.id}`} class="group/link min-w-0 flex-1">
                    <div class="truncate font-semibold">{d.label}</div>
                    <div class="text-muted-foreground group-hover/link:text-primary mt-0.5 text-xs transition">
                      {$_('app.brands.continue')}
                    </div>
                  </a>
                  <form method="POST" action="?/discardDraft" use:enhance>
                    <input type="hidden" name="id" value={d.id} />
                    <button
                      class="border-border text-muted-foreground hover:bg-muted hover:text-foreground flex size-9 shrink-0 items-center justify-center rounded-lg border text-lg leading-none opacity-0 transition-opacity group-hover:opacity-100"
                      type="submit"
                      title={$_('app.brands.discard')}
                      aria-label={$_('app.brands.discard')}
                    >×</button>
                  </form>
                </div>
              {/each}
            </div>
          {:else}
            <div class="text-center py-16 text-muted-foreground">
              <p class="text-sm">{$_('app.brands.draftsTitle')}</p>
            </div>
          {/if}
        {:else}
          <!-- Brands view -->
          <div class="grid grid-cols-2 gap-4 max-[600px]:grid-cols-1">
            {#each filteredBrands as b (b.id)}
              <div class="group bg-card text-card-foreground ring-border hover:ring-primary/40 flex items-center gap-3 rounded-2xl p-5 ring-1 transition hover:-translate-y-0.5">
                <a
                  href={`/app/${b.slug}`}
                  class="flex flex-1 items-center gap-3 min-w-0"
                >
                  <div
                    class="from-primary to-secondary relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br font-bold tracking-wide text-white"
                    style="background-image: linear-gradient(135deg, var(--accent), var(--accent-2));"
                  >
                    {b.name.slice(0, 2).toUpperCase()}
                    {#if b.logoUrl}
                      <img
                        src={b.logoUrl}
                        alt=""
                        loading="lazy"
                        onerror={(e) => e.currentTarget.remove()}
                        class="absolute inset-0 size-full bg-white object-contain p-1.5"
                      />
                    {/if}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="truncate font-semibold">{b.name}</div>
                    <div class="text-muted-foreground truncate text-xs">{b.website ?? b.slug}</div>
                  </div>
                </a>
                <Badge
                  variant="outline"
                  class="shrink-0 whitespace-nowrap capitalize {b.status === 'active' ? 'text-primary border-primary/30' : 'text-muted-foreground border-border'}"
                >
                  {$_(`app.brands.status.${b.status}`)}
                </Badge>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <button
                        {...props}
                        class="text-muted-foreground hover:text-foreground hover:bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg border border-border transition"
                        onclick={(e) => e.preventDefault()}
                      >
                        <MoreVertical class="size-4" />
                      </button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content side="bottom" align="end" sideOffset={4} class="min-w-[160px]">
                    <DropdownMenu.Item onclick={() => openRename(b.id, b.name)}>
                      <Pencil class="size-3.5 mr-2" />
                      <span>{$_('app.brands.rename')}</span>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item>
                      <a href={`/app/${b.slug}/settings/billing`} class="flex items-center w-full">
                        <ExternalLink class="size-3.5 mr-2" />
                        <span>{$_('app.brands.manageBilling')}</span>
                      </a>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </div>
            {/each}

            {#if data.canAddBrand}
              <a
                href="/app/onboarding"
                class="border-border text-muted-foreground hover:border-primary hover:text-primary flex min-h-24 flex-col items-center justify-center rounded-2xl border-[1.5px] border-dashed transition"
              >
                <Plus class="size-7" />
                <div class="mt-1 text-sm font-semibold">{$_('app.brands.add')}</div>
              </a>
            {:else}
              <div
                class="border-border text-muted-foreground flex min-h-24 flex-col items-center justify-center rounded-2xl border p-5 text-center"
                role="note"
              >
                <div class="text-foreground text-sm font-semibold">{$_('app.brands.limitTitle')}</div>
                <div class="mt-1.5 max-w-[36ch] text-xs leading-relaxed">
                  {$_('app.brands.limitDesc', { values: { max: data.slotLimit } })}
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </main>
  </Sidebar.Inset>
  </Sidebar.Provider>
</div>

<Dialog.Root bind:open={renameOpen}>
  <Dialog.Content class="max-w-sm">
    <Dialog.Header>
      <Dialog.Title>{$_('app.brands.renameTitle')}</Dialog.Title>
    </Dialog.Header>
    <form method="POST" action="?/renameBrand" use:enhance={() => {
      return async ({ result }) => {
        if (result.type === 'success') {
          renameOpen = false;
        }
      };
    }}>
      <input type="hidden" name="id" value={renameId} />
      <input
        bind:this={renameInput}
        type="text"
        name="name"
        bind:value={renameName}
        maxlength="80"
        required
        class="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      />
      <div class="flex justify-end gap-2 mt-4">
        <button
          type="button"
          class="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          onclick={() => renameOpen = false}
        >
          {$_('app.brands.cancel')}
        </button>
        <button
          type="submit"
          class="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          {$_('app.brands.save')}
        </button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>

<MarcoWidget />

<style>
  .page {
    background: var(--paper-2);
    min-height: 100dvh;
  }
  :global([data-slot="sidebar-gap"]) {
    background: var(--sidebar-bg, var(--paper-2)) !important;
    border: 0 !important;
    box-shadow: none !important;
    outline: none !important;
  }
  :global([data-sidebar]) {
    background: var(--sidebar-bg, var(--paper-2)) !important;
    border: 0 !important;
  }
  :global([data-slot="sidebar-container"]) {
    box-shadow: none !important;
    outline: none !important;
  }
  :global([data-slot="sidebar-inset"]) {
    border: 0 !important;
    box-shadow: none !important;
  }
  .main {
    height: calc(100dvh - 16px);
    margin: 8px;
    margin-left: 0;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    background: var(--paper);
    overflow-y: auto;
    overflow-x: hidden;
    border: 1px solid var(--line);
  }

  @media (max-width: 768px) {
    .main {
      margin: 0;
      border-radius: 0;
      border: 0;
      height: auto;
      min-height: calc(100dvh - 56px);
    }
  }
</style>
