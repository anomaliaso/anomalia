<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { siClaude } from 'simple-icons';

  /**
   * La domanda subito dopo «cosa esce» e' «come si usa», e il prodotto ha due porte che valgono
   * uguale: la propria AI via MCP, oppure l'app. Due schede gemelle, stessa larghezza e stesso
   * peso tipografico — appena una delle due diventa piu' grande, diventa anche l'unica che si
   * legge, e l'altra passa per ripiego.
   */
  const TK = 'landing.story.doors';

  let { onconnect, appHref }: { onconnect: () => void; appHref: string } = $props();

  const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const FILLED = new Set([1, 3, 4, 8, 10, 13]);
</script>

<section class="dr">
  <div class="wrap">
    <div class="sec-head reveal">
      <div class="kicker">{$_(`${TK}.kicker`)}</div>
      <h2>{$_(`${TK}.title`)}</h2>
      <p>{$_(`${TK}.sub`)}</p>
    </div>

    <div class="dr-grid">
      <article class="dr-card reveal" data-d="1">
        <div class="dr-mock dr-chat">
          <div class="dr-msg me">{$_(`${TK}.mcp.ask`)}</div>
          <div class="dr-tool">
            <span class="dr-tool-dot"></span>plan_week
          </div>
          <div class="dr-msg">{$_(`${TK}.mcp.reply`)}</div>
        </div>
        <div class="dr-body">
          <h3>{$_(`${TK}.mcp.title`)}</h3>
          <p>{$_(`${TK}.mcp.body`)}</p>
          <button type="button" class="dr-btn" onclick={onconnect}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={siClaude.path} fill="currentColor" /></svg>
            {$_(`${TK}.mcp.cta`)}
          </button>
        </div>
      </article>

      <article class="dr-card reveal" data-d="2">
        <div class="dr-mock dr-app">
          <div class="dr-app-bar">
            <span class="dr-app-dot"></span>{$_(`${TK}.app.bar`)}
          </div>
          <div class="dr-days">{#each DAYS as d}<span>{d}</span>{/each}</div>
          <div class="dr-cells">
            {#each Array(14) as _, i}
              <span class="dr-cell" class:on={FILLED.has(i)}></span>
            {/each}
          </div>
          <div class="dr-approve">{$_(`${TK}.app.approve`)}</div>
        </div>
        <div class="dr-body">
          <h3>{$_(`${TK}.app.title`)}</h3>
          <p>{$_(`${TK}.app.body`)}</p>
          <a class="dr-btn ghost" href={appHref}>{$_(`${TK}.app.cta`)}</a>
        </div>
      </article>
    </div>

    <p class="dr-note reveal">{$_(`${TK}.note`)}</p>
  </div>
</section>

<style>
  /* La fascia cambia carta e si stacca con gli angoli in alto: e' il passaggio dal capitolo
     precedente, senza una riga di separazione che nessuno guarda. */
  .dr {
    background: var(--paper-2);
    border-radius: clamp(28px, 4vw, 56px) clamp(28px, 4vw, 56px) 0 0;
    padding: clamp(80px, 10vw, 150px) 0 clamp(80px, 10vw, 150px);
    margin-top: clamp(40px, 6vw, 90px);
  }

  .dr-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: clamp(20px, 2.6vw, 34px);
    max-width: 1040px; margin: 0 auto;
  }

  .dr-card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 26px;
    overflow: hidden;
    display: flex; flex-direction: column;
    transition: transform 400ms var(--ease, ease), box-shadow 400ms var(--ease, ease);
  }
  .dr-card:hover { transform: translateY(-3px); box-shadow: 0 30px 70px -50px rgba(0, 0, 0, 0.4); }

  /* Altezza fissa, non minima: le due finte hanno contenuti diversi e con un minimo i due titoli
     partirebbero a quote diverse — e due schede gemelle disallineate non sembrano gemelle. */
  .dr-mock {
    padding: 22px;
    height: 250px; overflow: hidden;
    border-bottom: 1px solid var(--line);
    background:
      radial-gradient(120% 90% at 50% 0%, rgba(var(--accent-rgb), 0.08), transparent 70%),
      var(--paper-2);
  }

  .dr-chat { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
  .dr-msg {
    font-size: 13px; line-height: 1.45; color: var(--ink);
    background: var(--paper); border: 1px solid var(--line);
    border-radius: 14px 14px 14px 4px; padding: 10px 13px; max-width: 82%;
  }
  .dr-msg.me {
    align-self: flex-end;
    background: rgba(var(--accent-rgb), 0.12); border-color: transparent;
    border-radius: 14px 14px 4px 14px;
  }
  .dr-tool {
    display: inline-flex; align-items: center; gap: 7px;
    font-family: var(--mono); font-size: 11.5px; color: var(--ink-soft);
    background: var(--paper); border: 1px solid var(--line);
    border-radius: 999px; padding: 5px 12px;
  }
  .dr-tool-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }

  .dr-app { display: flex; flex-direction: column; gap: 11px; }
  .dr-app-bar {
    display: flex; align-items: center; gap: 7px;
    font-size: 11.5px; font-weight: 600; color: var(--ink-soft);
  }
  .dr-app-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  .dr-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; font-size: 9.5px; color: var(--ink-faint); }
  .dr-days span { text-align: center; }
  .dr-cells { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
  .dr-cell { aspect-ratio: 1; border-radius: 6px; background: var(--line); }
  .dr-cell.on { background: rgba(var(--accent-rgb), 0.5); }
  .dr-approve {
    align-self: flex-start;
    font-size: 11.5px; font-weight: 600; color: var(--ink);
    background: var(--paper); border: 1px solid var(--line);
    border-radius: 999px; padding: 6px 13px;
  }

  .dr-body { padding: 24px 26px 26px; display: flex; flex-direction: column; align-items: flex-start; gap: 10px; flex: 1; }
  .dr-body h3 {
    margin: 0; font-size: clamp(1.25rem, 2vw, 1.6rem);
    font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking);
  }
  .dr-body p { margin: 0; color: var(--ink-soft); font-size: 0.98rem; line-height: 1.55; flex: 1; }

  .dr-btn {
    display: inline-flex; align-items: center; gap: 8px;
    margin-top: 8px; border: 0; cursor: pointer;
    background: var(--ink); color: var(--paper);
    font-size: 14px; font-weight: 600; font-family: inherit;
    padding: 11px 20px; border-radius: 999px; text-decoration: none;
    transition: opacity 160ms ease, transform 160ms ease;
  }
  .dr-btn:hover { opacity: 0.9; transform: translateY(-1px); }
  .dr-btn svg { width: 15px; height: 15px; }
  .dr-btn.ghost {
    background: transparent; color: var(--ink);
    border: 1px solid var(--line-2);
  }
  .dr-btn.ghost:hover { background: var(--paper-2); }

  .dr-note {
    text-align: center; color: var(--ink-faint);
    font-size: 0.92rem; margin: 34px auto 0; max-width: 46ch;
  }

  @media (max-width: 820px) {
    .dr-grid { grid-template-columns: 1fr; }
  }
</style>
