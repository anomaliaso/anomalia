<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';

  let { data, form } = $props();
  const slug = $derived(data.brand?.slug ?? '');
  const connectHref = $derived(`/app/${slug}/settings/connect/gsc`);
  const currentPath = $derived($page.url.pathname);

  let permissionLevel = $state('');
  let selectedSite = $state('');

  $effect(() => {
    const current = data.summary.siteUrl ?? data.suggestedSiteUrl ?? '';
    selectedSite = current;
    permissionLevel = data.sites.find((s) => s.siteUrl === current)?.permissionLevel ?? '';
  });

  function onSiteChange(e: Event) {
    const sel = e.currentTarget as HTMLSelectElement;
    selectedSite = sel.value;
    permissionLevel = sel.selectedOptions[0]?.dataset.permission ?? '';
  }
</script>

<div class="gsc-settings">
  <p class="lede">{$_('app.settings.searchConsole.lede')}</p>

  {#if data.errorFlash}
    <p class="err">{data.errorFlash}</p>
  {/if}
  {#if form?.error}
    <p class="err">{form.error}</p>
  {/if}
  {#if form?.saved || form?.synced}
    <p class="ok">{$_('app.settings.searchConsole.updated')}</p>
  {/if}
  {#if data.connectedFlash && data.summary.connected && !data.summary.siteUrl}
    <p class="ok">{$_('app.settings.searchConsole.connectedFlash')}</p>
  {/if}

  {#if !data.configured}
    <p class="warn">{$_('app.settings.searchConsole.notConfigured')}</p>
  {:else if !data.summary.connected}
    <a class="btn" href={connectHref}>{$_('app.settings.searchConsole.connect')}</a>
  {:else}
    <div class="status" role="status">
      <span class="check" aria-hidden="true">✓</span>
      <span>{$_('app.settings.searchConsole.connected')}</span>
    </div>

    {#if data.sitesError}
      <p class="err">{$_('app.settings.searchConsole.sitesError')} {data.sitesError}</p>
      <div class="row">
        <a class="btn ghost" href={currentPath}>{$_('app.settings.searchConsole.reload')}</a>
        <a class="btn" href={connectHref}>{$_('app.settings.searchConsole.reconnect')}</a>
      </div>
    {:else if !data.sites.length}
      <p class="warn">{$_('app.settings.searchConsole.noSites')}</p>
      <div class="row">
        <a class="btn ghost" href={currentPath}>{$_('app.settings.searchConsole.reload')}</a>
        <a class="btn" href={connectHref}>{$_('app.settings.searchConsole.reconnect')}</a>
      </div>
    {:else}
      <form method="POST" action="?/selectSite" use:enhance>
        <label>
          {$_('app.settings.searchConsole.pickProperty')}
          <select name="site_url" required bind:value={selectedSite} onchange={onSiteChange}>
            <option value="">{$_('app.settings.searchConsole.selectPlaceholder')}</option>
            {#each data.sites as s (s.siteUrl)}
              <option value={s.siteUrl} data-permission={s.permissionLevel}>
                {s.siteUrl} ({s.permissionLevel}){data.suggestedSiteUrl === s.siteUrl
                  ? ` — ${$_('app.settings.searchConsole.suggested')}`
                  : ''}
              </option>
            {/each}
          </select>
        </label>
        <input type="hidden" name="permission_level" value={permissionLevel} />
        <button type="submit" class="btn">
          {data.summary.siteUrl
            ? $_('app.settings.searchConsole.save')
            : $_('app.settings.searchConsole.saveSync')}
        </button>
      </form>
    {/if}

    {#if data.summary.siteUrl}
      <div class="meta">
        <div><strong>{$_('app.settings.searchConsole.property')}</strong> {data.summary.siteUrl}</div>
        <div>
          <strong>{$_('app.settings.searchConsole.lastSync')}</strong>
          {data.summary.syncedAt ? new Date(data.summary.syncedAt).toLocaleString() : '—'}
        </div>
        <div><strong>{$_('app.settings.searchConsole.clicks')}</strong> {data.summary.clicks28d}</div>
        <div>
          <strong>{$_('app.settings.searchConsole.impressions')}</strong>
          {data.summary.impressions28d}
        </div>
        {#if data.summary.lastError}<div class="err">{data.summary.lastError}</div>{/if}
      </div>
      {#if data.summary.topQueries.length}
        <h2>{$_('app.settings.searchConsole.topQueries')}</h2>
        <ul>
          {#each data.summary.topQueries.slice(0, 10) as q (q.query)}
            <li>{q.query} — {q.clicks} clicks · pos {q.position}</li>
          {/each}
        </ul>
      {/if}
    {/if}

    <div class="row">
      {#if data.summary.siteUrl}
        <form method="POST" action="?/sync" use:enhance>
          <button class="btn" type="submit">{$_('app.settings.searchConsole.syncNow')}</button>
        </form>
      {/if}
      {#if data.sites.length && !data.sitesError}
        <a class="btn ghost" href={connectHref}>{$_('app.settings.searchConsole.reconnect')}</a>
      {/if}
      <form method="POST" action="?/disconnect" use:enhance>
        <button class="btn ghost" type="submit">{$_('app.settings.searchConsole.disconnect')}</button>
      </form>
    </div>
  {/if}
</div>

<style>
  .gsc-settings { max-width: 640px; }
  .lede { color: var(--ink-soft, #666); margin: 0 0 20px; }
  .btn { display: inline-flex; padding: 10px 14px; background: #111; color: #fff; border-radius: 8px; text-decoration: none; border: 0; cursor: pointer; }
  .btn.ghost { background: transparent; color: #111; border: 1px solid #ccc; }
  .row { display: flex; gap: 10px; margin: 16px 0; flex-wrap: wrap; align-items: center; }
  .meta { display: grid; gap: 6px; margin: 20px 0 12px; font-size: 0.95rem; }
  .err { color: #b00020; }
  .ok { color: #0a7; }
  .warn { background: #fff8e6; padding: 12px; border-radius: 8px; }
  .status { display: flex; align-items: center; gap: 8px; margin: 0 0 16px; font-weight: 600; }
  .check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #0a7;
    color: #fff;
    font-size: 13px;
  }
  select { display: block; width: 100%; margin: 6px 0 12px; padding: 8px; }
</style>
