# @anomalia/site-analysis

Leggere un sito. Non interpretarlo.

Da un URL: l'indirizzo vero da cui il sito risponde, l'HTML della home renderizzata, il testo
visibile, fino a sei pagine interne, loghi, colori, font, social, il catalogo se la piattaforma lo
espone, e l'archetipo del sito. **Nessuna chiamata a un modello.**

Il confine lo tiene un test: `packages/no-app-imports.test.ts` fallisce al primo `$lib` o `$env`.

## Perché la lettura sta fuori

La raccolta è la stessa per chiunque: un sito si scarica, si difende dagli stessi trucchi, si
parsa allo stesso modo. Le domande da porre al materiale no.

Un autopilota social vuole colori, font e loghi per generare grafiche. Un prodotto di lead
generation vuole sapere **cosa NON fai** — perché la regola più forte del suo drafter è non
promettere ciò che non esiste — e con quali parole ne parlano i clienti, che non sono quelle del
tuo marketing.

Due lettori, un raccoglitore. Chi legge decide lo schema e paga il modello.

## Uso

```ts
import { crawlSite } from '@anomalia/site-analysis/crawl';

const site = await crawlSite('esempio.com', {
  renderer,              // opzionale: un browser vero per i siti che il fetch non basta a leggere
  onProgress: (step, message) => console.log(step, message)
});
```

`SiteCrawl` porta `url`, `html`, `metadata`, `text`, `pages`, `images`, `logos`, `fonts`,
`cssColors`, `themeColor`, `socialHandles`, `products` + `productSource`, `archetype`,
`announcementPages`, `clientRendered`.

## Il renderer è iniettato, e il default non è un browser

```ts
const renderer: BrowserRenderer = {
  isConfigured: () => Boolean(apiKey),
  content: (url) => headlessBrowser(url)
};
```

Senza, si resta al fetch semplice. **È la trappola di questo package**: le funzioni che accettano
un renderer hanno come default "nessun browser", quindi dimenticarsi di passarlo non produce un
errore — produce pagine vuote sui siti JS e nessuno se ne accorge. Vale per `loadPageHtml`,
`fetchInternalPages` e `crawlSite`.

## Cosa fa per difendersi

- **SSRF**: rifiuta loopback, IP privati, IPv6 interni ed endpoint di metadata cloud. Un URL
  incollato da un utente è un URL ostile.
- **Pagine di blocco**: riconosce le schermate che CloudFront, Cloudflare e Akamai restituiscono
  al posto del sito, così non si analizza un captcha credendolo un brand.
- **Ingresso vero**: un dominio che rimanda altrove senza avere il certificato per sé stesso
  arriverebbe come irraggiungibile; `resolveEntryUrl` trova la destinazione che risponde.
- **Tetti**: 2 MB per pagina, 5 MB per immagine, 6 pagine interne, 10s di timeout.

## Dipendenze opzionali

`@resvg/resvg-js` (SVG→PNG) e `node-vibrant` (colori dalle immagini) entrano per import dinamico
e degradano a null se assenti. **`node-vibrant` non è in `package.json` di nessuno**: oggi
l'estrazione colori dalle immagini non fallisce, semplicemente non avviene.
