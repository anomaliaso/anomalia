# La battuta ha una metà interna, e la rubrica narrativa smette di sparire

Tre difetti trovati guardando l'output vero, non la suite.

**Un fumetto muto.** Una battuta era una frase sola, e l'episodio usciva come sei
azioni esterne: si vedeva cosa succedeva e non si sapeva niente di chi lo
attraversava. Una battuta è ora un riquadro con due metà — `shows` e `thinks`, la
voce di dentro che il riquadro letterizza come didascalia — più `says` quando
qualcuno parla davvero, con chi lo dice.

Un carosello però o è una **storia** o è una **guida**: pretendere la voce di dentro
su ogni carosello ha prodotto «Basta non farsi prendere dall'ansia» stampato accanto
a un'icona di tessera sanitaria. La regola è per posto, non per riquadro: se una
battuta ha la voce, le hanno tutte; se non ce l'ha nessuna è una guida e va bene.

**La rubrica narrativa spariva ogni settimana.** Il revisore del pass 1.5 declassava
a immagine singola l'unico episodio a fumetti del batch — `A single comedic moment
cannot sustain a 4-slide carousel` — scavalcando in silenzio il formato autoritativo
della rubrica, invariante che ovunque altrove è legge e viene loggata quando cede.
Applicata nella mappa del pass 1, non dopo la revisione: il classico caso di regola
scritta in un posto solo dei due che contano. `applySeedFix` è ora pura, esportata e
sotto test, e chiude su `resolveSeedWithRubrics`.

Il revisore inoltre non **vedeva** la storia: la riga di seed che legge portava
angolo, formato e prodotto, mai le battute. Quindi declassava anche un fumetto
scritto bene. Ora la riga porta `story: battuta → battuta → battuta`, e un carosello
senza storia si ripara **scrivendola** (le battute sono entrate nel suo schema di fix)
invece di buttarla — zero chiamate in più, riusando il pass che c'era già.

**E crashava.** `checkRubricsAndBatchFeasibility` usava `hit` dopo il ramo che ne
gestisce l'assenza: un seed che nomina una rubrica non approvata faceva esplodere il
controllo invece di produrre una violazione.

Quello che NON è risolto e che nessuna di queste cose risolve: le storie restano
inventate. Il meccanismo regge, la fonte no — finché una battuta narrativa non deve
dire da dove viene, il modello scrive la vita di qualcun altro basandosi su ciò che
sembra plausibile, e su una comunità reale «plausibile» significa luogo comune.
