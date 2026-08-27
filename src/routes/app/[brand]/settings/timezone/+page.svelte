<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';

  let { data, form } = $props();
  const brand = $derived(data.brand);

  const ZONES = [
    'Europe/Rome', 'Europe/London', 'Europe/Paris', 'Europe/Madrid', 'Europe/Berlin',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'
  ];
  const zoneOptions = $derived(
    ZONES.includes(brand.timezone) ? ZONES : [brand.timezone, ...ZONES]
  );
</script>

<section class="panel">
  <div class="panel-head"><div class="t">{$_('app.settings.postingTimezone')}</div></div>
  <div class="field">
    <div class="ftxt"><div class="fh">{$_('app.settings.scheduleTimes')}</div><div class="fs">{$_('app.settings.scheduleTimesDesc')}</div></div>
    <form method="POST" action="?/setTimezone" use:enhance class="tz-form">
      <select name="timezone" class="tz-select">
        {#each zoneOptions as z (z)}<option value={z} selected={z === brand.timezone}>{z.replace('_', ' ')}</option>{/each}
      </select>
      <button class="mini connect" type="submit">{$_('app.settings.save')}</button>
    </form>
  </div>
  {#if form?.tzSaved}<div class="field"><div class="fs" style="color:var(--accent);">{$_('app.settings.tzSavedToast')}</div></div>{/if}
  {#if form?.error}<div class="field"><div class="fs" style="color:#c0392b;">{form.error}</div></div>{/if}
</section>
