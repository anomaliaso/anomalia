# La home apre con quello che ti aspetta

La gerarchia del mockup: **ciò che richiede attenzione sta in cima, con quante sono**; il resto
scende. Era l'unica cosa che `/v2` aveva e `/app` no, ed è il divario più grande rimasto dopo
averla cancellata.

## Cosa c'era prima, al posto suo

Un blocco chiamato `control-hero` con:

- un titolo che dice quanti elementi ci sono da rivedere — quello va bene, e resta la stessa idea;
- **tre gauge ad anello** (percentuale di setup, punteggio SEO, citabilità GEO). Sono ornamento:
  tre cerchi animati che non ti dicono cosa fare. Il setup ha già la sua barra qui sopra, e SEO e
  GEO hanno la loro riga in barra laterale da quando «Web» si è sdoppiata;
- una **coda paginata dei singoli post da approvare** — cinque per pagina, avanti, indietro,
  «mostra tutti», «mostra meno», con quattro `$state` e un `$effect` a tenere in riga il numero
  di pagina. Diceva la stessa cosa della riga «4 contenuti da approvare», con un clic in più e
  una paginazione da mantenere.

Netto: `HomeWorkbench.svelte` passa da **1.759 a 1.356 righe**.

## Cosa c'è adesso

«Da fare», il conteggio di quante sono, e una riga per ciascuna: cosa, dove vive, e un pulsante
che ci porta. Le righe possibili, in quest'ordine:

| Riga | Quando compare | Dove porta |
|---|---|---|
| N post da accettare | `queue.pending > 0` | `/calendar?status=pending_user` |
| N articoli da accettare | `blog.pending > 0` | `/site` |
| N segnali da rivedere | radar **acceso** e `radarReview > 0` | `/radar` |
| N lead in attesa | `leadsPending > 0` | `/leads` |
| Nessun account collegato | `socialAccounts === 0` | `/settings/connected-accounts` |

**L'ordine è la gerarchia, e ha una ragione.** Prima ciò che ha una scadenza vera: un post
approvato in ritardo è un post che non esce. Poi ciò che aspetta senza scadere. Infine il setup,
che non scade mai — ma senza un account collegato l'AI produce e non pubblica, e il brand se ne
accorge quando è tardi.

**Il radar spento non produce una riga.** Offrire «segnali da rivedere» per una funzione che non
gira è peggio che tacere.

## Lo stato vuoto dice perché è vuoto

Non «niente da fare», ma *«Non c'è niente in attesa. Bozze nuove, segnali del radar e lead
compaiono qui appena arrivano.»* Chi arriva a home vuota deve capire se il prodotto sta
lavorando o se è rotto.

## Dove sta la logica

In `$lib/home-todos.ts`, puro e sotto test, come `navFor` per la barra: sceglie **quali** righe e
**in che ordine**, e non contiene una parola di testo — restituisce chiavi i18n e conteggi, e la
pagina traduce. È l'unico pezzo di questo blocco che si può far fallire per la ragione giusta, e
i sei casi coprono l'ordine, il conteggio, il radar spento e la riga senza numero.

## Cosa NON è cambiato

Tutto il resto della pagina: pipeline contenuti, in arrivo, web, analisi. Restano dov'erano e
come erano. Il blocco nuovo dice le stesse cose in forma di lavoro da fare, quindi c'è una
sovrapposizione dichiarata con la sezione «Pipeline contenuti» qui sotto — si scioglie nello
sfoltimento pagina per pagina, non qui.
