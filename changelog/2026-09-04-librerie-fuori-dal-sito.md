# Le librerie escono dal sito, il materiale resta

Spariscono dal sito pubblico: `/design` e `/design/[slug]`, `/trending`, `/styles` e
`/styles/[slug]`, `/talents` e `/talents/[slug]`, `/playbooks` e `/playbooks/[slug]`.

## LEGGI QUESTO PRIMA DI CANCELLARE QUALCOSA CHE SEMBRA ORFANO

**Il materiale che quelle pagine mostravano non è stato toccato e non va toccato.** Template
di design dei post, libreria di stili, roster dei talent, playbook per settore, cosa sta
funzionando sul wall: è roba accumulata nel tempo, e il posto dove servirà è **dentro il
prodotto — data all'AI del cliente che crea i post, via MCP** — non su una pagina web che il
mondo guarda. È un obiettivo futuro, non di questa PR.

Quindi questi file **non sono morti, sono in attesa**, e vanno lasciati stare anche quando
`git grep` non trova più nessuno che li chiami:

- `src/lib/server/wall.ts` — legge `public_wall` (`listDesignWall`, `listTrendingWall`, `listWallSlugs`, `designTagCounts`)
- `src/lib/wall.ts` — `DESIGN_TAGS`, `WALL_PLATFORMS`, i tipi condivisi
- `src/lib/server/talent.ts` — il roster dei talent
- `src/lib/data/playbooks.ts` — i playbook per professione, scritti a mano
- `src/lib/design/presets/` — la libreria di stili
- `src/lib/components/WallTile.svelte` — la tile che rende una riga del wall; dopo questa PR non la chiama più nessuno
- `src/lib/wall.i18n.test.ts` — continua a tenere le chiavi i18n del wall in tutte e quattro le lingue

Nota: **`wall.ts`, `talent.ts` e `presets/` non erano affatto orfani nemmeno prima.**
`wall.ts` lo leggono già `content-preview/caption-quality.ts`, `content-preview/images.ts`,
`media-generator/ugc-batch.ts`, `ugc-plan-agent.ts` e `motion-video/agent.ts`; `talent.ts` lo
leggono `agent/tools/read-tools.ts`, `design-visual-refs.ts` e `app/[brand]/media-refs`;
`STYLE_PRESETS` lo usa `MediaGeneratorEntityPicker.svelte`. Il materiale **alimenta già** la
pipeline che produce i post. Togliere le pagine non gli leva niente.

Le tabelle: mai toccate.

## I 301

I figli di quelle sezioni erano **righe di database, non rotte** — centinaia di
`/design/<slug>`, più i preset, i talent, i 32 playbook. Un solo `RETIRED_PAGES` per riga
esatta non basta, quindi `seo.ts` ha ora anche `RETIRED_PREFIXES`: `/design/`, `/playbooks/`,
`/styles/`, `/talents/` mandano ogni figlio dove è andata la radice.

| ritirata | va su |
|---|---|
| `/design`, `/design/*`, `/styles`, `/styles/*` | `/autoposts` — è lì che quei design e quegli stili diventano un post |
| `/trending` | `/news-radar` — il radar è il prodotto che quel muro dimostrava |
| `/talents`, `/talents/*`, `/playbooks`, `/playbooks/*` | `/usecases` — "per chi sei tu", che è la domanda a cui rispondevano |

## Sitemap: da 1342 URL a 531

È il numero che dice quanto pesavano: **811 URL su 1342 erano queste cinque famiglie**, quasi
tutti generati per slug × quattro lingue. Rimossi dal generatore `sitemap.xml`: la sezione
playbook (con `PLAYBOOK_SLUGS`, che era una lista di rotte per una rotta che non c'è più — i
playbook veri stanno in `$lib/data/playbooks`), la query `talents`, la query `listWallSlugs`
e le entry `STYLE_PRESETS`. Restano brand blog e agent template, che sono vivi.

## Link interni

Un articolo di `insights.ts` aveva `/playbooks` fra i `relatedPaths` (e `insights.test.ts`
pretende che ogni `relatedPath` sia una pagina in sitemap): ora punta a `/usecases`, e la voce
corrispondente esce dalla mappa di etichette.

Cancellato `src/lib/wall-preview.test.ts`: leggeva il sorgente di `design/[slug]/+page.svelte`
per riga. Testava la **superficie**, non il materiale, e la superficie non c'è più.
