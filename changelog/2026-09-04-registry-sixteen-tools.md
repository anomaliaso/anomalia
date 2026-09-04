# Sedici tool MCP smettono di essere scritti a mano

Il registry (`packages/api-contracts/src/`, specchiato in `cli/lib/contracts/`) genera i tool
MCP da una dichiarazione sola; tutto il resto è `server.registerTool(...)` ricopiato a mano, con
il contratto della rotta scritto in tre posti — la rotta, `lib/api.ts`, il tool. Su `dev` erano
**36 generati su 85 tool**: 49 a mano.

Questa PR ne porta su **16**. Restano 33 a mano, e sotto c'è il motivo di ciascuno.

## Cosa è passato

| gruppo | tool |
|---|---|
| letture | `get_analytics`, `get_gtm`, `get_voice`, `list_products` |
| piano editoriale | `propose_plan`, `revise_plan`, `approve_plan`, `discard_plan` |
| SEO/GEO/keywords | `seo_action`, `geo_action`, `refresh_keywords` |
| studio | `update_brand_kit`, `update_voice`, `add_competitor`, `research_competitors`, `sync_history` |

Il criterio è uno: **una sola chiamata, sotto `/brands/:slug/`, e l'input del tool è già il
body (o la query) della rotta**. Dove il tool rimodella qualcosa prima di partire, non passa.

## Cosa è servito aggiungere al registry

Una riga sola: `openWorld?: boolean` in `EndpointShape`, emesso come `openWorldHint: true`.
`research_competitors` e `sync_history` lo dichiaravano a mano e senza quel campo la migrazione
li avrebbe fatti sembrare tool che non escono da Anomalia — una perdita di informazione per il
client, non una migrazione. È lo stesso genere di campo di `destructive`, che c'era già.

`PUT` era già nell'unione dei metodi (PR #220), quindi `update_brand_kit` è passato senza
toccare niente.

## Come è stata provata l'equivalenza

Non a parole: `tools/list` catturato attraverso `handleMcpFetch` prima e dopo, confrontato campo
per campo su tutti e 85 i tool.

```
before 85 after 85
added: []      removed: []
tools with any delta: 16
```

I 16 delta sono **solo** i due dichiarati:

- `additionalProperties: null → false`, perché gli input del registry sono `.strict()`. Un campo
  che nessuno ha dichiarato viene rifiutato invece di essere scartato in silenzio.
- `destructiveHint: false` che compare sulle quattro letture: il generatore lo emette sempre,
  la versione a mano lo ometteva. `readOnlyHint` resta `true`.

Il confronto vive come test, non come nota: `cli/mcp/migrated-writes.test.ts` porta la forma di
ogni tool com'era **prima**, catturata da `tools/list`, e fallisce se un titolo cambia, una
descrizione viene riscritta o un campo sparisce. `cli/mcp/read-tools.test.ts` fa lo stesso per
le letture ed è stato esteso con le quattro nuove.

Un dettaglio: `required` è confrontato ordinato. Il registry mette `slug` in coda, la versione a
mano lo metteva in testa; in JSON Schema `required` è un insieme, e nessun client può osservare
la differenza. Il primo giro del test l'aveva vista, ed era rumore.

## I 33 che restano, e cosa li blocca

| quanti | blocco | tool |
|---|---|---|
| 13 | **l'input del tool non è il body della rotta**: il tool aggiunge una costante (`kind: 'real'`, `action: 'generate'`) o rinomina un campo (`week` → `week_index`). Dichiararla nel registry vorrebbe dire farla comparire fra le properties del tool — cioè cambiare la forma pubblica, che è esattamente ciò che una migrazione non deve fare | `add_note`, `add_person`, `generate_person`, `set_colors`, `save_brief`, `replan_week`, `plan_week`, `generate_article`, `optimize_article`, `publish_article`, `unpublish_article`, `delete_article`, `ads_action` |
| 4 | stesso blocco, su `/posts/:id/media`: quattro tool diversi che si distinguono solo per il letterale `action` | `regenerate_post_media`, `regenerate_slide`, `reorder_slides`, `make_video` |
| 4 | **distruttivi sul mondo esterno**: pubblicano davvero su account veri. Sulla carta derivabili, ma la prova che il diff di `tools/list` fornisce riguarda la forma, non l'effetto — e l'effetto qui non si verifica senza pubblicare. `approve_posts` è `approve_post` moltiplicato per tutti i pending, stessa ragione | `approve_post`, `publish_post`, `reject_post`, `approve_posts` |
| 3 | **non sono una chiamata HTTP**: leggono e scrivono `~/.config/anomalia/session.json` | `login`, `logout`, `whoami` |
| 3 | **non sono una chiamata sola**: `get_status` ne fa due e ricompone, `produce_week` risolve prima il draft, `edit_post` rimodella la risposta in `{ok, id, patch}` | `get_status`, `produce_week`, `edit_post` |
| 3 | **il percorso non sta sotto `/brands/:slug/`**, o è il brand stesso: `list_brands` è `/api/v1/brands`, `get_dashboard` è la radice del brand e `pathUnderBrand` è per contratto un sotto-percorso, `chat` non parla JSON su una rotta normale | `list_brands`, `get_dashboard`, `chat` |
| 3 | **`DELETE` con `:id` su una risorsa**: derivabili adesso che il registry sa sostituire un id (PR #218), ma sono un gruppo a sé e vanno in una PR separata | `delete_person`, `delete_competitor`, `delete_document` |

13 + 4 + 4 + 3 + 3 + 3 + 3 = **33**. Con i 16 migrati fa 49, che è il numero da cui si partiva.

I tre `DELETE` sono l'unico gruppo che si scioglierebbe oggi senza inventare niente:
`delete_person` e `delete_competitor` hanno già la loro risorsa in `BRAND_RESOURCES`,
`delete_document` ne vuole una nuova. Sono la PR successiva.

Gli altri no. Il blocco dei 17 che rimodellano l'input non si scioglie con un campo in più: si
scioglierebbe con un meccanismo per dichiarare *costanti di body invisibili all'input schema*,
che è un'astrazione nuova per un caso solo — o meglio, per il caso che quei tool esistano
perché una rotta sola fa cinque cose diverse a seconda di `action`. La cosa giusta lì è
spaccare la rotta, non insegnare al registry a nasconderci dentro un letterale.
