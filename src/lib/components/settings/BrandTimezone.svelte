<script lang="ts">
  /**
   * Il fuso di pubblicazione. Non è una sezione dello Studio — non descrive il brand, descrive
   * QUANDO lavora — ma vive nella stessa pagina perché è così che `get_brand_settings` lo
   * raggruppa, e due superfici che citano lo stesso contratto devono mostrare la stessa forma.
   */
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';

  let { timezone, form }: { timezone: string; form: { tzSaved?: boolean; error?: string } | null } =
    $props();

  // Quindici zone coprono i mercati del prodotto; quella del brand entra comunque in lista anche
  // se non è fra loro, o cambiando pagina se la vedrebbe sostituita da un'altra.
  const ZONES = [
    'Europe/Rome', 'Europe/London', 'Europe/Paris', 'Europe/Madrid', 'Europe/Berlin',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo',
    'Australia/Sydney'
  ];
  const zoneOptions = $derived(ZONES.includes(timezone) ? ZONES : [timezone, ...ZONES]);
</script>

<section id="timezone" class="studio-section">
  <h2 class="section-title">{$_('app.settings.postingTimezone')}</h2>
  <p class="tz-desc">{$_('app.settings.scheduleTimesDesc')}</p>
  <!-- La conseguenza che un utente non può indovinare: `posts.scheduled_for` è `timestamptz` e la
       conversione avviene una volta sola, quando la riga viene scritta. Senza questa frase, chi
       cambia fuso crede di aver spostato il calendario. È la stessa di `set_brand_settings`. -->
  <p class="tz-warn">{$_('app.settings.tzKeepsAbsolute')}</p>

  <form method="POST" action="?/setTimezone" use:enhance class="tz-form">
    <label class="sr-only" for="brand-timezone">{$_('app.settings.postingTimezone')}</label>
    <select id="brand-timezone" name="timezone" class="tz-select">
      {#each zoneOptions as zone (zone)}
        <option value={zone} selected={zone === timezone}>{zone.replace('_', ' ')}</option>
      {/each}
    </select>
    <button class="btn" type="submit">{$_('app.settings.save')}</button>
  </form>

  {#if form?.tzSaved}<p class="tz-ok">{$_('app.settings.tzSavedToast')}</p>{/if}
  {#if form?.error}<p class="tz-err">{form.error}</p>{/if}
</section>

<style>
  .tz-desc,
  .tz-warn {
    margin: 0 0 6px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--ink-soft);
    max-width: 68ch;
  }
  .tz-warn {
    margin-bottom: 12px;
    color: var(--ink);
  }
  .tz-form {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .tz-select {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    padding: 7px 10px;
    font-size: 13.5px;
    font-family: inherit;
  }
  .tz-ok,
  .tz-err {
    margin: 8px 0 0;
    font-size: 13px;
  }
  .tz-ok {
    color: var(--accent);
  }
  .tz-err {
    color: #c0392b;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
