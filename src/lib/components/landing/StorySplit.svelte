<script lang="ts">
  import { _ } from 'svelte-i18n';

  /**
   * Il confronto con l'agenzia sta in fondo, non in mezzo: convince chi ha gia' capito il
   * prodotto, non chi lo sta capendo. Le due colonne entrano da lati opposti — e' l'unico
   * movimento della pagina che dice «questi due si contrappongono» senza scriverlo.
   */
  const TK = 'landing.split';
  const BEFORE = ['i1', 'i2', 'i3', 'i4'] as const;
  const AFTER = ['i1', 'i2', 'i3', 'i4', 'i5'] as const;
</script>

<section class="sp">
  <div class="wrap">
    <div class="sec-head reveal">
      <div class="kicker">{$_(`${TK}.kicker`)}</div>
      <h2>{$_(`${TK}.titleLead`)} <span class="gr-accent">{$_(`${TK}.titleAccent`)}</span></h2>
    </div>

    <div class="sp-grid">
      <article class="sp-col from-left">
        <h3>{$_(`${TK}.before.title`)}</h3>
        <p class="sp-note">{$_(`${TK}.before.note`)}</p>
        <ul>
          {#each BEFORE as k (k)}
            <li><span class="sp-x" aria-hidden="true"></span>{$_(`${TK}.before.${k}`)}</li>
          {/each}
        </ul>
      </article>

      <article class="sp-col is-ours from-right">
        <h3>{$_(`${TK}.after.title`)}</h3>
        <p class="sp-note">{$_(`${TK}.after.note`)}</p>
        <ul>
          {#each AFTER as k (k)}
            <li><span class="sp-v" aria-hidden="true"></span>{$_(`${TK}.after.${k}`)}</li>
          {/each}
        </ul>
      </article>
    </div>

    <p class="sp-punch reveal">{$_(`${TK}.punch`)}</p>
  </div>
</section>

<style>
  .sp { padding: clamp(80px, 10vw, 140px) 0 0; }

  .sp-grid {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: clamp(18px, 2.4vw, 30px);
    max-width: 1000px; margin: 0 auto;
  }

  /* Le due colonne sono alte uguali anche se una ha una voce in piu': `1fr` sulla riga le stira
     entrambe, e l'elenco si distribuisce invece di ammucchiarsi in cima. Due schede di altezza
     diversa, affiancate, si leggono come un difetto e non come un confronto. */
  .sp-col {
    display: flex; flex-direction: column;
    border: 1px solid var(--line); border-radius: 26px;
    padding: clamp(26px, 3.2vw, 40px);
    background: var(--paper-2);
  }
  .sp-col.is-ours {
    background: var(--paper);
    border-color: rgba(var(--accent-rgb), 0.35);
    box-shadow: 0 36px 80px -60px rgba(var(--accent-rgb), 0.75);
  }
  .sp-col h3 {
    margin: 0 0 6px; font-size: 1.25rem; font-weight: 650; letter-spacing: -0.015em;
    color: var(--ink);
  }
  .sp-col:not(.is-ours) h3 { color: var(--ink-soft); }
  .sp-note { margin: 0 0 22px; font-size: 0.9rem; color: var(--ink-faint); }

  .sp-col ul {
    flex: 1; list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: column; justify-content: space-between; gap: 14px;
  }
  .sp-col li {
    display: flex; gap: 12px; align-items: flex-start;
    font-size: 0.98rem; line-height: 1.5; color: var(--ink-soft);
  }
  .sp-col.is-ours li { color: var(--ink); }

  .sp-x, .sp-v { width: 16px; height: 16px; flex: none; margin-top: 3px; position: relative; }
  .sp-x::before, .sp-x::after {
    content: ''; position: absolute; inset: 50% 1px auto 1px; height: 1.5px;
    background: var(--ink-faint); border-radius: 2px;
  }
  .sp-x::before { transform: rotate(45deg); }
  .sp-x::after { transform: rotate(-45deg); }
  /* La spunta e' un angolo ruotato: nessuna icona da caricare, e segue il colore dell'accento. */
  .sp-v::after {
    content: ''; position: absolute; left: 3px; top: 1px; width: 7px; height: 11px;
    border: 2px solid var(--accent); border-top: 0; border-left: 0;
    transform: rotate(42deg); border-radius: 1px;
  }

  .sp-punch {
    max-width: 44ch; margin: clamp(38px, 5vw, 64px) auto 0; text-align: center;
    color: var(--ink-soft); font-size: 1.05rem; line-height: 1.55;
  }

  /* L'entrata dai due lati: contrapposizione detta col movimento. Dove le animazioni guidate
     dallo scorrimento non ci sono, le colonne stanno semplicemente al loro posto. */
  @supports (animation-timeline: view()) {
    @media (prefers-reduced-motion: no-preference) {
      .from-left, .from-right {
        animation: sp-in 0.8s var(--ease, cubic-bezier(0.22, 1, 0.36, 1)) both;
        animation-timeline: view();
        animation-range: entry 5% entry 55%;
      }
      .from-left { --x: -34px; }
      .from-right { --x: 34px; }
      @keyframes sp-in {
        from { opacity: 0; transform: translateX(var(--x)); }
        to { opacity: 1; transform: none; }
      }
    }
  }

  @media (max-width: 820px) {
    .sp-grid { grid-template-columns: 1fr; }
  }
</style>
