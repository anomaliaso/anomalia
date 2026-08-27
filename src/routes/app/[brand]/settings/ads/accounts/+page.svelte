<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import { pageQuery } from '$lib/page-query';
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';

  let { data, form } = $props();
  // I parametri della pagina, non quelli dell'URL: nella modal l'URL non cambia.
  const q = pageQuery();
  const brand = $derived(data.brand);
  const base = $derived(`/app/${brand.slug}`);

  const META_BG = 'linear-gradient(135deg,#1877f2,#0a66c2)';
  const GOOGLE_BG = 'linear-gradient(135deg,#ea4335,#fbbc05,#34a853,#4285f4)';

  let syncForm = $state<HTMLFormElement | null>(null);
  let pendingConnect = $state(false);
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

  onMount(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && pendingConnect) {
        pendingConnect = false;
        syncForm?.requestSubmit();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    if (q('connected')) {
      history.replaceState(history.state, '', $page.url.pathname);
    }
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  function platLabel(p: string) {
    const k = (p ?? '').toLowerCase();
    if (k.includes('google')) return 'Google Ads';
    if (k.includes('meta') || k.includes('facebook')) return 'Meta Ads';
    if (k.includes('tiktok')) return 'TikTok Ads';
    return p || 'Ads';
  }

  function platBg(p: string) {
    const k = (p ?? '').toLowerCase();
    if (k.includes('google')) return GOOGLE_BG;
    return META_BG;
  }
</script>

{#if !data.adsEnabled}
  <section class="panel">
    <div class="panel-head"><div class="t">{$_('app.settings.ads.accountsTitle')}</div></div>
    <div class="field">
      <div class="fs">{$_('app.settings.ads.proOnly')}</div>
      <a class="mini connect" href={`${base}/upgrade?plan=starter`}>{$_('app.settings.ads.upgrade')}</a>
    </div>
  </section>
{:else}
  <section class="panel">
    <div class="panel-head">
      <div class="t">{$_('app.settings.ads.accountsTitle')}</div>
      <form method="POST" action="?/sync" use:enhance={withSpinner} bind:this={syncForm}>
        <button class="approve-all" type="submit" disabled={syncing}>
          {syncing ? $_('app.ads.syncing') : `↻ ${$_('app.settings.ads.sync')}`}
        </button>
      </form>
    </div>

    <div class="field">
      <div class="ftxt">
        <div class="fh">{$_('app.settings.ads.connectTitle')}</div>
        <div class="fs">{$_('app.settings.ads.connectBody')}</div>
      </div>
    </div>

    {#if !data.hasFacebook}
      <div class="field warn">
        <div class="fs">{$_('app.settings.ads.needFacebook')}</div>
        <a class="mini connect" href={`${base}/settings/connect/facebook`}>{$_('app.settings.ads.connectFacebook')}</a>
      </div>
    {/if}

    {#if syncing}
      <div class="acct skeleton">
        <div class="glyph"></div>
        <div class="nm"><div class="h"></div><div class="s"></div></div>
      </div>
    {:else if data.adAccounts.length}
      {#each data.adAccounts as a (a.id)}
        <div class="acct">
          <div class="glyph" style={`background:${platBg(a.platform)}`}>
            {(a.platform ?? 'AD').slice(0, 2).toUpperCase()}
          </div>
          <div class="nm">
            <div class="h">{a.name ?? a.zernio_ad_account_id}</div>
            <div class="s">
              {platLabel(a.platform)}{a.currency ? ` · ${a.currency}` : ''}
              {#if a.status !== 'active'}
                · {$_('app.settings.ads.accountBlocked', { values: { reason: a.unusable_reason ?? '—' } })}
              {/if}
            </div>
          </div>
          {#if a.status === 'active'}
            <span class="status"><span class="d"></span>{$_('app.settings.active')}</span>
          {:else}
            <span class="status blocked"><span class="d"></span>{$_('app.settings.ads.blocked')}</span>
          {/if}
        </div>
      {/each}
    {:else}
      <div class="field">
        <div class="ftxt">
          <div class="fh">{$_('app.settings.ads.noAccounts')}</div>
          <div class="fs">{$_('app.settings.ads.accountsDesc')}</div>
        </div>
      </div>
    {/if}

    {#if form?.error}<div class="field"><div class="fs err">{form.error}</div></div>{/if}
    {#if form?.synced != null}<div class="field"><div class="fs ok">{$_('app.settings.ads.synced', { values: { n: form.synced } })}</div></div>{/if}
    {#if data.autoSynced != null}<div class="field"><div class="fs ok">{$_('app.settings.ads.synced', { values: { n: data.autoSynced } })}</div></div>{/if}
  </section>

  <section class="panel">
    <div class="panel-head">
      <div class="t">{$_('app.settings.ads.connectPlatform')}</div>
    </div>
    <div class="acct">
      <div class="glyph" style={`background:${META_BG}`}>Me</div>
      <div class="nm">
        <div class="h">Meta Ads</div>
        <div class="s">{$_('app.settings.ads.connectViaOauth')}</div>
      </div>
      <a
        class="mini connect"
        href={`${base}/ads/connect/metaads`}
        target="_blank"
        rel="noopener"
        onclick={() => (pendingConnect = true)}
      >{$_('app.settings.ads.connectMeta')}</a>
    </div>
    <div class="acct">
      <div class="glyph" style={`background:${GOOGLE_BG}`}>G</div>
      <div class="nm">
        <div class="h">Google Ads</div>
        <div class="s">{$_('app.settings.ads.connectViaOauth')}</div>
      </div>
      <a
        class="mini connect"
        href={`${base}/ads/connect/googleads`}
        target="_blank"
        rel="noopener"
        onclick={() => (pendingConnect = true)}
      >{$_('app.settings.ads.connectGoogle')}</a>
    </div>
  </section>
{/if}

<style>
  .skeleton .glyph, .skeleton .h, .skeleton .s {
    background: var(--line, #e5e5e5);
    border-radius: 6px;
    animation: pulse 1.2s ease-in-out infinite;
  }
  .skeleton .h { width: 160px; height: 14px; margin-bottom: 6px; }
  .skeleton .s { width: 100px; height: 11px; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
  .status.blocked { background: #fdecea; color: #c0392b; }
  .status.blocked .d { background: #c0392b; }
  .warn { flex-wrap: wrap; gap: 8px; }
  .ok { color: var(--accent); }
  .err { color: #c0392b; }
</style>
