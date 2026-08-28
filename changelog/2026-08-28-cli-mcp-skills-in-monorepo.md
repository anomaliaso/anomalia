# CLI, MCP e skill vivono in questa repo (`cli/`)

La repo pubblica `andreabuttarelli/anomalia-cli` chiude: sorgente di CLI, MCP
server (stdio e HTTP), skill agente, plugin Claude/Codex e formula Homebrew
traslocano in `cli/`, senza copie divergenti da tenere allineate a mano.

La release è un tag `cli-vX.Y.Z` qui: il workflow `cli-release.yml` builda i
binari standalone (macOS/Linux, arm64/x64) + checksum, li attacca alla GitHub
Release, aggiorna la formula Homebrew, la pusha su `anomaliaso/homebrew-tap`
(serve il secret `TAP_TOKEN`) e pubblica `anomalia-cli` su npm (secret
`NPM_TOKEN`). `install.sh`, `anomalia update`, npm e Homebrew cambiano tutti
puntamento alla nuova posizione; i manifest dei marketplace plugin
(`.claude-plugin/`, `.agents/plugins/`) salgono alla root della repo perché
`/plugin marketplace add anomaliaso/anomalia` li trovi lì. La vecchia repo va
archiviata dopo la prima release da qui — prima un ultimo commit che reindirizza
il suo `install.sh` ai nuovi asset, così chi ha già installato non si rompe.
