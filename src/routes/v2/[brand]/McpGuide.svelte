<script lang="ts">
  // La guida sta in cima alla dashboard, non dietro un link: collegare il proprio agente è la
  // prima cosa che il prodotto chiede di fare, e una guida che vive altrove non la fa nessuno.
  //
  // È un <details> nativo, e resta aperto finché non lo chiude chi legge. NON prova a indovinare
  // se un agente è già collegato: oggi non esiste nessun segnale per saperlo — l'MCP remoto
  // autentica con un JWT Supabase indistinguibile da un login del browser, l'OAuth non tiene una
  // tabella di client (il client_id È la registrazione, firmata) e `api_keys.last_used_at` è
  // per utente e non viene mai toccato dal percorso MCP. Fingere «collegato» sarebbe peggio che
  // chiedere un click.

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
    {
      id: 'remote',
      title: 'Any MCP host — Claude, Cursor, ChatGPT',
      note: 'Paste into the host’s MCP config. It asks you to sign in the first time (OAuth); after that every call carries your token.',
      snippet: REMOTE_CONFIG
    },
    {
      id: 'plugin',
      title: 'Claude Code — the plugin',
      note: 'Bundles the same remote MCP plus the Anomalia skill. On Codex: codex plugin marketplace add anomaliaso/anomalia',
      snippet: PLUGIN
    },
    {
      id: 'cli',
      title: 'Terminal, or a host that cannot send a Bearer header',
      note: 'The CLI login writes the session the local stdio MCP server reads.',
      snippet: CLI
    }
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

<details
  open
  class="border-border bg-card overflow-hidden rounded-xl border [&[open]_.chevron]:rotate-90"
>
  <summary
    class="hover:bg-muted focus-visible:ring-ring/50 flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm focus-visible:ring-3 focus-visible:outline-none"
  >
    <span class="chevron text-muted-foreground transition-transform" aria-hidden="true">›</span>
    <span class="font-semibold">Connect your agent</span>
    <span class="text-muted-foreground">Drive this brand from Claude, Cursor or ChatGPT</span>
  </summary>

  <div class="border-border flex flex-col gap-4 border-t px-4 py-4">
    {#each STEPS as step (step.id)}
      <section class="flex flex-col gap-1.5">
        <h3 class="text-sm font-medium">{step.title}</h3>
        <p class="text-muted-foreground text-xs">{step.note}</p>
        <div class="border-border bg-background flex items-start gap-2 rounded-lg border p-2">
          <pre
            class="min-w-0 flex-1 overflow-x-auto text-xs leading-relaxed"><code>{step.snippet}</code></pre>
          <button
            type="button"
            onclick={() => copy(step.id, step.snippet)}
            class="border-border hover:bg-muted focus-visible:ring-ring/50 flex-none rounded-md border px-2 py-1 text-xs focus-visible:ring-3 focus-visible:outline-none"
          >
            {copied === step.id ? 'Copied' : 'Copy'}
          </button>
        </div>
      </section>
    {/each}

    <p class="text-muted-foreground text-xs">
      The remote server is <code>{MCP_URL}</code> and needs an
      <code>Authorization: Bearer</code> header — a 401 without one is the correct answer, not a
      fault. If your host registers a custom-scheme OAuth callback and the connection is refused,
      use the CLI plus the local stdio server instead.
      <a href="/docs/mcp" class="underline underline-offset-4">Full setup</a>.
    </p>
  </div>
</details>
