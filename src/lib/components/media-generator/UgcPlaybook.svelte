<!--
  IL PLAYBOOK UGC — quello che la pagina deve dire accanto al bottone.

  La pagina UGC sapeva generare clip e non diceva niente su come si produce un batch che funziona:
  quanti script, quanti volti, quante rese si buttano, e soprattutto che l'organico viene PRIMA di
  qualunque euro di paid. Senza quelle sette righe l'utente chiede tre clip, ne tiene due e conclude
  che lo strumento non funziona — mentre il tasso di scarto atteso è del 20-30% per chiunque.

  Le schede formato non sono decorative: cliccarne una IMPOSTA il formato del prossimo batch, e la
  barra sotto ogni titolo è la timeline vera, la stessa che finisce nel prompt del modello video.
-->
<script lang="ts">
  import {
    UGC_FORMATS,
    UGC_PLATFORMS,
    UGC_PRODUCTION_STEPS,
    UGC_EXPECTED_REJECTION,
    batchSizeForKeepers,
    formatBeats,
    platformClipSeconds,
    type UgcFormatId,
    type UgcPlatformId
  } from '$lib/ugc-formats';

  let {
    format = $bindable<'' | UgcFormatId>(''),
    platform = $bindable<'' | UgcPlatformId>(''),
    videoCount = 1,
    maxSeconds = 15,
    disabled = false
  }: {
    format?: '' | UgcFormatId;
    platform?: '' | UgcPlatformId;
    videoCount?: number;
    maxSeconds?: number;
    disabled?: boolean;
  } = $props();

  const seconds = $derived(platformClipSeconds(platform || null, maxSeconds));
  /** Quante rese servono per tenere `videoCount` clip buone, con lo scarto atteso. */
  const suggested = $derived(batchSizeForKeepers(videoCount));
  const rejectionLabel = `${Math.round(UGC_EXPECTED_REJECTION[0] * 100)}-${Math.round(
    UGC_EXPECTED_REJECTION[1] * 100
  )}%`;

  const visibleFormats = $derived(
    platform ? UGC_FORMATS.filter((f) => f.platforms.includes(platform as UgcPlatformId)) : UGC_FORMATS
  );

  function pickFormat(id: UgcFormatId) {
    format = format === id ? '' : id;
  }
  function pickPlatform(id: UgcPlatformId) {
    platform = platform === id ? '' : id;
    // Un formato non nativo sulla piattaforma appena scelta resterebbe selezionato in silenzio.
    if (platform && format) {
      const spec = UGC_FORMATS.find((f) => f.id === format);
      if (spec && !spec.platforms.includes(platform as UgcPlatformId)) format = '';
    }
  }
</script>

<div class="pb">
  <section class="pb-block">
    <h3>Come si produce un batch UGC</h3>
    <ol class="pb-steps">
      {#each UGC_PRODUCTION_STEPS as step, i (step.key)}
        <li>
          <span class="pb-step-n">{i + 1}</span>
          <span class="pb-step-body">
            <strong>{step.label}</strong>
            <span>{step.detail}</span>
          </span>
        </li>
      {/each}
    </ol>
    <p class="pb-note">
      Chiedi {videoCount} clip? Rendine <strong>{suggested}</strong>: il filtro qualità ne scarta il
      {rejectionLabel}, sempre. E i vincitori si scelgono organici, non in campagna.
    </p>
  </section>

  <section class="pb-block">
    <h3>Piattaforma</h3>
    <div class="pb-plats">
      {#each UGC_PLATFORMS as p (p.id)}
        <button
          type="button"
          class="pb-plat"
          class:on={platform === p.id}
          {disabled}
          onclick={() => pickPlatform(p.id)}
        >
          <strong>{p.label}</strong>
          <span>{p.sweetSpot[0]}-{p.sweetSpot[1]}s · {p.hashtags[0]}-{p.hashtags[1]} hashtag</span>
          <span class="pb-plat-cap"
            >Sottotitoli {p.captions === 'required' ? 'obbligatori' : 'consigliati'} · {p.cadence}</span
          >
        </button>
      {/each}
    </div>
    {#if platform}
      <p class="pb-note">{UGC_PLATFORMS.find((p) => p.id === platform)?.note}</p>
    {:else}
      <p class="pb-note">
        Nessuna piattaforma scelta: 9:16 verticale, hook nei primi 3 secondi, leggibile a volume zero.
      </p>
    {/if}
  </section>

  <section class="pb-block">
    <h3>
      Formato
      <span class="pb-h-note"
        >{format
          ? 'Tutte le clip del batch in questa forma.'
          : 'Nessuno scelto: il batch ruota i formati, così dieci clip non sono dieci parafrasi.'}</span
      >
    </h3>
    <div class="pb-formats">
      {#each visibleFormats as f (f.id)}
        {@const beats = formatBeats(f, seconds)}
        <button
          type="button"
          class="pb-format"
          class:on={format === f.id}
          {disabled}
          onclick={() => pickFormat(f.id)}
        >
          <span class="pb-f-head">
            <strong>{f.label}</strong>
            <span class="pb-f-secs">{seconds}s</span>
          </span>
          <span class="pb-f-what">{f.what}</span>
          <span class="pb-bar" aria-hidden="true">
            {#each beats as b (b.key)}
              <span class="pb-seg" style={`flex:${Math.max(0.4, b.end - b.start)}`}>
                <span class="pb-seg-label">{b.key.replace(/_/g, ' ')}</span>
              </span>
            {/each}
          </span>
          <span class="pb-f-best">{f.bestFor}</span>
        </button>
      {/each}
    </div>
  </section>
</div>

<style>
  .pb {
    display: flex;
    flex-direction: column;
    gap: 22px;
    max-width: 1080px;
    margin: 8px auto 0;
    padding: 0 4px;
  }
  .pb-block h3 {
    margin: 0 0 10px;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--ink);
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .pb-h-note,
  .pb-note {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--ink-soft);
    font-weight: 400;
  }
  .pb-note {
    margin: 10px 0 0;
  }

  .pb-steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 8px;
  }
  .pb-steps li {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 9px 10px;
    background: var(--paper);
  }
  .pb-step-n {
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--paper);
    font-size: 11px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .pb-step-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .pb-step-body strong {
    font-size: 12.5px;
    color: var(--ink);
  }
  .pb-step-body span {
    font-size: 12px;
    line-height: 1.45;
    color: var(--ink-soft);
  }

  .pb-plats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 8px;
  }
  .pb-plat {
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
    border: 1px solid var(--line);
    background: var(--paper);
    border-radius: 10px;
    padding: 10px;
    cursor: pointer;
    color: var(--ink-soft);
    font: inherit;
  }
  .pb-plat strong {
    font-size: 13px;
    color: var(--ink);
  }
  .pb-plat span {
    font-size: 12px;
  }
  .pb-plat-cap {
    color: var(--ink-faint);
  }
  .pb-plat:hover:not(:disabled),
  .pb-format:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .pb-plat.on,
  .pb-format.on {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .pb-plat:disabled,
  .pb-format:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .pb-formats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 8px;
  }
  .pb-format {
    display: flex;
    flex-direction: column;
    gap: 6px;
    text-align: left;
    border: 1px solid var(--line);
    background: var(--paper);
    border-radius: 10px;
    padding: 11px;
    cursor: pointer;
    font: inherit;
  }
  .pb-f-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .pb-f-head strong {
    font-size: 13px;
    color: var(--ink);
  }
  .pb-f-secs {
    font-size: 11px;
    color: var(--ink-faint);
  }
  .pb-f-what {
    font-size: 12px;
    line-height: 1.45;
    color: var(--ink-soft);
  }
  .pb-f-best {
    font-size: 11.5px;
    color: var(--ink-faint);
  }

  .pb-bar {
    display: flex;
    gap: 2px;
    height: 20px;
  }
  .pb-seg {
    background: var(--paper-2);
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    min-width: 0;
  }
  .pb-seg-label {
    font-size: 9px;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 3px;
  }
</style>
