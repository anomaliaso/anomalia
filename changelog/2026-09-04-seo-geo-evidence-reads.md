# Le prove SEO/GEO si leggono, non si rifanno

Passo 6 del piano agenti esterni: un agente esterno deve poter usare i risultati
SEO/GEO senza rifare la ricerca. Tre letture nuove, tutte `GET`, tutte sotto
`/api/v1/brands/:slug/evidence/`:

- `list_evidence_runs` — l'indice delle run di audit, dalla più recente;
- `get_evidence_run` — una run com'è stata registrata, con le sue sonde di
  citazione paginate;
- `list_evidence_artifacts` — i fix generati **con il corpo per intero**.

## Quali buchi erano veri, e quali no

Il piano ne indicava tre. Verificati contro `getSeo` / `getGeo`
(`src/lib/server/cli-queries.ts`) e contro le pagine `app/[brand]/{seo,geo}`:

**Storia — buco vero.** `getSeo` pesca 12 righe di `brand_geo_audits` ma ne
restituisce **una** (`pickAudit`) più le metriche aggregate; `getGeo` ne pesca 8
e restituisce l'ultima più un `trend` di due numeri per riga (`techScore`,
`shareOfVoice`, `at`). Nessuna delle due espone l'**id** della run: senza id una
run passata non è indirizzabile, quindi non è leggibile. `list_evidence_runs` è
l'indice che rende la storia indirizzabile, `get_evidence_run` la apre.

**Citazioni — buco solo a metà, e lo dico.** `GET /geo` restituisce già
`audit.citations` **dell'ultima run**: motore, prompt, verdetto, rank,
competitor, sorgenti ci sono. Quello che mancava è (a) le citazioni di una run
**precedente**, (b) una forma dichiarata invece di jsonb grezzo — la doc
descriveva `{source, text}`, che non è la forma reale — e (c) l'istante: il
timestamp è della run, non della riga, e una riga citata fuori contesto perdeva
la data. `get_evidence_run` porta `observed_at` su **ogni** citazione. Non ho
aggiunto un secondo modo di leggere l'ultima run: `GET /geo` resta quello.

**Fix generati — buco vero, il più grosso.** `getSeo` e `getGeo` selezionano
`id, kind, title, format, target_path, source_finding` da
`brand_geo_artifacts`: **mai `body`**. Le pagine web sì (`body, blocks`). Un
agente vedeva che un fix esiste e non poteva leggerlo — cioè doveva rifarlo, che
è esattamente quello che questo passo esiste per evitare.

**Un buco che non chiudo, e non è chiudibile con una lettura.** Il piano dice
«citation URLs». Le sorgenti salvate sono **hostname**, non URL: `geo.ts` fa
`domainOf(c.uri)` in raccolta e l'URI intero non arriva mai al database. Il campo
si chiama `source_domains` proprio per non far credere il contrario. Riportare
l'URL completo vuol dire cambiare la raccolta — una scrittura, un'altra PR.

## Decisioni

**Le prove escono come sono state salvate.** `tech`, `search`, `backlinks`,
`ai_overview` passano intatti (`z.record(...).nullable()` nel contratto). Nessun
rimodellamento: reinterpretare un'osservazione qui sarebbe editorializzare una
prova, ed è la regola che il piano chiama «immutable evidence». Le citazioni
sono l'unica eccezione, mappate a snake_case perché devono guadagnare
`observed_at`, che nella riga salvata non c'è.

**Solo `GET`.** Non è una promessa: è una proprietà. Nessuna delle tre rotte ha
un `POST`, nessuna importa `gateAiAction`, `gateCredits` o `structured`, e tre
test con spie lo tengono fermo.

**Nessun `failures` dichiarato.** Una run che non esiste — o che è di un altro
brand — risponde `run: null`, non 404: una regola sola invece di due. Gli unici
errori sono quelli di auth (che arrivano dal contratto esistente) e
`invalid_input` a 400, come `check_content`.

**Tetti, e sono diversi per endpoint.** Le tre risposte hanno profili di
dimensione diversi, ed è la ragione per cui sono tre endpoint e non uno con un
flag: 24 run al massimo (12 di default — l'indice legge `tech` e `citations` per
contarli, quindi il tetto protegge anche il traffico verso il database), 200
citazioni (50), 10 artefatti (3 — i corpi sono lunghi). Dichiarati nel
contratto, verificati da un test per ciascuno.

## Cosa ho lasciato fuori

- **Filtro `surface` sugli artefatti.** `surface` esce (`seo` per gli asset
  legati a un'iniziativa, `geo` per i fix), ma non si filtra: farlo in SQL vuol
  dire un `like` sul prefisso di `source_finding` con il caso `null` da gestire,
  e filtrare dopo la paginazione darebbe pagine corte. `artifact_id` e `status`
  bastano finché qualcuno non dimostra il contrario.
- **`blocks`.** `body` è già `blocks.map(b => b.content).join('\n\n')`: la
  seconda copia costava contesto e non aggiungeva niente oltre le etichette.
- **Tutto ciò che scrive**: far partire un report, annotare uno snapshot,
  salvare una narrativa cliente. Sono scritture, hanno bisogno del loro design.

## Debito

`surfaceOfArtifact` è il quinto posto in cui si legge il prefisso `seo:` — gli
altri quattro sono `cli-queries.ts` (due volte) e le due pagine. Unificarli è un
riordino a comportamento invariato: va in un commit suo, non mescolato a questo.
