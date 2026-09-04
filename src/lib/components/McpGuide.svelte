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
    {#each STEPS as step (step.id)}
      <section>
        <h3>{$_(`app.mcpGuide.${step.key}Title`)}</h3>
        <p class="muted">{$_(`app.mcpGuide.${step.key}Note`)}</p>
        <div class="snippet">
          <pre><code>{step.snippet}</code></pre>
          <button type="button" onclick={() => copy(step.id, step.snippet)}>
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
     aveva i suoi token, e due palette nella stessa pagina si vedono. */
  .mcp {
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--paper);
    overflow: hidden;
    margin-bottom: 20px;
  }
  summary {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
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
  .chev {
    color: var(--ink-faint);
    transition: transform 140ms ease;
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
    gap: 16px;
    border-top: 1px solid var(--line);
    padding: 16px 14px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  h3 {
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ink);
  }
  p {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
  }
  .snippet {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper-2);
    padding: 8px;
    margin-top: 3px;
  }
  /* Il blocco scorre da solo: la pagina non deve mai scorrere in orizzontale per un comando. */
  pre {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow-x: auto;
    font-size: 12px;
    line-height: 1.55;
  }
  button {
    flex: none;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--paper);
    color: var(--ink-soft);
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
  }
  button:hover {
    color: var(--ink);
  }
  .foot {
    font-size: 11.5px;
  }
  .foot a {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
