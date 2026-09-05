# Le prove SEO/GEO si leggono, non si rifanno

Passo 6 del piano agenti esterni: un agente esterno deve poter usare i risultati
SEO/GEO senza rifare la ricerca. Quattro letture nuove, tutte `GET`, tutte sotto
`/api/v1/brands/:slug/web/`:

- `list_web_audits` (`/web/audits`) — l'indice degli audit, dal più recente;
- `get_audit_findings` (`/web/audits/findings`) — un audit com'è stato
  registrato;
- `list_audit_citations` (`/web/audits/citations`) — le sonde di citazione di
  quell'audit, paginate;
- `list_web_fixes` (`/web/fixes`) — i fix generati **con il corpo per intero**.

**I nomi.** La prima stesura le chiamava `/evidence/{runs,run,artifacts}`:
«evidence» è la nostra parola per la pista di audit, non quello che un agente
esterno sta cercando, e «run» e «artifact» non dicono né sito né fix. Stanno
sotto `/web` perché è lì che vive la superficie che descrivono. La run singola è
diventata due letture perché restituiva due cose di forma e dimensione diverse:
le osservazioni sono un oggetto, le sonde una lista paginata.

## Quali buchi erano veri, e quali no

Il piano ne indicava tre. Verificati contro `getSeo` / `getGeo`
(`src/lib/server/cli-queries.ts`) e contro le pagine `app/[brand]/{seo,geo}`:

**Storia — buco vero.** `getSeo` pesca 12 righe di `brand_geo_audits` ma ne
restituisce **una** (`pickAudit`) più le metriche aggregate; `getGeo` ne pesca 8
e restituisce l'ultima più un `trend` di due numeri per riga (`techScore`,
`shareOfVoice`, `at`). Nessuna delle due espone l'**id** della run: senza id una
run passata non è indirizzabile, quindi non è leggibile. `list_web_audits` è
l'indice che rende la storia indirizzabile, `get_audit_findings` la apre.

**Citazioni — buco solo a metà, e lo dico.** `GET /geo` restituisce già
`audit.citations` **dell'ultima run**: motore, prompt, verdetto, rank,
competitor, sorgenti ci sono. Quello che mancava è (a) le citazioni di una run
**precedente**, (b) una forma dichiarata invece di jsonb grezzo — la doc
descriveva `{source, text}`, che non è la forma reale — e (c) l'istante: il
timestamp è della run, non della riga, e una riga citata fuori contesto perdeva
la data. `list_audit_citations` porta `observed_at` su **ogni** citazione. Non
ho aggiunto un secondo modo di leggere l'ultima run: `GET /geo` resta quello.

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

**Solo `GET`.** Non è una promessa: è una proprietà. Nessuna delle quattro rotte
ha un `POST`, nessuna importa `gateAiAction`, `gateCredits` o `structured`, e i
test con le spie lo tengono fermo.

**Nessun `failures` dichiarato.** Un audit che non esiste — o che è di un altro
brand — risponde `audit: null`, non 404: una regola sola invece di due. Gli
unici errori sono quelli di auth (che arrivano dal contratto esistente) e
`invalid_input` a 400, come `check_content`.

**Tetti, e sono diversi per endpoint.** Le risposte hanno profili di dimensione
diversi, ed è la ragione per cui sono endpoint separati e non uno con un flag:
24 audit al massimo (12 di default — l'indice legge `tech` e `citations` per
contarli, quindi il tetto protegge anche il traffico verso il database), 200
citazioni (50), 10 fix (3 — i corpi sono lunghi). Dichiarati nel contratto,
verificati da un test per ciascuno.

## Cosa ho lasciato fuori

- **Filtro `surface` sui fix.** `surface` esce (`seo` per gli asset legati a
  un'iniziativa, `geo` per i fix di citabilità), ma non si filtra: farlo in SQL
  vuol dire un `like` sul prefisso di `source_finding` con il caso `null` da
  gestire, e filtrare dopo la paginazione darebbe pagine corte. `fix_id` e
  `status` bastano finché qualcuno non dimostra il contrario.
- **`blocks`.** `body` è già `blocks.map(b => b.content).join('\n\n')`: la
  seconda copia costava contesto e non aggiungeva niente oltre le etichette.
- **Tutto ciò che scrive**: far partire un report, annotare uno snapshot,
  salvare una narrativa cliente. Sono scritture, hanno bisogno del loro design.

## Debito

`surfaceOfFix` è il quinto posto in cui si legge il prefisso `seo:` — gli
altri quattro sono `cli-queries.ts` (due volte) e le due pagine. Unificarli è un
riordino a comportamento invariato: va in un commit suo, non mescolato a questo.
