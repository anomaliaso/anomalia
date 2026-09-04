# La home del brand rimandava fuori dal brand

Tolta la chat, `/app/[brand]` non aveva più un corpo: il suo contenuto era il composer montato dal
layout. La #257 l'ha risolta con un `+page.server.ts` che faceva `redirect(302, './workbench')`.

Due difetti, entrambi visibili al primo clic.

## Il percorso relativo esce dal brand

`./workbench` si risolve **contro l'URL corrente**, e `/app/demo` non finisce con la barra: il
fratello di `demo` è `workbench`, quindi la destinazione era `/app/workbench` — una rotta che non
esiste. Ogni voce dell'interfaccia che portava alla home portava lì.

Adesso il percorso è assoluto e costruito dal parametro, quindi non dipende da come è scritto
l'URL di partenza. Lo slug si codifica, e il confronto in ingresso si fa sul percorso decodificato:
`params.brand` arriva decodificato, `url.pathname` no, e confrontarli grezzi avrebbe saltato il
rimando su uno slug con caratteri codificati.

## Il rimando correva contro il layout

`+page.server.ts` e `+layout.server.ts` girano **in parallelo**. Il rimando era sincrono, quindi
la risposta si chiudeva subito; il layout, ancora dentro le sue query, arrivava dopo alla riga che
scrive il cookie dell'ultimo brand e SvelteKit rifiutava:

```
Error: Cannot use `cookies.set(...)` after the response has been generated
    at load (src/routes/app/[brand]/+layout.server.ts:80:13)
```

Non era un difetto del cookie: era il rimando messo in un posto che corre contro chi lo scrive.
Spostandolo in cima al layout, prima di qualunque attesa, la corsa non esiste — e il cookie lo
scrive la richiesta di destinazione, che è dove ha senso scriverlo.

`+page.server.ts` sparisce: una rotta il cui unico compito era rimandare altrove non serve più.
