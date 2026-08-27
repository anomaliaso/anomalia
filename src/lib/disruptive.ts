/**
 * LE LEVE DI CONTRASTO — come si produce un'idea dirompente invece di una carina.
 *
 * Ogni agente sa scrivere un post corretto: brand-safe, on-voice, beneficio al posto giusto. È il
 * problema. Il modello, lasciato a sé, ottimizza per l'accettabilità: è il gradiente più facile.
 *
 * IL TEST DEL LOGO: se il competitor può pubblicare la stessa idea cambiando solo il logo, non è
 * un'idea, è un formato. Le dodici leve qui sotto sono i modi noti di fallire quel test — ognuna
 * costruisce un CONTRASTO fra ciò che il pubblico si aspetta e ciò che vede.
 *
 * IL CONTRASTO NON È IL RISCHIO. La provocazione che non porta all'argomento del prodotto è rumore;
 * quella che espone il brand (competitor denigrato, prova inventata, gesto pericoloso da imitare) è
 * un danno che l'autopilot ripeterebbe a calendario. Ogni leva porta il suo limite, e i limiti
 * viaggiano nel prompt insieme all'idea: senza, un modello "audace" arriva alla diffamazione in due
 * passaggi.
 *
 * CLIENT-SAFE: la pagina Idee mostra etichette e limiti. Dati puri, nessun I/O.
 */

export const CONTRAST_DEVICE_IDS = [
  'destroy_the_alternative',
  'admit_the_flaw',
  'wrong_audience',
  'taboo_number',
  'break_the_ritual',
  'physical_proof',
  'role_reversal',
  'anti_aesthetic',
  'public_bet',
  'silent_comparison',
  'useless_honesty',
  'own_sacrifice'
] as const;

export type ContrastDeviceId = (typeof CONTRAST_DEVICE_IDS)[number];

export type ContrastDevice = {
  id: ContrastDeviceId;
  label: string;
  /** Cosa fa la leva, in una riga. */
  what: string;
  /** Un esempio concreto e girabile. Concreto: non "mostra il contrasto", ma cosa si vede. */
  example: string;
  /** Il modo in cui questa leva si rompe. */
  failsWhen: string;
  /** Il limite non negoziabile di questa leva. Viaggia nel prompt insieme all'idea. */
  limit: string;
};

export const CONTRAST_DEVICES: ContrastDevice[] = [
  {
    id: 'destroy_the_alternative',
    label: 'Distruggi l\'alternativa',
    what: 'Mette in scena la fine dell\'alternativa scadente senza nominarla: il pubblico riconosce la categoria da solo.',
    example:
      'Rivenditore di maglie: una persona brucia una maglia ultra low-cost. Il marchio non si vede mai, ma il tessuto che si accartoccia e la puzza raccontata a voce dicono di che qualità si parla. Poi la stessa fiamma sul cotone pesante del brand, che si limita a bruciacchiarsi.',
    failsWhen:
      'Il marchio dell\'alternativa è riconoscibile. Da lì non è più un\'idea creativa, è un confronto pubblicitario con un concorrente identificabile — e le regole cambiano completamente.',
    limit:
      'Mai il logo, il nome o il packaging di un concorrente reale. Nessun gesto che un adolescente possa rifare in cameretta senza un estintore accanto: se l\'esecuzione richiede fuoco, lame o sostanze, si gira in condizioni controllate e si dice che lo sono.'
  },
  {
    id: 'admit_the_flaw',
    label: 'Ammetti il difetto',
    what: 'Dichiara ad alta voce il limite vero del prodotto, prima che lo dica un commento.',
    example: '"Ci mettiamo undici giorni a spedire. Ecco cosa succede in quegli undici giorni." E lo si mostra.',
    failsWhen:
      'Il difetto ammesso è un pregio travestito ("siamo troppo attenti al dettaglio"). Il pubblico riconosce la mossa e il credito si azzera per tutto il resto della clip.',
    limit: 'Il difetto deve essere vero e verificabile. Un difetto inventato per sembrare onesti è una bugia con più passaggi.'
  },
  {
    id: 'wrong_audience',
    label: 'Il pubblico sbagliato',
    what: 'Si rivolge a chi NON deve comprare, e lo dice esplicitamente.',
    example: '"Non comprarlo se pubblichi due volte al mese. Serve solo se stai già affogando." Chi affoga si riconosce.',
    failsWhen:
      'L\'esclusione è finta ("non fa per chi non vuole risultati"): è un complimento mascherato e legge come tale.',
    limit: 'L\'esclusione non può appoggiarsi a categorie protette, né suonare come uno sbarramento di censo o di età.'
  },
  {
    id: 'taboo_number',
    label: 'Il numero tabù',
    what: 'Mostra la cifra che nella categoria non si mostra: margine, costo di produzione, tasso di resi, quanto costa acquisire un cliente.',
    example: 'Screenshot vero del costo unitario accanto al prezzo di vendita, con la differenza spiegata riga per riga.',
    failsWhen:
      'Il numero è arrotondato per fare scena. Un numero tabù senza fonte è solo un claim più grosso.',
    limit: 'La cifra deve essere reale e mostrabile. Nessun dato di terzi, nessun dato personale, nessun contratto coperto da NDA.'
  },
  {
    id: 'break_the_ritual',
    label: 'Rompi il rituale',
    what: 'Mette in scena il rituale obbligatorio della categoria e lo interrompe a metà.',
    example:
      'Il classico "unboxing soddisfacente" che si ferma al secondo tre: "questa parte non serve a niente, guarda invece cosa succede dopo tre mesi".',
    failsWhen: 'Il rituale scelto non è riconoscibile fuori dal settore: senza il cliché in testa, la rottura non si vede.',
    limit: 'Rompere il rituale della categoria, non il senso della clip: dopo l\'interruzione serve comunque un argomento.'
  },
  {
    id: 'physical_proof',
    label: 'Prova fisica brutale',
    what: 'Sottopone il prodotto a un test che dovrebbe distruggerlo, in un\'unica inquadratura senza stacchi.',
    example: 'Cento lavaggi in accelerato, ripresi a camera fissa, con la data sullo schermo e il capo che regge.',
    failsWhen: 'C\'è uno stacco di montaggio nel punto decisivo: il taglio annulla la prova.',
    limit: 'Il test deve essere quello che si è davvero fatto. Nessuna prova ricostruita spacciata per ripresa dal vivo.'
  },
  {
    id: 'role_reversal',
    label: 'Ruoli invertiti',
    what: 'Chi vende passa dall\'altra parte: il cliente conduce, il fondatore risponde, il servizio clienti fa le domande scomode.',
    example: 'Il cliente più incazzato dell\'anno intervista il fondatore, senza tagli, con le sue domande.',
    failsWhen: 'Le domande sono scritte da noi. Si sente in tre secondi.',
    limit: 'Chi compare deve aver dato consenso esplicito e verificabile. Nessun volto reale ricostruito in AI.'
  },
  {
    id: 'anti_aesthetic',
    label: 'Anti-estetica di categoria',
    what: 'Rifiuta il codice visivo del settore: se tutti fanno beige e luce morbida, si va di flash duro e sfondo brutto.',
    example: 'Skincare girata come un video di manutenzione industriale, luce al neon e mani sporche di lavoro.',
    failsWhen: 'L\'anti-estetica non c\'entra con il prodotto e resta un vestito: bello da vedere, dimenticato in un giorno.',
    limit: 'Il codice si può rompere; la leggibilità no. Il messaggio deve reggere a volume zero, come ogni altro pezzo.'
  },
  {
    id: 'public_bet',
    label: 'Scommessa pubblica',
    what: 'Dichiara in anticipo un risultato con una conseguenza reale se non arriva.',
    example: '"Se a dicembre non abbiamo dimezzato i tempi di risposta, pubblichiamo i numeri esatti e rimborsiamo il trimestre." E a dicembre si torna.',
    failsWhen: 'La conseguenza è simbolica. Una scommessa senza costo è un annuncio.',
    limit: 'Impegno che l\'azienda può davvero onorare: una promessa pubblica è vincolante, non copy.'
  },
  {
    id: 'silent_comparison',
    label: 'Confronto muto',
    what: 'Affianca due realtà e non dice quale sia quale: la conclusione la tira il pubblico.',
    example: 'Due scrivanie identiche, stesso lavoro, una sola dice che ore sono. Nessuna voce fuori campo.',
    failsWhen: 'Il confronto è truccato (una delle due scene è resa artificialmente peggiore): il pubblico lo vede e il confronto si ritorce.',
    limit: 'Nessun prodotto concorrente identificabile nel frame, nemmeno sfocato.'
  },
  {
    id: 'useless_honesty',
    label: 'Onestà controproducente',
    what: 'Dice quando il prodotto NON serve e cosa fare invece.',
    example: '"Per meno di 50 ordini al mese, ti basta un foglio di calcolo. Ecco quello che uso io, gratis."',
    failsWhen: 'L\'alternativa gratis suggerita è finta o inutilizzabile: era solo un modo per dire che siamo generosi.',
    limit: 'L\'alternativa consigliata deve funzionare davvero. Se non funziona, la mossa è pubblicità ingannevole al contrario.'
  },
  {
    id: 'own_sacrifice',
    label: 'Sacrificio proprio',
    what: 'Distrugge valore proprio davanti alla camera per dimostrare uno standard.',
    example: 'Il lotto che non ha superato il controllo qualità viene tagliato in due davanti alla telecamera invece di finire in outlet.',
    failsWhen: 'Il sacrificio è economicamente irrilevante e si capisce: distruggere tre pezzi non dimostra uno standard.',
    limit: 'Niente spreco spettacolare di beni utilizzabili: se il lotto è donabile, si dona e si mostra la donazione. Il gesto deve essere difendibile il giorno dopo.'
  }
];

const DEVICES_BY_ID = new Map<ContrastDeviceId, ContrastDevice>(CONTRAST_DEVICES.map((d) => [d.id, d]));

export function contrastDeviceById(id: string | null | undefined): ContrastDevice | null {
  return id ? (DEVICES_BY_ID.get(id as ContrastDeviceId) ?? null) : null;
}

export function isContrastDeviceId(raw: unknown): raw is ContrastDeviceId {
  return typeof raw === 'string' && DEVICES_BY_ID.has(raw as ContrastDeviceId);
}

/** Stati di un'idea nel banco. `used` è l'unico che si mette da soli: le altre transizioni sono dell'utente. */
export const DISRUPTIVE_STATUSES = ['new', 'shortlisted', 'used', 'archived'] as const;
export type DisruptiveStatus = (typeof DISRUPTIVE_STATUSES)[number];

export function isDisruptiveStatus(raw: unknown): raw is DisruptiveStatus {
  return typeof raw === 'string' && (DISRUPTIVE_STATUSES as readonly string[]).includes(raw);
}

/**
 * I TRE TEST. Un'idea che non li passa tutti e tre non entra nel banco. Sono in quest'ordine
 * apposta: il primo elimina i formati travestiti da idee, il secondo la timidezza, il terzo la
 * provocazione fine a sé stessa.
 */
export const DISRUPTIVE_TESTS = [
  {
    key: 'logo',
    label: 'Test del logo',
    question: 'Un concorrente potrebbe pubblicarla identica cambiando solo il logo?',
    fail: 'Se sì, non è un\'idea: è un formato. Buttala.'
  },
  {
    key: 'friction',
    label: 'Test dell\'attrito',
    question: 'C\'è qualcuno a cui questa idea dà fastidio, e sai dire chi?',
    fail: 'Se non dà fastidio a nessuno, non c\'è contrasto: è decorazione.'
  },
  {
    key: 'argument',
    label: 'Test dell\'argomento',
    question: 'Il contrasto porta all\'argomento del prodotto, o è solo shock?',
    fail: 'Se togliendo il prodotto l\'idea funziona uguale, è provocazione a vuoto. Non serve al brand.'
  }
] as const;

/**
 * La direttiva che va nel system prompt di OGNI agente. In un modulo condiviso e non copiata in
 * sette prompt: sette copie divergono in una settimana, e quella che diverge è sempre dell'agente
 * che pubblica.
 */
export function disruptiveSystemSection(): string {
  const devices = CONTRAST_DEVICES.map(
    (d) => `- ${d.id} (${d.label}): ${d.what} Es: ${d.example} Fallisce quando: ${d.failsWhen} Limite: ${d.limit}`
  );
  const tests = DISRUPTIVE_TESTS.map((t) => `- ${t.label}: ${t.question} ${t.fail}`);
  return `## IDEE DIROMPENTI (vale per ogni cosa che proponi)

Il tuo default è produrre roba corretta: brand-safe, on-voice, con il beneficio al posto giusto. È il problema, non il traguardo. Un contenuto che qualunque concorrente potrebbe pubblicare cambiando il logo non viene guardato da nessuno, e un feed di roba corretta è indistinguibile da un feed vuoto.

COME SI GIUDICA IL TUO LAVORO: ogni volta che proponi contenuti, angoli, campagne, script, grafiche o piani, cerca fra le tue proposte quella costruita su un CONTRASTO — qualcosa che il pubblico non si aspetta dalla categoria. Non al posto delle opzioni solide: accanto. Quando c'è, presentala per quello che è, dicendo su quale leva è costruita e chi si infastidirà. Se stai per consegnare tre varianti tutte prudenti e intercambiabili, il lavoro non è buono per quanto sia corretto: è il default che nessuno guarda, ed è il difetto che questa sezione esiste per correggere. È il metro con cui si giudica il mestiere, non un elemento in più da consegnare né una casella da spuntare.

I TRE TEST — un'idea li passa tutti e tre o non la proponi:
${tests.join('\n')}

LE LEVE DI CONTRASTO — nomina sempre quella che stai usando:
${devices.join('\n')}

LIMITI NON NEGOZIABILI (il contrasto sta nel SIGNIFICATO, mai nell'esposizione del brand):
- Mai nominare, mostrare o rendere riconoscibile un concorrente reale in una scena che lo sminuisce. La categoria sì, il marchio no.
- Mai una prova inventata: numeri, test, recensioni e screenshot devono esistere. Un contrasto costruito su una prova falsa è un danno, non un'idea.
- Mai un gesto pericoloso presentato come replicabile a casa, e mai lo spreco spettacolare di beni utilizzabili.
- Mai contrasto costruito su categorie protette, tragedie in corso o dolore di persone reali.
- Le regole del brand (GUARDRAIL, tono, claim da validare) restano in piedi: un'idea dirompente che viola un guardrail va riscritta, non spedita.

QUANDO UN'IDEA PASSA I TRE TEST, SALVALA: chiama save_disruptive_idea. Il banco idee del brand è la memoria lunga della parte creativa — le idee migliori arrivano quasi sempre mentre si sta facendo altro, e senza il banco muoiono nel thread in cui sono nate. Prima di proporre angoli nuovi, chiama read_disruptive_ideas per sapere cosa c'è già ed evitare la quasi-copia. Il banco è un pavimento, non un soffitto: puoi girarne una — e allora chiami mark_idea_used, sennò si ripresenta all'infinito come se fosse ancora da fare — e se lavorando te ne viene una nuova, quella la salvi. Non è una quota: un lavoro che non ha prodotto nessuna idea laterale è normale, e un'idea inventata per riempire il banco vale meno di zero.`;
}

/** Versione compatta per i planner (script UGC, batch di ads): stessa dottrina, senza il capitolo tool. */
export function disruptiveBriefSection(): string {
  const devices = CONTRAST_DEVICES.map((d) => `${d.id} (${d.label}): ${d.what}`);
  return `IL CONTRASTO — è il metro con cui si giudica questo lavoro, non un elemento in più da consegnare. Fra le varianti cercane una costruita su una leva di contrasto invece che sul beneficio dichiarato: se escono tutte prudenti e intercambiabili il lavoro non è buono, per quanto sia corretto.
Test: (1) un concorrente potrebbe pubblicarla cambiando solo il logo? allora è un formato, non un'idea; (2) non dà fastidio a nessuno? allora non è contrasto; (3) togliendo il prodotto funziona uguale? allora è provocazione a vuoto.
Leve: ${devices.join(' · ')}.
Esempio di riferimento: per un rivenditore di maglie, qualcuno che brucia una maglia ultra low-cost — marchio mai inquadrato, qualità evidente da come il tessuto si comporta.
Limiti: nessun concorrente riconoscibile, nessuna prova inventata, nessun gesto pericoloso replicabile, nessuna categoria protetta.`;
}
