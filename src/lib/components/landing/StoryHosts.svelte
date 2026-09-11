<script lang="ts">
  import { _ } from 'svelte-i18n';
  import {
    siClaude,
    siCursor,
    siGooglegemini,
    siOpencode,
    siWindsurf,
    siPerplexity,
    siCline,
    siGithubcopilot,
    siReplit,
    siWarp,
    siQwen,
    siMistralai,
    siRaycast,
    siZapier,
    siWebflow,
    siMake
  } from 'simple-icons';
  import { siOpenaiMark } from '$lib/marks';

  /**
   * L'ultima obiezione prima del prezzo: «funziona con la mia?». Un muro di marchi risponde in un
   * secondo, e la riga sotto dice la regola vera — non e' un elenco di integrazioni fatte una a
   * una, e' un server MCP, quindi vale anche per quello che non e' scritto qui.
   *
   * Gli stessi marchi della hero, e per la stessa ragione: sono quelli che `simple-icons` ha. Un
   * logo ridisegnato a mano si riconosce, e si riconosce come sbagliato.
   */
  const TK = 'landing.story.hosts';
  const MARKS = [
    { n: 'Claude', i: siClaude },
    { n: 'ChatGPT', i: siOpenaiMark },
    { n: 'Cursor', i: siCursor },
    { n: 'Gemini', i: siGooglegemini },
    { n: 'Copilot', i: siGithubcopilot },
    { n: 'OpenCode', i: siOpencode },
    { n: 'Windsurf', i: siWindsurf },
    { n: 'Cline', i: siCline },
    { n: 'Perplexity', i: siPerplexity },
    { n: 'Replit', i: siReplit },
    { n: 'Warp', i: siWarp },
    { n: 'Qwen', i: siQwen },
    { n: 'Mistral', i: siMistralai },
    { n: 'Raycast', i: siRaycast },
    { n: 'Zapier', i: siZapier },
    { n: 'Make', i: siMake },
    { n: 'Webflow', i: siWebflow }
  ];
</script>

<section class="hs">
  <div class="wrap">
    <div class="sec-head reveal">
      <div class="kicker">{$_(`${TK}.kicker`)}</div>
      <h2>{$_(`${TK}.title`)}</h2>
      <p>{$_(`${TK}.sub`)}</p>
    </div>

    <ul class="hs-grid">
      {#each MARKS as m, i (m.n)}
        <li
          class="hs-cell reveal"
          data-d={(i % 3) + 1}
          style="--c:{'mono' in m.i && m.i.mono ? 'var(--ink)' : `#${m.i.hex}`}"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={m.i.path} fill="currentColor" /></svg>
          <span>{m.n}</span>
        </li>
      {/each}
      <!-- La diciottesima cella chiude la griglia e dice la regola: l'elenco non e' il confine.
           Serve anche a non lasciare un buco dove la riga finisce prima della colonna. -->
      <li class="hs-cell is-more">
        <span class="hs-plus" aria-hidden="true">+</span>
        <span>{$_(`${TK}.more`)}</span>
      </li>
    </ul>
  </div>
</section>

<style>
  .hs { padding: clamp(60px, 7vw, 100px) 0 clamp(40px, 5vw, 70px); }

  .hs-grid {
    list-style: none; margin: 0 auto; padding: 0;
    max-width: 980px;
    display: grid; grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 1px;
    background: var(--line);
    border: 1px solid var(--line);
    border-radius: 24px;
    overflow: hidden;
  }

  /* Griglia a filo unico: le celle sono separate dallo sfondo che passa nei solchi da 1px,
     quindi nessun bordo si raddoppia dove due celle si toccano. */
  .hs-cell {
    background: var(--paper);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px;
    padding: 26px 10px;
    color: var(--ink-faint);
    transition: color 220ms ease, background 220ms ease;
  }
  .hs-cell:hover { color: var(--c); background: var(--paper-2); }
  .hs-cell.is-more { background: rgba(var(--accent-rgb), 0.07); color: var(--accent); }
  .hs-cell .hs-plus { font-size: 24px; line-height: 26px; font-weight: 300; }
  .hs-cell.is-more span:last-child { color: var(--accent); }
  .hs-cell svg { width: 26px; height: 26px; }
  .hs-cell span { font-size: 11.5px; font-weight: 550; color: var(--ink-soft); }

  /* Le colonne sono sempre un divisore di 18: tre o due, mai quattro — altrimenti l'ultima riga
     resta spaiata e i buchi si vedono, perche' i solchi della griglia sono lo sfondo. */
  @media (max-width: 860px) {
    .hs-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  @media (max-width: 520px) {
    .hs-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .hs-cell { padding: 20px 6px; }
  }
</style>
