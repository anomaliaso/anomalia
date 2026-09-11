<script lang="ts">
  import { _ } from 'svelte-i18n';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const TK = 'landing.hero.connect';
  const MCP_URL = 'https://mcp.anomalia.so/mcp';

  /**
   * Tre strade, in ordine di quanto chiedono a chi legge — e la prima non chiede niente. Chi apre
   * questo riquadro spesso non sa cosa sia un MCP: la via consigliata dev'essere quella dove non
   * deve saperlo, e le altre due restano li' per chi le cerca.
   */
  let tab = $state<'auto' | 'mcp' | 'cli'>('auto');
  let copied = $state('');

  function copy(value: string, id: string) {
    navigator.clipboard?.writeText(value);
    copied = id;
    setTimeout(() => (copied = ''), 2200);
  }

  /**
   * Il testo da incollare al proprio agente. Resta in inglese in ogni lingua: e' un prompt per una
   * macchina, e tradurlo e' un modo di romperlo. Nomina solo cose che esistono — l'indirizzo
   * risponde, e le prime due chiamate sono quelle che il server stesso suggerisce al handshake.
   */
  const PROMPT = `Add Anomalia as an MCP server and start using it.

Anomalia is a marketing control plane: it holds a brand's posts, editorial plan, media library,
blog, SEO and ads, and you drive it with your own model.

1. Add the server. It speaks streamable HTTP at ${MCP_URL} and signs in with OAuth —
   there are no API keys to paste. In Claude Code that is:
   claude mcp add --transport http anomalia ${MCP_URL}
   In any other host: add a remote MCP server at that URL and finish the sign-in it opens.

2. Once connected, call list_brands to see which brands I can work on, then ask me which one
   to use. Never pick one yourself — each brand spends a real organisation's credits.

3. With a slug, get_dashboard gives you the state of that brand, and query reads any table
   directly. Reads cost nothing; anything that spends says so in its own description.`;

  /**
   * Un'app per riga: il comando quando esiste ed e' verificato, altrimenti il link alla sua
   * documentazione. Inventare i passi di un'app che non conosco produrrebbe istruzioni che non
   * funzionano, ed e' peggio che mandare qualcuno a leggere la fonte.
   */
  const APPS: Array<{ name: string; how: string; snippet?: string; file?: string; docs: string }> = [
    {
      name: 'Claude Code',
      how: 'oneCommand',
      snippet: `claude mcp add --transport http anomalia ${MCP_URL}`,
      docs: 'https://docs.claude.com/en/docs/claude-code/mcp'
    },
    { name: 'Claude Desktop', how: 'connectors', docs: 'https://support.anthropic.com/en/articles/11175166' },
    { name: 'ChatGPT', how: 'connectors', docs: 'https://platform.openai.com/docs/mcp' },
    {
      name: 'Codex',
      how: 'configFile',
      file: '~/.codex/config.toml',
      snippet: `[mcp_servers.anomalia]\nurl = "${MCP_URL}"`,
      docs: 'https://developers.openai.com/codex/mcp'
    },
    {
      name: 'Cursor',
      how: 'configFile',
      file: '~/.cursor/mcp.json',
      snippet: `{\n  "mcpServers": {\n    "anomalia": { "url": "${MCP_URL}" }\n  }\n}`,
      docs: 'https://docs.cursor.com/context/mcp'
    },
    {
      name: 'OpenCode',
      how: 'configFile',
      file: 'opencode.json',
      snippet: `{\n  "mcp": {\n    "anomalia": { "type": "remote", "url": "${MCP_URL}" }\n  }\n}`,
      docs: 'https://opencode.ai/docs/mcp-servers/'
    },
    { name: 'Grok', how: 'connectors', docs: 'https://docs.x.ai/docs/guides/mcp-integrations' }
  ];

  const CLI = `curl -sSL https://raw.githubusercontent.com/anomaliaso/anomalia/main/cli/scripts/install.sh | bash
anomalia login
anomalia brands`;
</script>

{#if open}
  <div
    class="cd-overlay"
    role="presentation"
    onclick={(e) => e.target === e.currentTarget && (open = false)}
    onkeydown={(e) => e.key === 'Escape' && (open = false)}
  >
    <div class="cd-card" role="dialog" aria-modal="true" aria-labelledby="cd-title">
      <button class="cd-close" onclick={() => (open = false)} aria-label={$_(`${TK}.close`)}>×</button>

      <h3 id="cd-title">{$_(`${TK}.title`)}</h3>
      <p class="cd-sub">{$_(`${TK}.subtitle`)}</p>

      <div class="cd-tabs" role="tablist" aria-label={$_(`${TK}.title`)}>
        {#each ['auto', 'mcp', 'cli'] as const as t}
          <button
            class="cd-tab"
            class:active={tab === t}
            role="tab"
            aria-selected={tab === t}
            onclick={() => (tab = t)}
          >
            {$_(`${TK}.tabs.${t}`)}
            {#if t === 'auto'}<span class="cd-pill">{$_(`${TK}.easiest`)}</span>{/if}
          </button>
        {/each}
      </div>

      {#if tab === 'auto'}
        <ol class="cd-steps">
          <li><span class="cd-n">1</span><p>{$_(`${TK}.auto.s1`)}</p></li>
          <li><span class="cd-n">2</span><p>{$_(`${TK}.auto.s2`)}</p></li>
          <li><span class="cd-n">3</span><p>{$_(`${TK}.auto.s3`)}</p></li>
        </ol>

        <button class="cd-big" onclick={() => copy(PROMPT, 'prompt')}>
          {copied === 'prompt' ? $_(`${TK}.copiedBig`) : $_(`${TK}.copyBig`)}
        </button>

        <details class="cd-peek">
          <summary>{$_(`${TK}.auto.peek`)}</summary>
          <pre>{PROMPT}</pre>
        </details>

        <p class="cd-note">{$_(`${TK}.auto.note`)}</p>
      {:else if tab === 'mcp'}
        <p class="cd-lead">{$_(`${TK}.mcp.lead`)}</p>

        <div class="cd-url">
          <code>{MCP_URL}</code>
          <button class="cd-copy" onclick={() => copy(MCP_URL, 'url')}>
            {copied === 'url' ? $_(`${TK}.copied`) : $_(`${TK}.copy`)}
          </button>
        </div>

        <ul class="cd-apps">
          {#each APPS as app}
            <li>
              <div class="cd-app-head">
                <b>{app.name}</b>
                <span class="cd-how">{$_(`${TK}.how.${app.how}`)}</span>
                <a href={app.docs} target="_blank" rel="noopener noreferrer">{$_(`${TK}.mcp.docs`)} ↗</a>
              </div>
              {#if app.snippet}
                {#if app.file}<span class="cd-file">{app.file}</span>{/if}
                <div class="cd-block">
                  <pre>{app.snippet}</pre>
                  <button class="cd-copy" onclick={() => copy(app.snippet ?? '', app.name)}>
                    {copied === app.name ? $_(`${TK}.copied`) : $_(`${TK}.copy`)}
                  </button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="cd-lead">{$_(`${TK}.cli.lead`)}</p>
        <div class="cd-block">
          <pre>{CLI}</pre>
          <button class="cd-copy" onclick={() => copy(CLI, 'cli')}>
            {copied === 'cli' ? $_(`${TK}.copied`) : $_(`${TK}.copy`)}
          </button>
        </div>
        <p class="cd-note">{$_(`${TK}.cli.note`)}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .cd-overlay {
    position: fixed; inset: 0; z-index: 200;
    display: grid; place-items: center; padding: 20px;
    background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(4px);
    animation: fade 160ms ease;
  }
  @keyframes fade { from { opacity: 0; } }

  .cd-card {
    position: relative;
    width: min(560px, 100%); max-height: 88vh; overflow: auto;
    background: var(--paper); color: var(--ink);
    border: 1px solid var(--line); border-radius: 24px;
    padding: 34px 32px 30px;
    box-shadow: 0 40px 90px -50px rgba(0, 0, 0, 0.6);
    animation: rise 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(12px); } }

  .cd-close {
    position: absolute; top: 16px; right: 18px;
    border: none; background: transparent; color: var(--ink-faint);
    font-size: 26px; line-height: 1; padding: 4px; cursor: pointer;
  }
  .cd-close:hover { color: var(--ink); }

  h3 { margin: 0; font-size: 1.5rem; letter-spacing: -0.03em; }
  .cd-sub { margin: 8px 0 0; color: var(--ink-soft); font-size: 0.98rem; line-height: 1.5; }

  .cd-tabs { display: flex; gap: 4px; margin: 24px 0 22px; border-bottom: 1px solid var(--line); }
  .cd-tab {
    display: inline-flex; align-items: center; gap: 7px;
    border: none; background: transparent; color: var(--ink-soft);
    padding: 10px 12px; font-size: 14px; font-weight: 600; cursor: pointer;
    border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  .cd-tab:hover { color: var(--ink); }
  .cd-tab.active { color: var(--ink); border-bottom-color: var(--accent); }
  .cd-pill {
    font-size: 10px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;
    color: var(--accent); background: rgba(var(--accent-rgb), 0.12);
    border-radius: 999px; padding: 2px 7px;
  }

  /* I tre passi prima del bottone: chi non sa cosa sia un MCP deve sapere cosa succedera' prima
     di premere, o il bottone e' un salto nel buio. */
  .cd-steps { list-style: none; margin: 0 0 22px; padding: 0; display: grid; gap: 14px; }
  .cd-steps li { display: flex; gap: 13px; align-items: flex-start; }
  .cd-steps p { margin: 0; font-size: 0.95rem; line-height: 1.5; color: var(--ink); padding-top: 2px; }
  .cd-n {
    width: 25px; height: 25px; flex: none; border-radius: 50%;
    display: grid; place-items: center;
    background: rgba(var(--accent-rgb), 0.14); color: var(--accent);
    font-size: 12.5px; font-weight: 700;
  }

  .cd-big {
    width: 100%; border: none; cursor: pointer;
    background: var(--ink); color: var(--paper);
    border-radius: 14px; padding: 16px; font-size: 15px; font-weight: 650;
    transition: transform 140ms ease, opacity 140ms ease;
  }
  .cd-big:hover { transform: translateY(-1px); opacity: 0.92; }
  .cd-big:active { transform: none; }

  .cd-peek { margin-top: 14px; }
  .cd-peek summary {
    cursor: pointer; font-size: 12.5px; color: var(--ink-soft);
    list-style: none; padding: 4px 0;
  }
  .cd-peek summary::-webkit-details-marker { display: none; }
  .cd-peek summary::before { content: '▸ '; }
  .cd-peek[open] summary::before { content: '▾ '; }
  .cd-peek pre {
    margin: 8px 0 0; padding: 14px 16px;
    background: var(--paper-2); border: 1px solid var(--line); border-radius: 12px;
    white-space: pre-wrap; word-break: break-word;
    font-family: var(--mono); font-size: 11.5px; line-height: 1.55; color: var(--ink-soft);
  }

  .cd-lead { margin: 0 0 16px; color: var(--ink-soft); font-size: 0.95rem; line-height: 1.5; }
  .cd-note { margin: 16px 0 0; color: var(--ink-faint); font-size: 0.84rem; line-height: 1.5; }

  .cd-url {
    display: flex; align-items: center; gap: 10px;
    background: var(--paper-2); border: 1px solid var(--line); border-radius: 12px;
    padding: 12px 12px 12px 15px;
  }
  .cd-url code { font-family: var(--mono); font-size: 12.5px; flex: 1; word-break: break-all; }

  .cd-block { position: relative; }
  .cd-block pre {
    margin: 0; padding: 13px 15px;
    background: var(--paper-2); border: 1px solid var(--line); border-radius: 12px;
    white-space: pre-wrap; word-break: break-word;
    font-family: var(--mono); font-size: 11.5px; line-height: 1.55; color: var(--ink);
  }
  .cd-copy {
    border: 1px solid var(--line); background: var(--paper); color: var(--ink);
    border-radius: 999px; padding: 5px 13px; font-size: 11.5px; font-weight: 600; cursor: pointer;
    white-space: nowrap;
  }
  .cd-block .cd-copy { position: absolute; top: 9px; right: 9px; }
  .cd-copy:hover { border-color: var(--line-2); }

  .cd-apps { list-style: none; margin: 18px 0 0; padding: 0; display: grid; gap: 16px; }
  .cd-app-head { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; margin-bottom: 7px; }
  .cd-app-head b { font-size: 14.5px; }
  .cd-how { font-size: 11.5px; color: var(--ink-soft); }
  .cd-app-head a { font-size: 11.5px; color: var(--accent); text-decoration: none; margin-left: auto; }
  .cd-app-head a:hover { text-decoration: underline; }
  .cd-file {
    display: block; margin-bottom: 5px;
    font-family: var(--mono); font-size: 11px; color: var(--ink-faint);
  }

  @media (max-width: 560px) {
    .cd-card { padding: 26px 20px 24px; border-radius: 20px; }
    .cd-app-head a { margin-left: 0; }
    .cd-tab { padding: 10px 8px; font-size: 13px; }
  }
</style>
