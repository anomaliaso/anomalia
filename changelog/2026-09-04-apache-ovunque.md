# Una licenza sola: Apache-2.0

Il repository era diviso: `LICENSE`, README e badge dicevano Apache-2.0, mentre `cli/` — CLI,
server MCP, skill e plugin — era AGPL-3.0. Lo split era voluto e documentato. Non lo è più.

## Perché

L'AGPL ha senso su software che gira **come servizio**: la clausola di rete obbliga chi lo ospita
a rilasciare le proprie modifiche. Ma `cli/` non è un servizio: è il **client**. È la cosa che un
cliente installa nel proprio Claude Code, dentro il proprio ambiente, accanto al proprio codice.

Su un client l'AGPL è attrito. Chi valuta se adottarlo deve passare da un ufficio legale, e molti
si fermano lì — motivo per cui quasi tutti i client MCP escono sotto MIT o Apache-2.0.

E l'attrito va contro la direzione del prodotto: Anomalia sta diventando l'infrastruttura che
**qualunque** AI esterna può usare, il più facilmente possibile. Il fossato non è il codice del
client — è il rendering, la pubblicazione, il rispetto delle regole delle piattaforme e le
misure, che stanno dalla parte del server e non cambiano licenza.

## Cosa è cambiato

`cli/LICENSE` (ora copia di quello di radice), `cli/package.json`, i due manifest del plugin
(`.claude-plugin` e `.codex-plugin`), il manifest del marketplace, la formula Homebrew, le due
skill, `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `cli/README.md` e `static/llms.txt`.

Il mirror `cli/plugins/anomalia/skills/` è stato **rigenerato** con `sync-plugin-skill.sh`, non
modificato a mano: è la copia byte-identica che `plugin-skill.test.ts` sorveglia.

Dopo: zero occorrenze di `AGPL` o `Affero` nel repository.
