<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { PLATFORM_KEYS, PLATFORM_META } from '$lib/components/platform-meta';

  /**
   * La prova che pubblica davvero: i canali col loro marchio, non un elenco di nomi. La striscia
   * scorre da sola perche' e' l'unico movimento continuo della pagina — dopo tre sezioni ferme
   * dice «qui succede qualcosa» meglio di qualunque titolo.
   *
   * La lista arriva dalla stessa tabella che usa il publisher: non puo' promettere una rete su
   * cui il prodotto non sa pubblicare.
   */
  const TK = 'landing.story.channels';
  const MARKS = PLATFORM_KEYS.map((k) => ({ key: k, ...PLATFORM_META[k] }));
</script>

<section class="ch">
  <p class="ch-label reveal">{$_(`${TK}.label`)}</p>

  <div class="ch-viewport" aria-hidden="true">
    <div class="ch-track">
      {#each [0, 1] as lap}
        <ul class="ch-row">
          {#each MARKS as m (m.key + lap)}
            <li class="ch-chip">
              <span class="ch-mark" style="background:{m.bg}">
                {#if m.icon}
                  <svg viewBox="0 0 24 24" fill="#fff"><path d={m.icon.path} /></svg>
                {:else}{m.short}{/if}
              </span>
              {m.label}
            </li>
          {/each}
        </ul>
      {/each}
    </div>
  </div>

  <ul class="ch-sr">
    {#each MARKS as m (m.key)}<li>{m.label}</li>{/each}
  </ul>

  <p class="ch-note reveal">{$_(`${TK}.note`)}</p>
</section>

<style>
  .ch {
    padding: clamp(64px, 8vw, 110px) 0 clamp(40px, 5vw, 70px);
    overflow: hidden;
  }

  .ch-label,
  .ch-note {
    text-align: center; margin: 0 auto;
    font-size: 13px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--ink-faint);
  }
  .ch-note {
    margin-top: 40px; text-transform: none; letter-spacing: 0;
    font-size: 1.05rem; font-weight: 500; color: var(--ink-soft); max-width: 34ch;
  }

  .ch-viewport {
    margin-top: 38px;
    /* I bordi sfumano invece di tagliare: una striscia che scorre e finisce di netto si legge
       come un errore di layout, non come movimento. */
    mask-image: linear-gradient(to right, transparent, #000 12%, #000 88%, transparent);
    -webkit-mask-image: linear-gradient(to right, transparent, #000 12%, #000 88%, transparent);
  }
  .ch-track { display: flex; width: max-content; animation: ch-slide 42s linear infinite; }
  .ch-track:hover { animation-play-state: paused; }
  .ch-row { display: flex; align-items: center; gap: 14px; list-style: none; margin: 0; padding: 0 7px; }

  .ch-chip {
    display: inline-flex; align-items: center; gap: 10px;
    white-space: nowrap;
    font-size: 15px; font-weight: 550; color: var(--ink);
    background: var(--paper); border: 1px solid var(--line);
    border-radius: 999px; padding: 9px 18px 9px 9px;
  }
  .ch-mark {
    width: 28px; height: 28px; border-radius: 9px; flex: none;
    display: inline-grid; place-items: center;
    color: #fff; font-size: 11px; font-weight: 700;
  }
  .ch-mark svg { width: 15px; height: 15px; }

  /* L'elenco vero per chi legge con uno screen reader: la striscia e' decorativa e duplicata. */
  .ch-sr {
    position: absolute; width: 1px; height: 1px; overflow: hidden;
    clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
  }

  @keyframes ch-slide {
    to { transform: translateX(-50%); }
  }

  @media (prefers-reduced-motion: reduce) {
    .ch-track { animation: none; }
  }
</style>
