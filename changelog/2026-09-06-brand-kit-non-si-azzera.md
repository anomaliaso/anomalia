# Correggere la categoria non cancella più quello che il brand dice di sé

`update_brand_kit` promette, nella sua descrizione, *«Only the fields you send change»*. Il
handler faceva il contrario: l'upsert spediva sempre tutte e quattro le colonne del kit con
`about ?? null`, e `ON CONFLICT (brand_id) DO UPDATE` le scriveva tutte. Una chiamata con il solo
`{ category: "bakery" }` metteva NULL su `about`, `target_audience` e `brand_style`.

Quei tre campi sono i fatti da cui è scritto **ogni post generato**. Sparivano senza un errore e
senza una schermata: la risposta era `ok: true`. `brand_colors` si è salvato solo perché non
compariva nel payload — fortuna, non disegno.

Ora il patch si costruisce dalle chiavi **presenti** nel corpo (`'about' in body`), non dal loro
valore: un `null` esplicito continua a cancellare, un campo assente resta com'era. Se il corpo
porta solo `language`, il kit non viene toccato affatto.

`in body` e non `!== undefined` perché sono due domande diverse: la prima chiede se il chiamante
ha nominato il campo, la seconda anche se lo ha nominato con un valore che JSON non sa
trasportare. La distinzione fra «cancellalo» e «lascialo stare» è tutta lì.

Il difetto è emerso rileggendo gli handler delle scritture marcate `destructive: false`, mentre si
verificava se quel flag dice la verità. È l'unico che **cancella** dati che il chiamante non ha
nominato; gli altri sostituiscono cose che le loro descrizioni dichiarano di sostituire.

Tre contraddizioni descrizione/handler restano aperte e non sono toccate qui, perché ognuna è una
decisione a sé:

- **`reschedule_post`** dice *«it only changes when»*, e invece scrive anche `status: 'approved'` e
  azzera `external_post_id` e `published_url`;
- **`propose_plan`** dice *«It lands as a proposal and changes nothing»*, ma porta a `rejected` la
  proposta pendente che c'era (il piano *attivo* è davvero intatto; quello in attesa no —
  `save_plan` e `revise_plan` lo dichiarano, questo no);
- **`plan_week`** dice *«replaces the week draft in review»* e invece inserisce una riga nuova,
  lasciando la vecchia in tabella: vince la più recente, ma la vecchia resta.
