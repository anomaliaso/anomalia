<script lang="ts">
  import { _ } from 'svelte-i18n';

  /**
   * Chi legge questa sezione ha gia' capito il prodotto e sta pensando «me lo scrivo io». Non si
   * risponde con un argomento: si mette in fila l'idraulica, sei righe che parlano da sole. Il
   * testo grande sta a sinistra e la lista a destra perche' la lista deve sembrare lunga — ed e'
   * lunga davvero.
   */
  const TK = 'landing.diy';
  const ITEMS = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6'] as const;
</script>

<section class="dy">
  <div class="wrap">
    <div class="dy-grid">
      <div class="dy-copy reveal">
        <div class="kicker">{$_(`${TK}.kicker`)}</div>
        <h2>{$_(`${TK}.titleLead`)} <span class="gr-accent">{$_(`${TK}.titleAccent`)}</span></h2>
      </div>

      <ul class="dy-list">
        {#each ITEMS as k, i (k)}
          <li class="reveal" data-d={(i % 3) + 1}>
            <span class="dy-x" aria-hidden="true"></span>
            {$_(`landing.story.diy.${k}`)}
          </li>
        {/each}
      </ul>
    </div>
  </div>
</section>

<style>
  .dy { padding: clamp(80px, 10vw, 150px) 0 clamp(20px, 3vw, 40px); }

  .dy-grid {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr);
    gap: clamp(36px, 6vw, 92px); align-items: start;
    max-width: 1080px; margin: 0 auto;
  }

  .dy-copy .kicker {
    font-size: 13px; font-weight: 600; letter-spacing: 0.04em;
    color: var(--accent); margin-bottom: 14px;
  }
  .dy-copy h2 {
    margin: 0;
    font-size: clamp(2rem, 4.2vw, 3.1rem);
    font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); line-height: 1.06;
  }

  .dy-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .dy-list li {
    display: flex; align-items: center; gap: 14px;
    padding: 15px 4px;
    border-top: 1px solid var(--line);
    font-size: 1rem; color: var(--ink); line-height: 1.4;
  }
  .dy-list li:last-child { border-bottom: 1px solid var(--line); }

  /* Una croce disegnata coi bordi: due righe di CSS invece di un'icona da caricare per sei volte. */
  .dy-x { position: relative; width: 15px; height: 15px; flex: none; opacity: 0.45; }
  .dy-x::before,
  .dy-x::after {
    content: ''; position: absolute; inset: 50% 0 auto 0;
    height: 1.5px; background: var(--ink); border-radius: 2px;
  }
  .dy-x::before { transform: rotate(45deg); }
  .dy-x::after { transform: rotate(-45deg); }

  @media (max-width: 860px) {
    .dy-grid { grid-template-columns: 1fr; gap: 34px; }
  }
</style>
