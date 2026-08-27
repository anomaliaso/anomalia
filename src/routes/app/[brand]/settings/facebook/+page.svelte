<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import { _ } from 'svelte-i18n';
  let { data, form } = $props();
  const base = $derived(`/app/${$page.params.brand}`);
  let working = $state(false);
</script>

<div class="wrap">
  <div class="card">
    <div class="brand"><span class="badge">f</span> Facebook</div>
    <h1>{$_('app.settings.facebook.title')}</h1>
    <p class="sub">{$_('app.settings.facebook.subtitle')}</p>

    {#if data.error || form?.error}
      <div class="err">
        {#if data.error === 'expired' || form?.error === 'expired'}
          {$_('app.settings.facebook.expired')}
        {:else if data.error === 'missing'}
          {$_('app.settings.facebook.missing')}
        {:else}
          {$_('app.settings.facebook.failed')}
        {/if}
      </div>
      {#if data.detail}
        <div class="detail">{data.detail}</div>
      {/if}
      <div class="actions">
        <a class="btn primary" href={`${base}/settings/connect/facebook?return=${data.dest}`}>
          {$_('app.settings.facebook.retry')}
        </a>
        <a class="btn ghost" href={`${base}/settings/connected-accounts`}>{$_('app.settings.facebook.back')}</a>
      </div>
    {:else}
      <div class="section">{$_('app.settings.facebook.pagesTitle')}</div>
      {#if data.pages.length}
        {#each data.pages as pg (pg.id)}
          <form method="POST" action="?/select" use:enhance={() => { working = true; return async ({ update }) => { await update(); working = false; }; }}>
            <input type="hidden" name="pageId" value={pg.id} />
            <input type="hidden" name="dest" value={data.dest} />
            <input type="hidden" name="tempToken" value={data.pending?.tempToken ?? ''} />
            <input type="hidden" name="connectToken" value={data.pending?.connectToken ?? ''} />
            <input type="hidden" name="userProfile" value={data.pending?.userProfile ?? ''} />
            <div class="row">
              <span class="ico page">{pg.name.slice(0, 1).toUpperCase()}</span>
              <div class="meta">
                <div class="h">{pg.name}</div>
                <div class="s">{pg.category ?? $_('app.settings.facebook.pagesDesc')}</div>
              </div>
              <button class="btn primary" type="submit" disabled={working}>
                {working ? $_('app.settings.facebook.working') : $_('app.settings.facebook.connectThis')}
              </button>
            </div>
          </form>
        {/each}
      {:else}
        <div class="empty">{$_('app.settings.facebook.noPages')}</div>
      {/if}

      <div class="actions">
        <a class="btn ghost" href={`${base}/settings/connected-accounts`}>{$_('app.settings.facebook.back')}</a>
      </div>
    {/if}
  </div>
</div>

<style>
  .wrap { display: flex; justify-content: center; padding: 48px 20px; }
  .card {
    width: 100%; max-width: 560px; background: var(--card, #fff);
    border: 1px solid var(--line, #ececf1); border-radius: 16px; padding: 28px;
  }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--ink-faint, #8a8a99); }
  .badge {
    display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 6px;
    background: #1877f2; color: #fff; font-size: 15px; font-weight: 700; font-family: Georgia, serif;
  }
  h1 { margin: 14px 0 4px; font-size: 22px; }
  .sub { color: var(--ink-faint, #8a8a99); margin: 0 0 20px; }
  .section { margin: 22px 0 10px; font-size: 13px; font-weight: 600; color: var(--ink-faint, #8a8a99); text-transform: uppercase; letter-spacing: .04em; }
  .row {
    display: flex; align-items: center; gap: 12px; padding: 12px;
    border: 1px solid var(--line, #ececf1); border-radius: 12px; margin-bottom: 10px;
  }
  .ico {
    width: 38px; height: 38px; border-radius: 9px; flex: 0 0 auto;
    display: grid; place-items: center; font-weight: 700; color: #fff; background: #1877f2;
  }
  .meta { flex: 1; min-width: 0; }
  .meta .h { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta .s { font-size: 13px; color: var(--ink-faint, #8a8a99); }
  .btn {
    border: none; border-radius: 10px; padding: 9px 16px; font-weight: 600; cursor: pointer;
    text-decoration: none; font-size: 14px; white-space: nowrap;
  }
  .btn.primary { background: var(--accent, #7c5cff); color: #fff; }
  .btn.primary:disabled { opacity: .6; cursor: default; }
  .btn.ghost { background: transparent; color: var(--ink-faint, #8a8a99); border: 1px solid var(--line, #ececf1); }
  .actions { display: flex; gap: 10px; margin-top: 18px; }
  .empty { color: var(--ink-faint, #8a8a99); font-size: 14px; padding: 8px 2px 4px; }
  .err {
    background: #fdecec; color: #c0392b; border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; font-size: 14px;
  }
  .detail {
    font-family: ui-monospace, monospace; font-size: 12px; color: #8a8a99;
    background: #f6f6f9; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;
    word-break: break-word;
  }
</style>
