# La sidebar scende a sei righe più l'ingranaggio

Home, Materiali, Strategia, Calendario, **News Radar**, Risultati. Un gruppo solo, senza
intestazione: sei voci non hanno bisogno di essere raggruppate.

## «Impostazioni» smette di essere una riga

L'ingranaggio in fondo alla barra c'era già, e aveva già il suo nome accessibile —
`aria-label` e `title` in `DashboardSidebar.svelte`, più lo stato `isNavPending`. La voce di
testo era la seconda porta per la stessa stanza. Tolta quella, l'icona resta quella di prima:
nessun componente nuovo, nessun `iconOnly`, nessuna accessibilità da rifare.

## News Radar sale fra gli Spazi

Era una voce degli Strumenti. È l'unica di quelle che si guarda tutti i giorni, e sta prima di
Risultati come chiesto. L'etichetta è una chiave nuova (`app.nav2.newsRadar`): quella vecchia,
`app.hub.automations.radar`, dice «Internet Radar» / «Radar Internet» e la usa ancora la
pagina `/automations`, che non va rinominata di rimbalzo.

## Il gruppo «Strumenti» non c'è più, e quattordici destinazioni perdono la porta

Questa è la parte da leggere, non da scorrere. Le pagine esistono ancora, hanno un'etichetta e
si aprono da ⌘K — che dopo la rimozione della modal elenca *ogni* pagina del brand su disco — e
dai link degli agenti. Ma **nessuna riga della sidebar ci porta**:

`/leads` · `/site` (Auto blog) · `/seo` (SEO/GEO) · `/keywords` · `/backlinks` ·
`/competitors` · `/campaigns` · `/manual-posting` · `/settings/brand` (lo Studio) ·
`/knowledge` · `/agents` · `/ads/social` · `/ads/google` · `/ads/library`

Due meritano un'occhiata prima di dire di sì: **Auto blog** e **SEO/GEO** erano state chieste
esplicitamente poche ore fa, e sono le prime due a perdere la riga. E **`/agents`** è la pagina
da cui si accendono e spengono i nove lavori ricorrenti — dopo la cancellazione di
`settings/autopilot` è l'unica superficie browser di quel roster.

`NAV_TEAM_TOOLS` è diventato `NAV_OFF_SIDEBAR`, che è quello che adesso è: un elenco che non
disegna più niente ma resta l'inventario — `goTargetLabelKey` ci prende le etichette delle
scorciatoie `g <lettera>`, e il test lo confronta con `HUB_TABS`. Una lista chiamata «Strumenti»
che non disegna strumenti è un commento scaduto sotto forma di codice.

## Il test inchioda entrambe le liste

Sei righe in ordine, e i quattordici path che l'hanno persa. Non giudica: fissa. Aggiungere una
pagina senza toccare nessuna delle due liste fa fallire la suite, che è l'unico modo perché una
destinazione non perda la sua porta in silenzio — ed è la stessa disciplina di `/geo`, che già
sta in `SENZA_RIGA_PROPRIA` col suo motivo.
