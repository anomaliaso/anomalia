# Una sidebar sola, quella del mockup

Il brand aveva **due** navigazioni dietro `FEATURE_NAV_TEAM`: i macro-hub (flag OFF) e
«La squadra» (flag ON). Il mockup non è nessuna delle due, e disegnarlo come terzo ramo
avrebbe lasciato due sidebar che nessuno guarda più e che continuano a costare a ogni
rename di rotta. Ne resta una.

## Gli Spazi

Home, Materiali, Strategia, Calendario, Risultati — nell'ordine del mockup.

**«Panoramica» non è più una voce.** Era `/workbench`, la vista che riassume le altre: cioè
esattamente quello che fa la home. La sua riga isolata in cima, col divider sotto, era il
primo elemento della barra e diceva due volte la stessa cosa. `/workbench` resta la rotta a
cui `/app/<slug>` rimanda, e sta fra gli `also` della Home, o la voce si spegnerebbe appena
atterrati.

**Home ha `path: ''`.** È l'unica voce senza segmento, e ha richiesto una riga in più nel
layout: `isSubActive(base)` è vero su *ogni* pagina del brand, quindi per la home conta solo
l'uguaglianza esatta.

Strategia esce dagli `also` del Calendario e diventa una voce sua (con `/gtm` e `/plan`
sotto). Risultati è `/analytics`, che era negli Strumenti.

## «Web» si sdoppia

Diventa **SEO/GEO** e **Auto blog**. La ripartizione delle rotte che accendono le due voci:

| Voce | Rotta | `also` |
|---|---|---|
| SEO/GEO | `/seo` | `/web`, `/seo-geo`, `/geo`, `/citations` |
| Auto blog | `/site` | — (`/site/new` e `/site/edit/<id>` si accendono da sole, sono figlie) |

`/geo` è **l'unica destinazione dell'inventario che perde la riga propria**. Resta una rotta
vera: si apre da dentro SEO/GEO e da ⌘K, che dopo la rimozione della modal elenca ogni pagina
del brand che sta su disco. Il test lo dice a voce alta — c'è una lista `SENZA_RIGA_PROPRIA`
con una riga sola e il motivo scritto accanto — invece di lasciarlo scoprire a chi cerca GEO
e non lo trova.

`/keywords` e `/backlinks` **non** sono finite dentro SEO/GEO: sono pagine con un lavoro
proprio, e nasconderle dietro una voce che si chiama come un'altra cosa è come perderle.

## Le impostazioni che se ne vanno

- **`settings/usage`** (con `usage/sessions/<id>`): cancellata. Nessuno la linkava — verificato
  con `git grep` prima di toccarla, che è il modo in cui i tre 404 di oggi si sarebbero evitati.
- **`settings/publishing`**: cancellata. Era di sola lettura, zero azioni di scrittura.
  `publishing-settings.ts` resta: lo leggono l'endpoint `/api/v1/brands/:slug/publishing` e lo
  scheduler.
- **`settings/connectors`**: tolta dalla navigazione, **pagina non cancellata**. Il motivo è
  scritto nella PR: quella pagina non è solo Composio. Gestisce anche i **webhook in uscita**
  (`brand_webhooks`, con segreto e rotazione) e i **trigger**, che non hanno nessun'altra
  superficie nel browser. Cancellarla toglierebbe l'unico modo di configurare l'endpoint di un
  brand, e non è quello che è stato chiesto.

## Via l'ingresso a `/v2`

La voce «New interface · preview» in coda alla sidebar. `/v2` si cancella: un link verso una
rotta che sta per sparire è un 404 in attesa.
