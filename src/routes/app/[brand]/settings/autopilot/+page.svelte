<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import { PLATFORMS, ICONS } from '$lib/components/settings/platforms';

  let { data, form } = $props();
  const brand = $derived(data.brand);
  const connected = $derived(data.accounts.filter((a) => a.status === 'active'));
  const autopilotLocked = $derived(data.autopilotFailureCount >= 3 && !data.autopilotEnabled);
  const lastRun = $derived(
    data.lastAutopilotRunAt
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: brand.timezone,
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(new Date(data.lastAutopilotRunAt))
      : null
  );
</script>

<section class="panel">
  <div class="panel-head">
    <div class="t">{$_('app.settings.autopilot')}</div>
    {#if data.autopilotEnabled}<span class="status"><span class="d"></span>{$_('app.settings.on')}</span>{/if}
  </div>
  <div class="field">
    <div class="ftxt">
      <div class="fh">{$_('app.settings.recurringPosting')}</div>
      <div class="fs">{$_('app.settings.recurringPostingDesc')}</div>
    </div>
    {#if autopilotLocked}
      <span class="soon">{$_('app.settings.disabled')}</span>
    {:else}
      <form method="POST" action="?/setAutopilot" use:enhance>
        <input type="hidden" name="enabled" value={data.autopilotEnabled ? 'false' : 'true'} />
        <button class="mini connect" type="submit">{data.autopilotEnabled ? $_('app.settings.turnOff') : $_('app.settings.turnOn')}</button>
      </form>
    {/if}
  </div>
  {#if autopilotLocked}
    <div class="field"><div class="fs" style="color:#a3700a;">{$_('app.settings.autopilotPaused')}</div></div>
  {/if}
  {#if lastRun}
    <div class="field"><div class="fs">{$_('app.settings.lastRun', { values: { time: lastRun } })}</div></div>
  {/if}
  {#if connected.length}
    <div class="field"><div class="ftxt"><div class="fh">{$_('app.settings.autoPublish')}</div><div class="fs">{$_('app.settings.autoPublishDesc')}</div></div></div>
    {#each connected as a (a.id)}
      {@const pk = (a.platform ?? '').toLowerCase()}
      {@const pm = PLATFORMS.find((p) => p.key === pk)}
      <div class="acct">
        <div class="glyph" style={`background:${pm?.bg ?? '#7c5cff'}`}>
          {#if ICONS[pk]}<svg viewBox="0 0 24 24" fill="#fff"><path d={ICONS[pk].path} /></svg>{:else}{pm?.glyph ?? (a.platform ?? '?').slice(0, 2).toUpperCase()}{/if}
        </div>
        <div class="nm"><div class="h">{a.display_name ?? a.username ?? a.platform}</div><div class="s">{$_('app.settings.autoPublishTo', { values: { platform: pm?.label ?? a.platform } })}</div></div>
      </div>
    {/each}
  {:else}
    <div class="field"><div class="fs">{$_('app.settings.connectToChoose')}</div></div>
  {/if}
  {#if form?.autopilotError}<div class="field"><div class="fs" style="color:#c0392b;">{form.autopilotError}</div></div>{/if}
</section>
