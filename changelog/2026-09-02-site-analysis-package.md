# La lettura di un sito si separa dalla sua raccolta: `@anomalia/site-analysis`

`brand-analysis.ts` erano 1816 righe che facevano due mestieri: scaricare un sito e
interpretarlo. Il primo è lo stesso per chiunque — un sito si risolve, si difende dagli
stessi trucchi, si parsa allo stesso modo. Il secondo no: un autopilota social vuole
colori e font per generare grafiche, un prodotto di lead generation vuole sapere cosa
NON fai, perché la regola più forte del suo drafter è non promettere ciò che non c'è.

Il confine non l'ho inventato io: stava già scritto nel file, alla riga 1298,
`// --- LLM Analysis ---`. Sopra la raccolta, sotto la lettura. Ho tagliato lì.

Nel package finiscono ~1360 righe: risoluzione dell'ingresso vero, guardia SSRF,
riconoscimento delle pagine che una CDN mette al posto del sito, fallback su browser
reale, scoperta delle pagine interne, cataloghi Shopify e WooCommerce, e l'estrazione di
metadati, loghi, colori, font, social, testo e archetipo. I 40 test esistenti sono
venuti con lui, perché coprivano esattamente questa metà.

Nell'app restano 655 righe, ed è quello che `brand-analysis` è davvero: il lettore.
`analyzeBrand`, lo schema di `BrandProfile`, gli annunci, e `runBrandAnalysis` che ora
compone raccolta e lettura invece di essere entrambe.

## Le inversioni: tre, e due erano trappole

Il client AI e le interfacce `BrowserRenderer`/`EntryProbe` **erano già invertite** nel
codice originale — merito di chi l'ha scritto, non mio. Restavano `slugify` (un solo
uso, copiato), un import di `$env` **mai utilizzato** (rimosso), e Browserless.

Quest'ultimo ha prodotto due regressioni silenziose che il taglio ha creato e che nessun
test avrebbe preso. Rendendo il renderer iniettabile, il suo default diventa "nessun
browser"; ma `loadPageHtml` e `fetchInternalPages` lo prendevano proprio dal default.
Browserless avrebbe smesso di essere usato **senza che niente fallisse**: la home dei
siti JS sarebbe tornata vuota, e le pagine interne pure — mentre il commento di
`fetchInternalPages` promette il contrario a chi legge. Ora il renderer vero si passa
esplicitamente nei tre punti che lo richiedono.

È la stessa famiglia di guasto che ci ha già morso con `radar.ts`: una dipendenza che
sparisce in silenzio e produce zero invece di un errore.

## Il ponte, dichiarato

`brand-analysis.ts` ri-esporta i trenta simboli della raccolta perché **quattordici
moduli** li importano da quell'indirizzo. Cambiarli tutti nello stesso commit di uno
spostamento da 1400 righe l'avrebbe reso irrevisionabile. È un ponte, non una casa: chi
tocca uno di quei moduli lo faccia puntare al package.

## Cosa è nuovo: `crawlSite`

In Anomalia non poteva esistere, perché raccolta e lettura erano un blocco unico.
Restituisce `SiteCrawl` — pagine, metadati, loghi, colori, font, social, catalogo,
archetipo — senza una sola chiamata a un modello. È il punto su cui un secondo prodotto
innesta la propria lettura senza rifare il giro di rete.

## Difetti visti e non toccati

`node-vibrant` è importato dinamicamente ma **non è in `package.json` di nessuno**:
l'estrazione dei colori dalle immagini degrada a null, quindi oggi non fallisce —
semplicemente non avviene, in silenzio. E i tre punti d'ingresso LLM (`analyzeBrand`,
`extractAnnouncements`, `runBrandAnalysis`) restano senza un solo test: i 40 esistenti
coprono la parte pura, che è esattamente quella che se n'è andata nel package.
