<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { PLATFORMS, ICONS } from '$lib/components/settings/platforms';
  import { canConnectSocials as brandCanConnect } from '$lib/plans';

  let { data, form } = $props();
  const brand = $derived(data.brand);
  const base = $derived(`/app/${brand.slug}`);
  const canConnectSocials = $derived(brandCanConnect(brand.plan, brand.status));
  const atLimit = $derived(canConnectSocials && data.used >= data.limit);
  const q = (key: string) => $page.url.searchParams.get(key);
  const limitError = $derived(q('error') === 'limit');
  const connected = $derived(data.accounts.filter((a) => a.status === 'active'));

  let syncForm = $state<HTMLFormElement | null>(null);
  let pendingConnect = $state(false);
  let confirmingDisconnect = $state<string | null>(null);
  let disconnecting = $state<string | null>(null);
  let syncing = $state(false);

  // Coming back from the OAuth tab, the sync runs for a few seconds — say so instead of showing
  // the stale "no accounts" state as if nothing happened.
  const withSpinner = () => {
    syncing = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      syncing = false;
    };
  };

  const withDisconnectSpinner = (id: string) => () => {
    disconnecting = id;
    return async ({ update }: { update: () => Promise<void> }) => {
      try {
        await update();
      } finally {
        disconnecting = null;
      }
    };
  };

  onMount(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && pendingConnect) {
        pendingConnect = false;
        syncForm?.requestSubmit();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    if (q('connected')) {
      syncForm?.requestSubmit();
      history.replaceState(history.state, '', $page.url.pathname);
    }
    return () => document.removeEventListener('visibilitychange', onVisible);
  });
</script>

<section class="panel">
  <div class="panel-head">
    <div class="t">{$_('app.settings.connectedAccounts')}</div>
    <form method="POST" action="?/sync" use:enhance={withSpinner} bind:this={syncForm}>
      <button class="approve-all" type="submit" disabled={syncing}>
        {syncing ? $_('app.ads.syncing') : `↻ ${$_('app.settings.syncFromZernio')}`}
      </button>
    </form>
  </div>

  {#if syncing}
    <div class="acct skeleton">
      <div class="glyph"></div>
      <div class="nm"><div class="h"></div><div class="s"></div></div>
    </div>
  {:else if connected.length}
    {#each connected as a (a.id)}
      {@const pk = (a.platform ?? '').toLowerCase()}
      {@const pm = PLATFORMS.find((p) => p.key === pk)}
      <div class="acct">
        <div class="glyph" style={`background:${pm?.bg ?? '#7c5cff'}`}>
          {#if ICONS[pk]}<svg viewBox="0 0 24 24" fill="#fff"><path d={ICONS[pk].path} /></svg>{:else}{pm?.glyph ?? (a.platform ?? '?').slice(0, 2).toUpperCase()}{/if}
        </div>
        <div class="nm"><div class="h">{a.display_name ?? a.username ?? a.platform}</div><div class="s">{a.platform}{a.username ? ` · @${a.username}` : ''}</div></div>
        {#if confirmingDisconnect === a.id}
          <form method="POST" action="?/disconnect" use:enhance={withDisconnectSpinner(a.id)} class="disc-confirm" aria-busy={disconnecting === a.id}>
            <input type="hidden" name="id" value={a.id} />
            <button class="mini danger" type="submit" disabled={disconnecting === a.id}>
              {disconnecting === a.id ? $_('app.settings.del.deleting') : $_('app.settings.remove')}
            </button>
            <button class="mini ghost" type="button" disabled={disconnecting === a.id} onclick={() => (confirmingDisconnect = null)}>{$_('app.settings.keep')}</button>
          </form>
        {:else}
          <span class="status"><span class="d"></span>{$_('app.settings.active')}</span>
          <button class="disc-btn" type="button" title={$_('app.settings.disconnect')} aria-label={$_('app.settings.disconnect')} onclick={() => (confirmingDisconnect = a.id)}>{$_('app.settings.disconnect')}</button>
        {/if}
      </div>
    {/each}
  {:else}
    <div class="field"><div class="ftxt"><div class="fh">{$_('app.settings.noAccountsTitle')}</div><div class="fs">{$_('app.settings.noAccountsBody')}</div></div></div>
  {/if}

  {#if form?.error}<div class="field"><div class="fs" style="color:#c0392b;">{form.error}</div></div>{/if}
  {#if form?.synced}<div class="field"><div class="fs" style="color:var(--accent);">{$_('app.settings.syncedToast')}</div></div>{/if}
  {#if form?.disconnected}<div class="field"><div class="fs" style="color:var(--accent);">{$_('app.settings.disconnectedToast')}</div></div>{/if}
</section>

<section class="panel">
  <div class="panel-head">
    <div class="t">{$_('app.settings.connectPlatform')}{#if canConnectSocials} <span style="color:var(--ink-faint);font-weight:500;">· {$_('app.settings.accountsUsed', { values: { used: data.used, limit: data.limit } })}</span>{/if}</div>
  </div>
  {#if limitError}
    <div class="field"><div class="fs" style="color:#a3700a;">{$_('app.settings.limitReachedMsg', { values: { limit: data.limit } })}</div></div>
  {/if}
  {#each PLATFORMS as p (p.key)}
    {@const count = connected.filter((a) => (a.platform ?? '').toLowerCase() === p.key).length}
    <div class="acct">
      <div class="glyph" style={`background:${p.bg}`}>
        {#if ICONS[p.key]}<svg viewBox="0 0 24 24" fill="#fff"><path d={ICONS[p.key].path} /></svg>{:else}{p.glyph}{/if}
      </div>
      <div class="nm"><div class="h">{p.label}</div><div class="s">{count ? $_('app.settings.connectedAddAnother', { values: { count } }) : $_('app.settings.connectViaOauth')}</div></div>
      {#if !canConnectSocials}
        <a class="mini connect" href={`${base}/activate`}>{$_('app.settings.connect')}</a>
      {:else if atLimit}
        <span class="soon">{$_('app.settings.limitReached')}</span>
      {:else}
        <a class="mini connect" href={`${base}/settings/connect/${p.key}`} target="_blank" rel="noopener" onclick={() => (pendingConnect = true)}>{$_('app.settings.connect')}</a>
      {/if}
    </div>
  {/each}
</section>

<style>
  .skeleton .glyph, .skeleton .h, .skeleton .s {
    background: var(--line, #e5e5e5);
    border-radius: 6px;
    animation: pulse 1.2s ease-in-out infinite;
  }
  .skeleton .h { width: 160px; height: 14px; margin-bottom: 6px; }
  .skeleton .s { width: 100px; height: 11px; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
</style>
