# La storia si ancora a un fatto e anonimizza chi l'ha vissuto

Il percorso completo, misurato sull'agente vero contro il database vero, non su
`planStrategy` diretto: la sonda `npm run eval:agent` apre un brand usa e getta,
lo fa lavorare e scrive cosa ha chiamato, cosa ha cercato e con quale fonte.

**Prima aveva ragione chi diceva che era inventato.** L'agente scriveva tre episodi
riempiendo il campo della fonte con «Linee guida CNOPD», «Procedure SPID AgID»:
citazioni autorevoli, zero ricerche, nessun URL. Peggio del campo vuoto — prima non
sapevamo, dopo sembrava che sapessimo. Una regola di prompt non può creare una fonte.

Adesso ogni pagina che la ricerca restituisce finisce in un insieme di URL per giro, e
il gate di fattibilità — su check, su repair e su finish — rifiuta una storia la cui
fonte non nomina niente che sia stato letto in quel giro. Il confronto è sull'URL: un
titolo si parafrasa, un indirizzo no. Dove la ricerca non esiste (percorso senza
agente) la fonte si pretende comunque ma la provenienza non si verifica: fingere il
contrario sarebbe un gate che mente.

**E la fonte è provenienza, non cast.** L'episodio verificato veniva da un fatto di
cronaca su una persona identificabile. Il gate garantisce che sia ancorato, non che ci
sia il permesso di raccontarlo: la regola 8 tiene la situazione e butta l'identità —
protagonista è il personaggio ricorrente della serie, gli altri sono il loro ruolo, e
città, datore di lavoro, data e testata restano nel campo provenienza, che si legge
prima di approvare e non si pubblica mai. Non è un gate, ed è giusto dirlo: un
rilevatore di nomi propri sbaglierebbe su ogni toponimo e verrebbe ignorato in una
settimana.

**Tre difetti trovati facendo girare l'agente**, tutti invisibili alla suite:

- La sonda stessa mentiva. `persistAgentRun` scrive senza attendere, quindi leggere
  `agent_runs` subito dopo non trovava niente e il rapporto annunciava «0 chiamate»
  di un agente che aveva lavorato — due volte l'ho riportato come «zero ricerche».
  Ora aspetta la riga, e senza riga scrive NON MISURATE.
- Descrivere `beats` nei tool dell'agente e tacere sugli altri venti campi ha
  insegnato al modello che solo le battute contavano: rimandava seed senza angolo,
  pillar, giorno e ora. I seed rimandati ora si FONDONO su quelli in bozza.
- La ricerca cercava il tema e non il racconto («quali problemi ci sono con X»
  restituisce una guida, e infatti raccontava una guida). Il protocollo ora mostra la
  differenza: chiedi come l'avrebbe scritto la persona.

Dopo: la ricerca chiede «esperienza ritiro pacco posta nome diverso testimonianza
forum», trova un fatto documentato, e l'episodio esce con i pensieri giusti — «Adesso
guarda il nome», «Non farlo a voce alta» — e il costo nominato: tre quarti d'ora persi
e il pacco ancora in giacenza.
