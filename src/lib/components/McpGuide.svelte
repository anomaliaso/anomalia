<script lang="ts">
  // La guida sta in cima alla home del brand, non dietro un link: collegare il proprio agente è
  // la prima cosa che il prodotto chiede di fare, e una guida che vive altrove non la apre
  // nessuno.
  //
  // È un <details> nativo, e resta aperto finché non lo chiude chi legge. NON prova a indovinare
  // se un agente è già collegato: oggi non esiste nessun segnale per saperlo — l'MCP remoto
  // autentica con un JWT Supabase indistinguibile da un login del browser, l'OAuth non tiene una
  // tabella di client (il client_id È la registrazione, firmata) e `api_keys.last_used_at` è
  // per utente e non viene mai toccato dal percorso MCP. Fingere «collegato» sarebbe peggio che
  // chiedere un click.

  import { _ } from 'svelte-i18n';

  const MCP_URL = 'https://mcp.anomalia.so/mcp';

  const REMOTE_CONFIG = `{
  "mcpServers": {
    "anomalia": { "url": "${MCP_URL}" }
  }
}`;

  const PLUGIN = `/plugin marketplace add anomaliaso/anomalia
/plugin install anomalia@anomalia`;

  const CLI = `curl -sSL https://raw.githubusercontent.com/anomaliaso/anomalia/main/cli/scripts/install.sh | bash
anomalia login`;

  const STEPS = [
    { id: 'remote', key: 'host', snippet: REMOTE_CONFIG },
    { id: 'plugin', key: 'plugin', snippet: PLUGIN },
    { id: 'cli', key: 'cli', snippet: CLI }
  ];

  let copied = $state<string | null>(null);

  // Fuori da https e localhost la clipboard non c'è: il testo resta selezionabile nel blocco,
  // quindi il fallimento è silenzioso e non un errore che finisce in Sentry.
  async function copy(step: string, snippet: string) {
    try {
      await navigator.clipboard.writeText(snippet);
      copied = step;
    } catch {
      copied = null;
    }
  }
</script>

<details open class="mcp">
  <summary>
    <span class="chev" aria-hidden="true">›</span>
    <strong>{$_('app.mcpGuide.title')}</strong>
    <span class="muted">{$_('app.mcpGuide.subtitle')}</span>
  </summary>

  <div class="body">
    {#each STEPS as step, i (step.id)}
      <section>
        <h3><span class="n">{i + 1}</span>{$_(`app.mcpGuide.${step.key}Title`)}</h3>
        <p class="muted">{$_(`app.mcpGuide.${step.key}Note`)}</p>
        <div class="snippet">
          <pre><code>{step.snippet}</code></pre>
          <button type="button" class:done={copied === step.id} onclick={() => copy(step.id, step.snippet)}>
            {copied === step.id ? $_('app.mcpGuide.copied') : $_('app.mcpGuide.copy')}
          </button>
        </div>
      </section>
    {/each}

    <p class="muted foot">
      {$_('app.mcpGuide.note', { values: { url: MCP_URL } })}
      <a href="/docs/mcp">{$_('app.mcpGuide.docs')}</a>
    </p>
  </div>
</details>

<style>
  /* La palette è quella del guscio (`--paper`, `--ink`, `--line`): la guida arriva da /v2, che
     aveva i suoi token, e due palette nella stessa pagina si vedono. L'accento entra solo dove
     serve a leggere — il numero del passo, il filo in testa, il bottone che ha copiato — perché
     tre blocchi di codice in scala di grigio si guardano tutti uguali e non si legge nessuno. */
  .mcp {
    /* La home è una colonna flex: senza questo la guida veniva schiacciata dallo shimmer sotto e
       si vedeva un terzo del primo comando, come se fosse chiusa. */
    flex: none;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--paper);
    overflow: hidden;
    margin-bottom: 20px;
  }
  summary {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 13px 16px;
    cursor: pointer;
    list-style: none;
    font-size: 13.5px;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover {
    background: var(--paper-2);
  }
  summary strong {
    font-size: 14px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .chev {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex: none;
    border-radius: 6px;
    background: rgba(var(--accent-rgb), 0.14);
    color: var(--accent);
    font-size: 13px;
    transition: transform 160ms ease;
  }
  .mcp[open] .chev {
    transform: rotate(90deg);
  }
  .muted {
    color: var(--ink-soft);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 20px;
    border-top: 1px solid var(--line);
    padding: 18px 16px 16px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 0;
    font-size: 13.5px;
    font-weight: 650;
    color: var(--ink);
  }
  /* Il numero dice che i tre blocchi sono strade alternative in ordine di comodità, non tre
     passaggi da fare tutti: è l'unica gerarchia che mancava per capirci qualcosa al primo sguardo. */
  .n {
    display: inline-grid;
    place-items: center;
    width: 19px;
    height: 19px;
    flex: none;
    border-radius: 50%;
    background: rgba(var(--accent-rgb), 0.14);
    color: var(--accent);
    font-size: 11px;
    font-weight: 700;
  }
  p {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
  }
  section > .muted {
    padding-left: 28px;
  }
  .snippet {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 5px 0 0 28px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--paper-2);
    padding: 10px 10px 10px 12px;
  }
  /* Il blocco scorre da solo: la pagina non deve mai scorrere in orizzontale per un comando. */
  pre {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow-x: auto;
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.6;
    color: var(--ink);
  }
  button {
    flex: none;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink-soft);
    padding: 5px 12px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
  }
  button:hover {
    color: var(--ink);
    border-color: var(--line-2);
  }
  button.done {
    color: var(--accent);
    border-color: rgba(var(--accent-rgb), 0.4);
    background: rgba(var(--accent-rgb), 0.1);
  }
  .foot {
    padding-left: 28px;
    font-size: 11.5px;
  }
  .foot a {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
