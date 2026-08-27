/**
 * GLI OTTO FORMATI UGC — la struttura del clip, non l'apertura (quella è `hook-tactics.ts`).
 * Senza questo il renderer montava SEMPRE lo stesso arco (hook → problem → demo → proof → cta) su
 * qualunque brief: dieci aperture diverse e una forma sola.
 *
 * Un formato è una TIMELINE, non un'etichetta: "Unboxing" significa che a 0-3s arriva un pacco e a
 * 10-20s il prodotto viene usato in camera. Cambia il prompt del modello video, non la caption.
 *
 * PERCENTUALI, NON SECONDI: la dottrina è scritta su clip da 30s, noi spediamo 15s organici (22s
 * per gli ad) e gli Shorts vogliono 45-60s. `formatBeats` riscala.
 *
 * CLIENT-SAFE apposta: la toolbar dell'UGC Creator sceglie formato e piattaforma, quindi niente
 * `$lib/server`. Nessun I/O, nessun clock, nessun random: dati puri + funzioni pure.
 */

/**
 * I tetti di durata dell'UGC parlato, qui e non in `$lib/server/video` perché la toolbar li deve
 * leggere. `server/video.ts` li ri-esporta con i nomi storici: una sola fonte, due nomi già in uso.
 */
export const UGC_ORGANIC_SECONDS = 15;
/** Ad UGC a pagamento — solo su Seedance 2.5. */
export const UGC_AD_SECONDS = 22;

export const UGC_FORMAT_IDS = [
  'problem_solution',
  'testimonial',
  'unboxing',
  'tutorial',
  'comparison',
  'day_in_life',
  'green_screen',
  'tiktok_shop'
] as const;

export type UgcFormatId = (typeof UGC_FORMAT_IDS)[number];

export const UGC_PLATFORM_IDS = [
  'tiktok',
  'instagram_reels',
  'facebook_reels',
  'youtube_shorts'
] as const;

export type UgcPlatformId = (typeof UGC_PLATFORM_IDS)[number];

/** Gli obiettivi per cui si sceglie un formato invece di un altro. */
export const UGC_GOAL_IDS = [
  'cold_conversion',
  'trust',
  'launch',
  'trend',
  'commerce',
  'retargeting'
] as const;

export type UgcGoalId = (typeof UGC_GOAL_IDS)[number];

/** Una battuta del formato, in frazioni di clip (0 → 1). L'azione è in inglese: finisce nel prompt Seedance. */
export type UgcFormatBeat = {
  /** Etichetta breve del beat — compare come STAGES nel prompt e nel piano. */
  key: string;
  /** Inizio come frazione della clip (0 = primo frame). */
  fromPct: number;
  /** Fine come frazione della clip (1 = ultimo frame). */
  toPct: number;
  /** Cosa succede SULLO SCHERMO in quel tratto. Inglese — è prompt per il modello video. */
  action: string;
};

export type UgcFormat = {
  id: UgcFormatId;
  label: string;
  /** Cos'è il formato, in una riga. */
  what: string;
  /** Con quale formato viene confuso, e la distinzione che li separa. Senza questo il modello li ricollassa in due. */
  notToConfuseWith: string;
  /** Come fallisce. Un formato usato dove fallisce è peggio che non usarlo. */
  failsWhen: string;
  /** Dove rende di più. */
  bestFor: string;
  /** Piattaforme dove il formato è nativo (non un divieto: una preferenza di resa). */
  platforms: UgcPlatformId[];
  /** Aperture di `hook-tactics.ts` che questo formato regge naturalmente. */
  hookTactics: string[];
  /** Il prodotto può comparire prima del 50% della clip? Nei formati "recensione" no: uccide la credibilità. */
  productEarly: boolean;
  /**
   * La clip cambia inquadratura, o è una ripresa unica? Decide se il prompt Seedance porta gli
   * stacchi e se rendere frame di riferimento per le scene. Su un talking head entrambe le cose
   * fanno danno: invitano a tagli che il formato non vuole e costano immagini che non servono.
   */
  multiScene: boolean;
  beats: UgcFormatBeat[];
};

/**
 * Le otto forme. Le battute sono tarate sulla clip da 30s della dottrina e riscalate da
 * `formatBeats`: le percentuali sono la fonte di verità, i secondi no.
 */
export const UGC_FORMATS: UgcFormat[] = [
  {
    id: 'problem_solution',
    label: 'Problema-Soluzione',
    what: 'Nomina il dolore quotidiano, lo peggiora, poi mostra il prodotto come la via d\'uscita.',
    notToConfuseWith:
      'Comparison, che mette in scena il MODO VECCHIO come antagonista. Qui l\'antagonista è il problema, non un\'alternativa.',
    failsWhen:
      'Il dolore è generico ("gestire i social è difficile"): senza un momento concreto non c\'è agitazione possibile e restano venti secondi di brochure.',
    bestFor: 'Direct response su traffico freddo, tutte le piattaforme.',
    platforms: ['tiktok', 'instagram_reels', 'facebook_reels', 'youtube_shorts'],
    hookTactics: ['callout', 'fear_loss', 'question', 'contrarian'],
    productEarly: false,
    multiScene: false,
    beats: [
      {
        key: 'pain',
        fromPct: 0,
        toPct: 0.1,
        action:
          'PAIN — name the concrete daily moment it goes wrong, already mid-sentence, brows knit, NO product on screen'
      },
      {
        key: 'agitate',
        fromPct: 0.1,
        toPct: 0.27,
        action:
          'AGITATE — make it worse ("and the worst part is…"): the second cost nobody mentions, time or money or shame'
      },
      {
        key: 'solution',
        fromPct: 0.27,
        toPct: 0.67,
        action:
          'SOLUTION — introduce the product as the fix and give away the mechanic out loud in one concrete step; product may now appear casually in hand'
      },
      {
        key: 'result',
        fromPct: 0.67,
        toPct: 0.83,
        action:
          'RESULT — energy shifts to relief; one specific outcome, metric or testimonial line, not an adjective'
      },
      {
        key: 'cta',
        fromPct: 0.83,
        toPct: 1,
        action: 'CTA — "link in bio" or "comment [word]", said as an afterthought, trailing off'
      }
    ]
  },
  {
    id: 'testimonial',
    label: 'Testimonianza',
    what: 'Qualcuno che l\'ha già usato racconta il prima, la scoperta e il risultato con un numero.',
    notToConfuseWith:
      'Day-in-the-Life, che è al presente e senza verdetto. La testimonianza guarda indietro e chiude con una raccomandazione.',
    failsWhen:
      'Il risultato è aggettivale ("mi ha cambiato la vita"). Senza una cifra o una scena concreta è indistinguibile da uno spot e viene letta come tale.',
    bestFor: 'Metà funnel e retargeting — Meta Reels e YouTube Shorts.',
    platforms: ['instagram_reels', 'facebook_reels', 'youtube_shorts'],
    hookTactics: ['social_witness', 'story_cold_open', 'contrarian', 'outcome'],
    productEarly: false,
    multiScene: false,
    beats: [
      {
        key: 'skeptic',
        fromPct: 0,
        toPct: 0.1,
        action:
          'SKEPTIC OPEN — "I was skeptical but…" / "three months later…", said flatly, no product, no energy performance'
      },
      {
        key: 'before',
        fromPct: 0.1,
        toPct: 0.33,
        action: 'BEFORE — what life actually looked like: one scene, one cost, told in past tense'
      },
      {
        key: 'discovery',
        fromPct: 0.33,
        toPct: 0.67,
        action:
          'DISCOVERY — how they found it and what they tried first; product appears now, held the way you show a friend'
      },
      {
        key: 'result',
        fromPct: 0.67,
        toPct: 0.83,
        action: 'RESULT — one specific outcome WITH a number or a dated fact; shoulders drop, small real smile'
      },
      {
        key: 'recommend',
        fromPct: 0.83,
        toPct: 1,
        action: 'RECOMMEND — speak straight to the viewer, one sentence, no slogan'
      }
    ]
  },
  {
    id: 'unboxing',
    label: 'Unboxing',
    what: 'Il pacco arriva, si apre in camera, si usa per la prima volta e si dà un verdetto onesto.',
    notToConfuseWith:
      'Tutorial, che insegna un risultato. Qui non si insegna niente: si REAGISCE, e la prima reazione è il contenuto.',
    failsWhen:
      'La reazione è recitata o il verdetto è solo positivo. Un unboxing senza una riserva vera legge come pubblicità e perde i commenti.',
    bestFor: 'Lanci di prodotto, TikTok.',
    platforms: ['tiktok', 'instagram_reels'],
    hookTactics: ['pattern_interrupt', 'curiosity_gap', 'demonstration'],
    productEarly: true,
    multiScene: true,
    beats: [
      {
        key: 'arrival',
        fromPct: 0,
        toPct: 0.1,
        action:
          'ARRIVAL — the package lands in frame or "this just came in…"; hands and box carry the shot, face secondary'
      },
      {
        key: 'open',
        fromPct: 0.1,
        toPct: 0.33,
        action:
          'OPEN — actually open it on camera, unrehearsed reaction to what is inside, one micro-hesitation'
      },
      {
        key: 'first_use',
        fromPct: 0.33,
        toPct: 0.67,
        action: 'FIRST USE — use it for the first time on camera, narrating what surprises them'
      },
      {
        key: 'verdict',
        fromPct: 0.67,
        toPct: 0.83,
        action:
          'VERDICT — honest first impression INCLUDING one reservation; never a clean recommendation'
      },
      { key: 'cta', fromPct: 0.83, toPct: 1, action: 'CTA — "would you try it?", asked for real, inviting the comment' }
    ]
  },
  {
    id: 'tutorial',
    label: 'Tutorial',
    what: 'Ecco come ottengo un risultato: tre-quattro passi con il prodotto dentro, poi il risultato finito.',
    notToConfuseWith:
      'Demo dentro Problema-Soluzione, che è UN passo dato in regalo. Il tutorial è l\'intera procedura e il prodotto è uno strumento, non l\'argomento.',
    failsWhen:
      'I passi sono quattro modi di dire "usa il prodotto". Se non si impara niente senza comprare, non è un tutorial: è una demo travestita.',
    bestFor: 'SaaS, beauty, fitness — YouTube Shorts e Reels.',
    platforms: ['youtube_shorts', 'instagram_reels', 'tiktok'],
    hookTactics: ['outcome', 'demonstration', 'implied_answer', 'trojan_horse'],
    productEarly: true,
    multiScene: true,
    beats: [
      {
        key: 'promise',
        fromPct: 0,
        toPct: 0.1,
        action: 'PROMISE — "here is how I [desired outcome]" stated as a fact, already doing it'
      },
      {
        key: 'steps',
        fromPct: 0.1,
        toPct: 0.5,
        action:
          'STEPS — walk through 3-4 real steps using the product, hands visible, each step nameable by the viewer afterwards'
      },
      {
        key: 'step_final',
        fromPct: 0.5,
        toPct: 0.72,
        action: 'LAST STEP — the one that does the work; slow down here, this is what gets rewatched'
      },
      { key: 'result', fromPct: 0.72, toPct: 0.87, action: 'RESULT — show the finished thing, uncut, no cutaway to a stock shot' },
      {
        key: 'cta',
        fromPct: 0.87,
        toPct: 1,
        action: 'CTA — "save this for later" / "follow for more", flat delivery'
      }
    ]
  },
  {
    id: 'comparison',
    label: 'Confronto',
    what: 'Smetti di fare così: il modo vecchio in scena, poi lo stesso lavoro con il prodotto, poi i due affiancati.',
    notToConfuseWith:
      'Problema-Soluzione: lì il nemico è il problema, qui è un METODO che il pubblico usa oggi. Serve che il modo vecchio sia riconoscibile.',
    failsWhen:
      'Il modo vecchio è una caricatura. Se nessuno si riconosce nel primo tempo, il secondo non convince nessuno — e se il modo vecchio è un competitor nominato, è un problema legale prima che creativo.',
    bestFor: 'Posizionamento competitivo, TikTok e Reels.',
    platforms: ['tiktok', 'instagram_reels', 'facebook_reels'],
    hookTactics: ['contrarian', 'borrowed_enemy', 'contrast', 'callout'],
    productEarly: false,
    multiScene: true,
    beats: [
      {
        key: 'stop',
        fromPct: 0,
        toPct: 0.1,
        action: 'STOP — "stop using [the old way], do this instead", mid-gesture, no product yet'
      },
      {
        key: 'old_way',
        fromPct: 0.1,
        toPct: 0.4,
        action:
          'OLD WAY — act out the frustrating old way for real, long enough to be recognised; no competitor logo, no named brand'
      },
      {
        key: 'new_way',
        fromPct: 0.4,
        toPct: 0.73,
        action: 'NEW WAY — same job with the product, same room, same hands, visibly fewer steps'
      },
      {
        key: 'side_by_side',
        fromPct: 0.73,
        toPct: 0.9,
        action: 'SIDE BY SIDE — hold both realities in one frame or one sentence; the delta is the argument'
      },
      { key: 'cta', fromPct: 0.9, toPct: 1, action: 'CTA — direct to purchase, one line, no hedging' }
    ]
  },
  {
    id: 'day_in_life',
    label: 'Un giorno con',
    what: 'Una giornata di un ruolo preciso, con il prodotto che compare dove capita davvero.',
    notToConfuseWith:
      'Testimonianza, che è retrospettiva e chiude con un verdetto. Qui non c\'è verdetto: c\'è la giornata, e il prodotto è un dettaglio dentro.',
    failsWhen:
      'Il ruolo è vago ("un imprenditore"). Senza un ruolo specifico non c\'è nessuno che si riconosce e la giornata è quella di nessuno.',
    bestFor: 'Prodotti lifestyle, tutte le piattaforme.',
    platforms: ['tiktok', 'instagram_reels', 'facebook_reels', 'youtube_shorts'],
    hookTactics: ['identity', 'story_cold_open', 'callout'],
    productEarly: false,
    multiScene: true,
    beats: [
      {
        key: 'frame',
        fromPct: 0,
        toPct: 0.1,
        action: 'FRAME — "a day using [product] as a [specific role]", said while already moving'
      },
      {
        key: 'morning',
        fromPct: 0.1,
        toPct: 0.33,
        action: 'MORNING — the routine before the product matters; establish the real texture of the day'
      },
      {
        key: 'key_moment',
        fromPct: 0.33,
        toPct: 0.6,
        action:
          'KEY MOMENT — the product does its one job, with a genuine unperformed reaction to it working'
      },
      {
        key: 'payoff',
        fromPct: 0.6,
        toPct: 0.83,
        action: 'PAYOFF — how the rest of the day went differently; concrete, small, believable'
      },
      { key: 'cta', fromPct: 0.83, toPct: 1, action: 'SOFT CTA — mention the link almost as an afterthought' }
    ]
  },
  {
    id: 'green_screen',
    label: 'Green screen / reazione',
    what: 'Reagisce a una clip, un titolo o un dato che gira, e ci aggancia il prodotto.',
    notToConfuseWith:
      'Confronto: lì l\'antagonista è un metodo, qui è una NOTIZIA di oggi. Il formato scade: fuori dalla finestra del trend è un video su niente.',
    failsWhen:
      'L\'aggancio al prodotto è forzato. Se la notizia e il prodotto non hanno un legame vero, il pubblico legge il trucco e il commento diventa ostile.',
    bestFor: 'Trend-jacking, TikTok.',
    platforms: ['tiktok', 'instagram_reels'],
    hookTactics: ['pattern_interrupt', 'stat_lead', 'contrarian', 'borrowed_enemy'],
    productEarly: false,
    multiScene: true,
    beats: [
      {
        key: 'react',
        fromPct: 0,
        toPct: 0.1,
        action:
          'REACT — respond to the trending clip / headline / stat pinned beside them, mid-reaction, no preamble'
      },
      {
        key: 'context',
        fromPct: 0.1,
        toPct: 0.33,
        action: 'CONTEXT — "this is wild because…": the thing everyone missed, said fast'
      },
      {
        key: 'tie_in',
        fromPct: 0.33,
        toPct: 0.67,
        action: 'TIE-IN — connect it to the product naturally; if the connection needs explaining, it is the wrong story'
      },
      {
        key: 'proof',
        fromPct: 0.67,
        toPct: 0.83,
        action: 'PROOF — why the product is the answer to what the news exposed; one verifiable detail'
      },
      { key: 'cta', fromPct: 0.83, toPct: 1, action: 'CTA — comment-driven: ask for the disagreement out loud' }
    ]
  },
  {
    id: 'tiktok_shop',
    label: 'TikTok Shop',
    what: 'Prodotto in primo piano su un suono in trend, demo, giustificazione del prezzo, urgenza, carrello.',
    notToConfuseWith:
      'Unboxing, che vende la scoperta. Qui si vende la TRANSAZIONE: il prezzo va nominato e difeso dentro la clip.',
    failsWhen:
      'L\'urgenza è inventata. Uno stock basso falso è una pratica commerciale scorretta, e le piattaforme di commerce la puniscono più in fretta di quanto il pubblico se ne accorga.',
    bestFor: 'Commerce diretto — solo TikTok Shop.',
    platforms: ['tiktok'],
    hookTactics: ['demonstration', 'outcome', 'stat_lead'],
    productEarly: true,
    multiScene: true,
    beats: [
      {
        key: 'product_first',
        fromPct: 0,
        toPct: 0.1,
        action: 'PRODUCT FIRST — the product fills the opening frame, hands already on it, trending sound underneath'
      },
      { key: 'demo', fromPct: 0.1, toPct: 0.33, action: 'DEMO — the product doing the thing, uninterrupted, no talking head cutaway' },
      {
        key: 'value',
        fromPct: 0.33,
        toPct: 0.67,
        action: 'VALUE — say the price out loud and justify it against what it replaces'
      },
      {
        key: 'urgency',
        fromPct: 0.67,
        toPct: 0.83,
        action: 'URGENCY — the real offer and its real deadline; never invent stock levels or a countdown'
      },
      {
        key: 'cart',
        fromPct: 0.83,
        toPct: 1,
        action: 'CART — point at the basket ("tap the orange basket" / "yellow cart below")'
      }
    ]
  }
];

const FORMATS_BY_ID = new Map<UgcFormatId, UgcFormat>(UGC_FORMATS.map((f) => [f.id, f]));

export function ugcFormatById(id: string | null | undefined): UgcFormat | null {
  return id ? (FORMATS_BY_ID.get(id as UgcFormatId) ?? null) : null;
}

/** True quando la clip cambia scena/inquadratura: stacchi nel prompt e frame di riferimento. */
export function formatIsMultiScene(id: string | null | undefined): boolean {
  return ugcFormatById(id)?.multiScene ?? false;
}

export function isUgcFormatId(raw: unknown): raw is UgcFormatId {
  return typeof raw === 'string' && FORMATS_BY_ID.has(raw as UgcFormatId);
}

/** Obiettivo → formato primario e secondario. La scelta del formato è una scelta di funnel. */
export const UGC_GOAL_FORMATS: Record<UgcGoalId, { label: string; primary: UgcFormatId; secondary: UgcFormatId }> = {
  cold_conversion: { label: 'Conversione a freddo', primary: 'problem_solution', secondary: 'comparison' },
  trust: { label: 'Costruire fiducia', primary: 'testimonial', secondary: 'tutorial' },
  launch: { label: 'Lancio di prodotto', primary: 'unboxing', secondary: 'day_in_life' },
  trend: { label: 'Cavalcare un trend', primary: 'green_screen', secondary: 'problem_solution' },
  commerce: { label: 'Commerce diretto', primary: 'tiktok_shop', secondary: 'unboxing' },
  retargeting: { label: 'Retargeting', primary: 'tutorial', secondary: 'testimonial' }
};

export type UgcPlatformSpec = {
  id: UgcPlatformId;
  label: string;
  /** Tetto della piattaforma, in secondi. */
  maxSeconds: number;
  /** La finestra dove il formato rende — non il tetto. */
  sweetSpot: [number, number];
  captions: 'required' | 'recommended';
  hashtags: [number, number];
  /** Quanti pezzi UGC a settimana regge il canale. */
  cadence: string;
  /** Cosa cambia su questa piattaforma e perché. */
  note: string;
  /** I formati che rendono di più qui. */
  formats: UgcFormatId[];
};

/**
 * Specifiche di piattaforma. 9:16 verticale ovunque — non è un parametro, è il formato. I CPM sono
 * ordini di grandezza di mercato: spiegano perché il riuso da TikTok verso Facebook conviene, non
 * preventivano una campagna.
 */
export const UGC_PLATFORMS: UgcPlatformSpec[] = [
  {
    id: 'tiktok',
    label: 'TikTok',
    maxSeconds: 600,
    sweetSpot: [15, 30],
    captions: 'required',
    hashtags: [3, 5],
    cadence: '1-3 pezzi al giorno',
    note: 'Trend e suoni battono la rifinitura: un video troppo pulito qui perde. Spark Ads completano molto più degli in-feed standard; TikTok Shop per il commerce diretto.',
    formats: ['unboxing', 'green_screen', 'comparison', 'tiktok_shop', 'problem_solution']
  },
  {
    id: 'instagram_reels',
    label: 'Instagram Reels',
    maxSeconds: 90,
    sweetSpot: [15, 30],
    captions: 'recommended',
    hashtags: [5, 10],
    cadence: '4-7 a settimana',
    note: 'Leggermente più rifinito di TikTok. I Reels con UGC rendono molto più dei post a feed; per il whitelisting si usano le partnership ads.',
    formats: ['problem_solution', 'testimonial', 'tutorial', 'day_in_life']
  },
  {
    id: 'facebook_reels',
    label: 'Facebook Reels',
    maxSeconds: 90,
    sweetSpot: [15, 45],
    captions: 'required',
    hashtags: [3, 5],
    cadence: '3-5 a settimana',
    note: 'Si riusa l\'UGC di TikTok. Pubblico più adulto: testimonianze e tutorial reggono meglio delle reazioni. CPM più caro di TikTok — ci si porta ciò che ha già funzionato organico.',
    formats: ['testimonial', 'tutorial', 'problem_solution']
  },
  {
    id: 'youtube_shorts',
    label: 'YouTube Shorts',
    maxSeconds: 60,
    sweetSpot: [30, 60],
    captions: 'recommended',
    hashtags: [3, 5],
    cadence: '3-5 a settimana',
    note: 'Il formato più lungo funziona: 45-60s regge. I tutorial sovraperformano e portano traffico al long-form.',
    formats: ['tutorial', 'testimonial', 'problem_solution', 'day_in_life']
  }
];

const PLATFORMS_BY_ID = new Map<UgcPlatformId, UgcPlatformSpec>(UGC_PLATFORMS.map((p) => [p.id, p]));

export function ugcPlatformById(id: string | null | undefined): UgcPlatformSpec | null {
  return id ? (PLATFORMS_BY_ID.get(id as UgcPlatformId) ?? null) : null;
}

export function isUgcPlatformId(raw: unknown): raw is UgcPlatformId {
  return typeof raw === 'string' && PLATFORMS_BY_ID.has(raw as UgcPlatformId);
}

/**
 * Durata da spedire per una piattaforma, dentro il tetto tecnico del modello video: il basso della
 * sweet spot (più corto = più completion), mai oltre `cap`.
 */
export function platformClipSeconds(
  platform: UgcPlatformId | null | undefined,
  cap: number
): number {
  const spec = ugcPlatformById(platform);
  if (!spec) return cap;
  const target = Math.min(spec.sweetSpot[0], spec.maxSeconds);
  return Math.max(1, Math.min(cap, target));
}

/** Una battuta risolta in secondi per una clip di `seconds`. */
export type UgcResolvedBeat = { key: string; start: number; end: number; action: string };

/**
 * Le battute del formato riscalate sulla durata reale della clip. Ogni beat riceve almeno
 * `minBeat` secondi; se la somma dei minimi non ci sta, i beat finali vengono compressi in
 * proporzione invece di sparire — un CTA tagliato rende inutile una clip già pagata per intero.
 */
export function formatBeats(
  format: UgcFormatId | UgcFormat,
  seconds: number,
  opts: { minBeat?: number } = {}
): UgcResolvedBeat[] {
  const spec = typeof format === 'string' ? ugcFormatById(format) : format;
  if (!spec) return [];
  const total = Math.max(1, seconds);
  const minBeat = Math.max(0.4, opts.minBeat ?? Math.min(1, total / (spec.beats.length * 2)));
  const raw = spec.beats.map((b) => ({
    key: b.key,
    action: b.action,
    span: Math.max(0, (b.toPct - b.fromPct) * total)
  }));
  // Alza ogni beat al minimo, poi ridistribuisci l'eccesso togliendolo ai beat più lunghi.
  const spans = raw.map((r) => Math.max(minBeat, r.span));
  let over = spans.reduce((a, b) => a + b, 0) - total;
  while (over > 0.001) {
    const slack = spans.map((s) => Math.max(0, s - minBeat));
    const slackTotal = slack.reduce((a, b) => a + b, 0);
    if (slackTotal <= 0.001) break;
    const cut = Math.min(over, slackTotal);
    for (let i = 0; i < spans.length; i++) spans[i] -= (slack[i]! / slackTotal) * cut;
    over -= cut;
  }
  const out: UgcResolvedBeat[] = [];
  let t = 0;
  for (let i = 0; i < raw.length; i++) {
    const start = round1(t);
    const end = i === raw.length - 1 ? round1(total) : round1(Math.min(total, t + spans[i]!));
    out.push({ key: raw[i]!.key, start, end: Math.max(end, start), action: raw[i]!.action });
    t = end;
  }
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * La matrice hook × formato di un batch: `count` slot distribuiti sui formati — dieci script sullo
 * stesso formato sono dieci parafrasi. La rotazione parte dal formato preferito e poi gira su
 * quelli nativi della piattaforma.
 */
export function rotateUgcFormats(
  count: number,
  opts: { preferred?: UgcFormatId | null; platform?: UgcPlatformId | null } = {}
): UgcFormatId[] {
  const n = Math.max(0, Math.floor(count));
  if (n <= 0) return [];
  // Formato fissato in toolbar → tutto il batch in quella forma: la scelta esplicita vince.
  if (opts.preferred) return Array.from({ length: n }, () => opts.preferred!);
  const platform = ugcPlatformById(opts.platform);
  const pool = platform
    ? [...platform.formats, ...UGC_FORMAT_IDS.filter((id) => !platform.formats.includes(id))]
    : [...UGC_FORMAT_IDS];
  return Array.from({ length: n }, (_, i) => pool[i % pool.length]!);
}

/** Il catalogo come blocco di prompt, per i modelli che SCELGONO il formato (il planner UGC). */
export function ugcFormatBrief(opts: { platform?: UgcPlatformId | null } = {}): string {
  const platform = ugcPlatformById(opts.platform);
  const allowed = platform ? platform.formats : UGC_FORMAT_IDS;
  const lines = UGC_FORMATS.map((f) => {
    const native = allowed.includes(f.id) ? '' : ' [non nativo su questa piattaforma]';
    return `- ${f.id} (${f.label})${native}: ${f.what} NON confondere con: ${f.notToConfuseWith} Fallisce quando: ${f.failsWhen}`;
  });
  return [
    'FORMATI UGC — la STRUTTURA della clip (l\'hook è un\'altra scelta, non questa). Usa sempre uno di questi id.',
    ...lines,
    'Un batch non usa un formato solo: assegna forme diverse agli slot, altrimenti dieci script sono dieci parafrasi.'
  ].join('\n');
}

/** Le regole della piattaforma come blocco di prompt (durata, caption, hashtag, cadenza). */
export function ugcPlatformBrief(platform: UgcPlatformId | null | undefined): string {
  const spec = ugcPlatformById(platform);
  if (!spec) {
    return 'PIATTAFORMA: non specificata — resta su 9:16 verticale, hook entro i primi 3 secondi, tutto leggibile a volume zero.';
  }
  return [
    `PIATTAFORMA ${spec.label} — 9:16 verticale.`,
    `Durata: sweet spot ${spec.sweetSpot[0]}-${spec.sweetSpot[1]}s (tetto ${spec.maxSeconds}s).`,
    `Sottotitoli: ${spec.captions === 'required' ? 'obbligatori' : 'consigliati'}. Hashtag: ${spec.hashtags[0]}-${spec.hashtags[1]}. Cadenza: ${spec.cadence}.`,
    spec.note,
    `Formati nativi qui: ${spec.formats.map((id) => ugcFormatById(id)?.label ?? id).join(', ')}.`
  ].join('\n');
}

/**
 * IL WORKFLOW DI PRODUZIONE. Sta qui e non in un documento perché è ciò che la pagina UGC deve
 * DIRE accanto al bottone: quanti script, quanti avatar, quante rese si buttano, e che l'organico
 * viene PRIMA della spesa.
 */
export const UGC_PRODUCTION_STEPS = [
  {
    key: 'scripts',
    label: '10 script',
    detail: 'Matrice hook / corpo / CTA — dieci variazioni, non dieci parafrasi.'
  },
  {
    key: 'avatars',
    label: '3-5 avatar',
    detail: 'Volti che corrispondono al target demografico, non i più belli disponibili.'
  },
  {
    key: 'batch',
    label: 'Batch completo',
    detail: 'Ogni script su ogni avatar: 10 × 5 = 50 varianti rese in blocco.'
  },
  {
    key: 'filter',
    label: 'Filtro qualità',
    detail: 'Si scartano le rese sbagliate: aspettati un 20-30% di scarto, è normale.'
  },
  {
    key: 'edit',
    label: 'Montaggio',
    detail: 'Sottotitoli, musica e B-roll fuori da qui (CapCut o equivalente).'
  },
  {
    key: 'organic',
    label: 'Prima organico',
    detail: 'I migliori 10-15 escono organici PRIMA di qualunque euro di spesa.'
  },
  {
    key: 'paid',
    label: 'Poi paid',
    detail: 'Solo i vincitori organici passano al test a pagamento.'
  }
] as const;

/** Tasso di scarto atteso dal filtro qualità (min, max) — usato dalla pagina per dimensionare il batch. */
export const UGC_EXPECTED_REJECTION: [number, number] = [0.2, 0.3];

/**
 * Quante varianti rendere per spedirne `wanted`, dato lo scarto atteso.
 * Chiedere dieci clip e riceverne dieci significa spedirne sette buone e tre che imbarazzano.
 */
export function batchSizeForKeepers(wanted: number, rejection = UGC_EXPECTED_REJECTION[1]): number {
  const w = Math.max(0, Math.floor(wanted));
  if (!w) return 0;
  const keep = Math.max(0.1, 1 - rejection);
  return Math.ceil(w / keep);
}
