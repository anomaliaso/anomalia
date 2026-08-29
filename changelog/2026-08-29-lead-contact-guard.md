# Lead contact guard — soppressione globale e frequency cap

Prima: il radar proponeva commenti e DM senza alcuna memoria di chi era già stato
contattato, da questo o da qualsiasi altro brand dell'istanza. Nessun canale di
opt-out, nessun limite di frequenza: il secondo tocco alla stessa persona dipendeva
solo dalla sorte.

Ora: un gate unico (`lead-contact.ts`) interrogato in tre punti.

1. Al drafting (`radarEngage`): se l'autore ha soppresso o ha già ricevuto il suo
   tocco (status `posted` o `done_at` valorizzato, su qualunque brand), l'item
   salta con `skip_reason` esplicito.
2. Alla rilettura dei thread (outcome check): un segnale di opt-out nel thread
   sopprime l'autore (best-effort — vede solo quella lettura).
3. Manuale: nuovo pulsante "Non contattare mai più" in `/leads` → soppressione
   globale + dismiss.

Decisioni prese e scartate:

- La riga opt-out va SOLO nei DM (`dmWithOptOut`, garanzia server-side via marker
  "stop"), non nei commenti: non leggiamo le risposte ai commenti in modo
  affidabile, una riga opt-out lì sarebbe teatro. Nei commenti la protezione è il
  tappo one-touch.
- Soppressione globale (tabella senza brand_id, RLS senza policy, service-role
  only), non per brand: l'opposizione è della persona, non del cliente. È anche la
  difesa del processor che sa e comunque consentirebbe.
- L'impronta dell'autore (`author_handle`/`author_platform`) si scrive al momento
  dell'engage: i lead passati non hanno l'impronta e restano fuori dal tappo —
  onesto e dichiarato.
- Il setaccio opt-out è stretto di proposito (verbo di contatto accanto al
  segnale): "stop wasting time" non è un opt-out.
