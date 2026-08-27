<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Plus, Copy, Check } from '@lucide/svelte';

  let { data, form } = $props();

  let modalOpen = $state(false);
  let copied = $state(false);
  let confirmingRevoke = $state<string | null>(null);
  let allBrands = $state(true);

  function copyKey() {
    if (form?.apiKeyRaw) {
      navigator.clipboard.writeText(form.apiKeyRaw);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    }
  }
</script>

<svelte:head><title>API Keys — Anomalia</title></svelte:head>

<main class="bg-background text-foreground min-h-screen">
  <div class="mx-auto max-w-3xl px-6 py-12">
    <a href="/app" class="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm transition">
      {$_('app.settings.back')}
    </a>
    <h1 class="text-2xl font-semibold tracking-tight">{$_('app.settings.apiKeys.title')}</h1>
    <p class="text-muted-foreground mt-2 text-sm">{$_('app.settings.apiKeys.subtitle')}</p>

    {#if form?.apiKeyCreated && form?.apiKeyRaw}
      <div class="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <div class="mb-2.5 text-sm font-semibold text-amber-600">⚠️ {$_('app.settings.apiKeys.warning')}</div>
        <div class="flex items-center gap-2">
          <code class="bg-muted ring-border flex-1 select-all break-all rounded-lg px-2.5 py-2 text-xs ring-1">{form.apiKeyRaw}</code>
          <Button variant="outline" size="sm" onclick={copyKey}>
            {#if copied}<Check class="size-3.5" /> {$_('app.settings.apiKeys.copied')}
            {:else}<Copy class="size-3.5" /> {$_('app.settings.apiKeys.copyKey')}{/if}
          </Button>
        </div>
      </div>
    {/if}

    {#if form?.apiKeyError}
      <div class="mt-4 rounded-lg bg-red-500/10 px-3.5 py-2.5 text-sm text-red-500">{form.apiKeyError}</div>
    {/if}
    {#if form?.apiKeyRevoked}
      <div class="mt-4 rounded-lg bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-500">{$_('app.settings.apiKeys.keyRevoked')}</div>
    {/if}

    <div class="mt-6 mb-4">
      <Button onclick={() => (modalOpen = true)}>
        <Plus class="size-4" /> {$_('app.settings.apiKeys.createKey')}
      </Button>
    </div>

    {#if data.keys.length}
      <div class="ring-border divide-border divide-y overflow-hidden rounded-xl ring-1">
        {#each data.keys as k (k.id)}
          <div class="bg-card flex items-center justify-between gap-3.5 p-4">
            <div class="min-w-0 flex-1">
              <div class="font-semibold">{k.name}</div>
              <div class="mt-1.5 flex flex-wrap items-center gap-2">
                <code class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">{k.key_prefix}…</code>
                <Badge variant="secondary" class="text-primary text-[10px] uppercase">{$_('app.settings.apiKeys.read')} + {$_('app.settings.apiKeys.write')}</Badge>
                {#if k.permissions?.brand_ids === '*'}
                  <Badge variant="outline" class="text-[10px] uppercase">{$_('app.settings.apiKeys.allBrands')}</Badge>
                {:else if k.brandNames?.length}
                  <Badge variant="outline" class="text-[10px]">{k.brandNames.join(', ')}</Badge>
                {/if}
              </div>
              <div class="text-muted-foreground mt-1.5 text-xs">
                {$_('app.settings.apiKeys.created')}: {new Date(k.created_at).toLocaleDateString()}
                · {$_('app.settings.apiKeys.lastUsed')}: {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : $_('app.settings.apiKeys.never')}
              </div>
            </div>
            {#if confirmingRevoke === k.id}
              <div class="flex shrink-0 items-center gap-2">
                <form method="POST" action="?/revokeApiKey" use:enhance>
                  <input type="hidden" name="key_id" value={k.id} />
                  <Button variant="destructive" size="sm" type="submit">{$_('app.settings.apiKeys.revoke')}</Button>
                </form>
                <Button variant="ghost" size="sm" onclick={() => (confirmingRevoke = null)}>{$_('app.settings.keep')}</Button>
              </div>
            {:else}
              <Button variant="ghost" size="sm" class="text-muted-foreground hover:text-destructive shrink-0" onclick={() => (confirmingRevoke = k.id)}>
                {$_('app.settings.apiKeys.revoke')}
              </Button>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="text-muted-foreground py-6 text-center text-sm">{$_('app.settings.apiKeys.noKeys')}</div>
    {/if}
  </div>
</main>

<!-- Create modal -->
<Dialog.Root bind:open={modalOpen}>
  <Dialog.Content class="flex flex-col gap-5 p-6 sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title class="text-lg">{$_('app.settings.apiKeys.createKey')}</Dialog.Title>
    </Dialog.Header>
    <form
      method="POST"
      action="?/createApiKey"
      use:enhance={() => {
        return async ({ result, update }) => {
          await update();
          if (result.type === 'success' && result.data?.apiKeyRaw) modalOpen = false;
        };
      }}
      class="space-y-4"
    >
      <div class="space-y-2">
        <Label for="key_name">{$_('app.settings.apiKeys.keyName')}</Label>
        <Input id="key_name" name="key_name" type="text" placeholder={$_('app.settings.apiKeys.keyNamePlaceholder')} />
      </div>

      <div class="space-y-2">
        <Label for="brand_scope">{$_('app.settings.apiKeys.brandScope')}</Label>
        <select
          id="brand_scope"
          name="all_brands"
          class="border-input bg-background ring-offset-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          onchange={(e) => (allBrands = e.currentTarget.value === 'true')}
        >
          <option value="true">{$_('app.settings.apiKeys.allBrands')}</option>
          <option value="false">Specifici</option>
        </select>
      </div>
      <input type="hidden" name="write" value="true" />

      {#if !allBrands}
        <div class="flex flex-wrap gap-1.5">
          {#each data.brands as b (b.id)}
            <label class="ring-border has-[input:checked]:border-primary has-[input:checked]:bg-primary/5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ring-1">
              <input type="checkbox" name="brand_ids" value={b.id} checked class="accent-[var(--accent)]" />
              <span>{b.name}</span>
            </label>
          {/each}
        </div>
      {/if}

      <Dialog.Footer>
        <Button variant="outline" type="button" onclick={() => (modalOpen = false)}>{$_('app.settings.close')}</Button>
        <Button type="submit">{$_('app.settings.apiKeys.createKey')}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
