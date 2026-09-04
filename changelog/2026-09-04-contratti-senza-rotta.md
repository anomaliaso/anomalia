# Un contratto senza rotta era un tool che rispondeva 404

## Cosa non veniva verificato

`packages/api-contracts/src/index.ts` dichiara `BRAND_ENDPOINTS`. Da quella lista si
generano **da soli** il metodo del client CLI e il tool MCP: aggiungere una entry
basta perche' il tool compaia in `tools/list` e venga offerto a ogni agente esterno.

Niente verificava che dietro a quella entry ci fosse davvero una rotta.

Un contratto scritto senza il suo `+server.ts` — o con un `pathUnderBrand` che non
combacia col percorso del file — produceva un tool perfettamente formato: nome,
titolo, descrizione, schema di input. L'agente lo vedeva, lo sceglieva, lo chiamava,
e prendeva **404**. Nessuno dei guardiani lo intercettava: il typecheck non guarda il
filesystem, i test dei contratti (142, tutti verdi) verificano forma e coerenza degli
schema, la CI esegue entrambi e si dichiara contenta.

Lo stesso valeva per il verbo. Un contratto `POST` su una rotta che esporta solo `GET`
e' la stessa 404, con una diagnosi peggiore: la rotta *esiste*, quindi il sospetto
cade sull'autenticazione o sul brand, non sul registry.

Il rischio cresce con la lista, e cresce in fretta: fra la scrittura di questo test e il
rebase prima della PR, `BRAND_ENDPOINTS` e' passato da 69 a 75 entry — sei aggiunte da
altri agenti in poche ore. E' esattamente il regime in cui una entry senza rotta passa
inosservata fino a quando non la chiama un cliente.

## Il guardiano

`src/routes/api/v1/brands/[slug]/registry.test.ts`, due asserzioni:

1. ogni entry di `BRAND_ENDPOINTS` ha il suo `+server.ts` su disco;
2. quel file esporta il verbo che il contratto dichiara.

Il percorso su disco non e' ricostruito a mano: e' **l'inverso esatto di `pathFor`**.
Si passa alla funzione il nome della cartella dinamica al posto del valore, e l'URL
che torna e' gia' il percorso.

```
pathFor(GET_POST, '[slug]', '[id]')  ->  /api/v1/brands/%5Bslug%5D/posts/%5Bid%5D
decodificato                         ->  /api/v1/brands/[slug]/posts/[id]
+ '/+server.ts'                      ->  src/routes/api/v1/brands/[slug]/posts/[id]/+server.ts
```

Cosi' `RESOURCE_SEGMENT` non compare mai nel test: se domani `:id` diventa altro, il
test segue da solo invece di diventare rosso per il motivo sbagliato.

Il rosso e' stato visto davvero, con tre contratti finti aggiunti e poi tolti:

```
"ghost_report -> src/routes/api/v1/brands/[slug]/ghost/report/+server.ts non esiste"
"ghost_slide -> src/routes/api/v1/brands/[slug]/posts/[id]/slides/+server.ts non esiste"
"doctor_write -> src/routes/api/v1/brands/[slug]/doctor/+server.ts non esporta POST"
```

Il messaggio dice **quale** tool e **quale** percorso, che e' l'unica forma utile:
chi legge la CI non ha il registry davanti.

Su `dev` allo stato attuale passa pulito: nessun endpoint dichiarato oggi e' scoperto.

## Undici test della CLI che non eseguiva nessuno

Stesso difetto della PR #283, altra cartella. `cli/lib/*.test.ts`, `cli/mcp/*.test.ts`
e `cli/plugins/anomalia/plugin-skill.test.ts` — 11 file, 57 test — erano fuori
dall'`include` di vitest. Giravano solo lanciando `bun test` dentro `cli/` a mano.
Fra questi c'e' `cli/lib/contracts.test.ts`, che sorveglia il **mirror** dei contratti
dentro la CLI: il guardiano del disallineamento era a sua volta non sorvegliato.

Sono scritti per `bun:test`, non per vitest. Riscriverli non serve: le due API
coincidono su `describe` / `test` / `it` / `expect`, quindi basta un alias
`'bun:test' -> 'vitest'` nella config di test. Nove file su undici sono passati
subito; gli altri due usavano `import.meta.dir`, che esiste solo in Bun, ed e'
diventato `fileURLToPath(new URL(..., import.meta.url))` — che vale in tutti e due.
`bun test` dentro `cli/` continua a passare identico: 57 test, 0 fail.

## Il limite che resta, ed e' dichiarato

Le dipendenze della CLI **non** sono dichiarate nella `package.json` di root. Sotto
vitest i test risolvono da li', e il quadro e' questo:

| pacchetto | root | `cli/package.json` |
|---|---|---|
| `ora` | assente | `^8.1.1` |
| `cli-table3` | assente | `^0.6.5` |
| `commander` | 4.1.1 (transitiva di `seek-bzip`) | `^12.1.0` |
| `chalk` | 4.1.2 (dev, CJS) | `^5.3.0` |

Oggi non fa danno perche' nessuno degli 11 test arriva a toccarli: `ora` sta nei
`cli/commands/*`, `chalk` e `cli-table3` in `cli/lib/display.ts`, `commander` in
`cli.ts`, e nessuno di quei moduli entra nel grafo dei test. Ma e' un equilibrio
che dipende da **quali file si importano**, non da una garanzia: il primo test che
tocchera' `display.ts` fallira' in CI con un pacchetto mancante, e sembrera' un bug
del test invece che un buco nelle dipendenze.

L'alternativa pulita e' un passo di CI dedicato — `bun install && bun test` dentro
`cli/`, col runtime per cui quei test sono scritti e con le versioni giuste. E' una
modifica a `.github/workflows/ci.yml` e richiede anche un lockfile committato per
`cli/`, che oggi non c'e'. Resta proposta, non fatta: eseguirli con le versioni
sbagliate e' comunque meglio che non eseguirli, ma non e' il traguardo.
