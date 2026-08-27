<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import { _ } from 'svelte-i18n';
  let { data, form } = $props();
  const base = $derived(`/app/${$page.params.brand}`);
  const userProfileJson = $derived(data.pending ? JSON.stringify(data.pending.userProfile ?? null) : '');
  let working = $state(false);
</script>

<div class="wrap">
  <div class="card">
    <div class="brand"><span class="badge">in</span> LinkedIn</div>
    <h1>{$_('app.settings.linkedin.title')}</h1>
    <p class="sub">{$_('app.settings.linkedin.subtitle')}</p>

    {#if data.error || form?.error}
      <div class="err">
        {#if data.error === 'expired' || form?.error === 'expired'}
          {$_('app.settings.linkedin.expired')}
        {:else if data.error === 'missing'}
          {$_('app.settings.linkedin.missing')}
        {:else}
          {$_('app.settings.linkedin.failed')}
        {/if}
      </div>
      <div class="actions">
        <a class="btn primary" href={`${base}/settings/connect/linkedin?return=${data.dest}`}>
          {$_('app.settings.linkedin.retry')}
        </a>
        <a class="btn ghost" href={`${base}/settings/connected-accounts`}>{$_('app.settings.linkedin.back')}</a>
      </div>
    {:else}
      <!-- Personal profile -->
      <form method="POST" action="?/select" use:enhance={() => { working = true; return async ({ update }) => { await update(); working = false; }; }}>
        <input type="hidden" name="accountType" value="personal" />
        <input type="hidden" name="dest" value={data.dest} />
        <input type="hidden" name="tempToken" value={data.pending?.tempToken ?? ''} />
        <input type="hidden" name="userProfile" value={userProfileJson} />
        <div class="row">
          <span class="ico personal">👤</span>
          <div class="meta">
            <div class="h">{data.personal}</div>
            <div class="s">{$_('app.settings.linkedin.personalDesc')}</div>
          </div>
          <button class="btn primary" type="submit" disabled={working}>
            {working ? $_('app.settings.linkedin.working') : $_('app.settings.linkedin.connectThis')}
          </button>
        </div>
      </form>

      <!-- Company Pages -->
      <div class="section">{$_('app.settings.linkedin.pagesTitle')}</div>
      {#if data.organizations.length}
        {#each data.organizations as org (org.urn)}
          <form method="POST" action="?/select" use:enhance={() => { working = true; return async ({ update }) => { await update(); working = false; }; }}>
            <input type="hidden" name="accountType" value="organization" />
            <input type="hidden" name="dest" value={data.dest} />
            <input type="hidden" name="tempToken" value={data.pending?.tempToken ?? ''} />
            <input type="hidden" name="userProfile" value={userProfileJson} />
            <input type="hidden" name="organization" value={JSON.stringify(org)} />
            <div class="row">
              {#if org.logoUrl}
                <img class="ico" src={org.logoUrl} alt="" />
              {:else}
                <span class="ico page">{org.name.slice(0, 1).toUpperCase()}</span>
              {/if}
              <div class="meta">
                <div class="h">{org.name}</div>
                <div class="s">{$_('app.settings.linkedin.pagesDesc')}</div>
              </div>
              <button class="btn primary" type="submit" disabled={working}>
                {working ? $_('app.settings.linkedin.working') : $_('app.settings.linkedin.connectThis')}
              </button>
            </div>
          </form>
        {/each}
      {:else}
        <div class="empty">{$_('app.settings.linkedin.noPages')}</div>
      {/if}

      <div class="actions">
        <a class="btn ghost" href={`${base}/settings/connected-accounts`}>{$_('app.settings.linkedin.back')}</a>
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
    background: #0a66c2; color: #fff; font-size: 13px; font-weight: 700;
  }
  h1 { margin: 14px 0 4px; font-size: 22px; }
  .sub { color: var(--ink-faint, #8a8a99); margin: 0 0 20px; }
  .section { margin: 22px 0 10px; font-size: 13px; font-weight: 600; color: var(--ink-faint, #8a8a99); text-transform: uppercase; letter-spacing: .04em; }
  .row {
    display: flex; align-items: center; gap: 12px; padding: 12px;
    border: 1px solid var(--line, #ececf1); border-radius: 12px; margin-bottom: 10px;
  }
  .ico {
    width: 38px; height: 38px; border-radius: 9px; flex: 0 0 auto; object-fit: cover;
    display: grid; place-items: center; font-weight: 700; color: #fff; background: #0a66c2;
  }
  .ico.personal { background: #5b6b7b; }
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
</style>
