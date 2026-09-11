<script lang="ts">
  import { _ } from 'svelte-i18n';

  /**
   * L'obiezione numero uno di chi compra non e' «funziona?», e' «e se pubblica una cosa che non
   * voglio?». Quattro garanzie, dette corte, su una lastra d'accento: il colore e' la pausa fra
   * il capitolo di cosa fa e quello di quanto costa, e il nero sopra l'accento chiaro e' l'unica
   * combinazione che regge il contrasto in entrambi i temi (8:1, contro il 2,6:1 del bianco).
   */
  const TK = 'landing.story.control';
  const ITEMS = ['approve', 'voice', 'accounts', 'eu'] as const;
</script>

<section class="ct">
  <div class="wrap">
    <div class="ct-slab reveal">
      <div class="ct-head">
        <div class="ct-kicker">{$_(`${TK}.kicker`)}</div>
        <h2>{$_(`${TK}.title`)}</h2>
      </div>
      <ul class="ct-grid">
        {#each ITEMS as k, i (k)}
          <li class="ct-item reveal" data-d={(i % 3) + 1}>
            <h3>{$_(`${TK}.${k}.title`)}</h3>
            <p>{$_(`${TK}.${k}.body`)}</p>
          </li>
        {/each}
      </ul>
    </div>
  </div>
</section>

<style>
  .ct { padding: clamp(24px, 3vw, 44px) 0; }

  .ct-slab {
    background: var(--accent-2);
    color: rgba(0, 0, 0, 0.72);
    border-radius: clamp(26px, 3.4vw, 44px);
    padding: clamp(44px, 6vw, 86px) clamp(28px, 5vw, 76px);
    max-width: 1120px; margin: 0 auto;
  }

  .ct-head { max-width: 30ch; margin-bottom: clamp(38px, 5vw, 62px); }
  .ct-kicker {
    font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    color: rgba(0, 0, 0, 0.55); margin-bottom: 14px;
  }
  .ct-head h2 {
    margin: 0; color: #000;
    font-size: clamp(2rem, 4.2vw, 3.1rem);
    font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); line-height: 1.06;
  }

  .ct-grid {
    list-style: none; margin: 0; padding: 0;
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: clamp(26px, 4vw, 52px);
  }
  .ct-item { border-top: 1px solid rgba(0, 0, 0, 0.16); padding-top: 18px; }
  .ct-item h3 {
    margin: 0 0 8px; color: #000;
    font-size: 1.12rem; font-weight: 650; letter-spacing: -0.01em;
  }
  .ct-item p { margin: 0; font-size: 0.98rem; line-height: 1.55; color: rgba(0, 0, 0, 0.72); }

  @media (max-width: 760px) {
    .ct-grid { grid-template-columns: 1fr; gap: 26px; }
  }
</style>
