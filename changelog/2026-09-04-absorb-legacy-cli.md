# Il vecchio repo `anomalia-cli` non serve più: c'era una cosa sola da riportare

`andreabuttarelli/anomalia-cli` è il predecessore del monorepo. Serve ancora
`mcp.anomalia.so` tramite il progetto Vercel `anomalia-cli`, e il suo ultimo deploy di
produzione precede di sedici giorni l'importazione in `cli/` — quindi lì gira codice più
vecchio di quello che sta qui. Prima di ricollegare il dominio (azione da dashboard, non
codice: la PR #228 racconta perché) andava stabilito se quel repo custodisse ancora qualcosa.

Censimento dei 103 file tracciati, contro i 111 di `cli/`:

| insieme | quanti | esito |
|---|---|---|
| solo là | 6 | tutti scartati |
| solo qua | 14 | niente da fare |
| in entrambi, diversi | 39 | 38 vince `cli/`, 1 aveva qualcosa in più |

**I 6 file solo là, uno per uno.** `mcp/api/_bundle.js`, `mcp/api/mcp.js`,
`mcp/api/oauth-protected-resource.js` sono l'output di `scripts/build-vercel.mjs` committato:
qui `cli/.gitignore` li ignora e li rigenera il build. `.claude-plugin/marketplace.json` e
`.agents/plugins/marketplace.json` esistono già in questo repo, alla radice del monorepo e con
i path del monorepo — è `cli/plugins/anomalia/plugin-skill.test.ts` a pretenderli lì.
`.github/workflows/release.yml` è il predecessore di `cli-release.yml`, che ne è un
sovrainsieme (stessi step, più il push del formula alla tap e gli artifact dei run manuali).
L'unica cosa che il vecchio ha in più è la guardia che salta `npm publish` quando `NPM_TOKEN`
è vuoto: non è portata di proposito, perché una release che non pubblica in silenzio è peggio
di una che fallisce a voce alta.

**Dei 39 diversi, 38 sono la stessa storia**: URL riscritti da `andreabuttarelli/anomalia-cli`
a `anomaliaso/anomalia`, i tool MCP passati al registry dei contratti, il `consent`
obbligatorio sulle persone reali, `authServerUrl()` corretto da apex a www. Tutto già qui.

**Il trentanovesimo è l'unica cosa da riportare.** `commands/ads.ts` là ha il flag `--remix`,
`mcp/tools/web.ts` là ha il tool `ads_remix`, `lib/api.ts` là ha `adsRemix`. Qui non ci sono
mai stati: `git log -S adsRemix -- cli/` non trova niente, quindi non sono stati tolti — sono
stati aggiunti al vecchio repo *dopo* l'importazione. Ma la rotta esiste qui,
`src/routes/api/v1/brands/[slug]/ads/remix/+server.ts`, è documentata in
`docs/api/08-ads-voice-gtm-misc.md`, e nessun client la sapeva chiamare.

Riportata attraverso il registry (`ADS_REMIX` in `packages/api-contracts/src/ads.ts`), non
ricopiando il tool a mano: il tool MCP esce generato, identico per nome, titolo, descrizione e
campi a quello del vecchio repo, e la CLI chiama `callEndpoint` senza un metodo in più in
`api.ts`. Un campo è stato corretto lungo la strada: il vecchio stampava `b.product`, mentre la
rotta emette `productName` — là la colonna Product era vuota. Il fallback `visual_prompt`
snake_case è sparito per lo stesso motivo, il server non lo emette.

Il GET su `/ads/remix` (rileggere i brief senza rispenderli) è rimasto fuori: nel vecchio repo
`getAdsRemix` esisteva in `api.ts` e non lo chiamava nessuno. Si aggiunge quando serve.

Verificato catturando `tools/list` da `handleMcpFetch` prima e dopo: 82 → 83 tool, l'unico
aggiunto è `ads_remix`, nessuno tolto o rinominato.
