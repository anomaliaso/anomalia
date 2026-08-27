// EU AI Act (Regolamento (UE) 2024/1689) — la fonte unica con cui il prodotto tiene sé stesso,
// l'assistente e l'utente dalla parte giusta della legge.
//
//  • Art. 5 — la lista nera: otto pratiche vietate a prescindere da consenso, contratto o bontà
//    della ragione commerciale. L'ASSISTENTE deve sapere perché rifiuta, e l'UTENTE deve leggere
//    nel transcript cosa è stato segnalato e qual è la regola.
//  • Art. 50 — trasparenza: si deve poter capire di parlare con un'AI e che un'immagine, una voce
//    o una clip sono sintetiche. Una parte la facciamo noi (marcatura in-file, flag AI alla
//    pubblicazione); l'altra è dell'utente, e va detto quale.
//
// Client-safe apposta: gli avvisi si disegnano in chat, le stesse stringhe istruiscono il modello e
// le pagine legali citano la stessa lista. Una lista, una formulazione, nessuna deriva.

export type AiActLocale = 'it' | 'en';

/** Chat runs in it/en only; anything else reads the English copy. */
export function aiActLocale(locale: string | null | undefined): AiActLocale {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('it') ? 'it' : 'en';
}

export type ProhibitedPracticeId =
  | 'manipulation'
  | 'vulnerability'
  | 'social_scoring'
  | 'crime_prediction'
  | 'face_scraping'
  | 'emotion_recognition'
  | 'biometric_categorisation'
  | 'remote_biometric_id';

export type ProhibitedPractice = {
  id: ProhibitedPracticeId;
  /** Sub-paragraph of Art. 5(1) that bans it. */
  article: string;
  /** Short name of the practice. */
  label: Record<AiActLocale, string>;
  /** What the ban actually covers — shown to the user, and given to the model as its reason. */
  why: Record<AiActLocale, string>;
  /**
   * Setaccio conservativo. Ogni voce è una regola, e una regola scatta solo se TUTTI i suoi regex
   * combaciano: pretendere un verbo manipolativo E un marcatore protetto è ciò che tiene fuori il
   * marketing normale. Segnala per informare, non filtra in silenzio.
   */
  screen: RegExp[][];
};

// Vocabolario condiviso da più setacci. Scritto a mano per lingua e non tradotto a macchina: il
// tasso di falsi positivi dipende interamente da quanto sono stretti.

/** Verbs that describe acting ON someone rather than persuading them. */
const EXPLOIT_VERB =
  /\b(exploit(ing|s)?|prey(ing)?\s+on|take\s+advantage\s+of|manipulat(e|ing|ion)|weaponi[sz](e|ing)|sfrutt\w+|approfitt\w+|far\s+leva\s+su|manipol\w+|puntare\s+sulla?\s+(paura|debolezza|fragilit))/i;

/** Groups Art. 5(1)(b) names, plus the everyday words for them. */
const VULNERABLE_GROUP =
  /\b(minors?|children|kids|teenagers?|under-?18|elderly|seniors?|pensioners?|dementia|alzheimer|disabled|disability|terminally\s+ill|addicts?|addiction|gambl\w+|in\s+debt|indebted|desperate|bereaved|grieving|poverty|low[-\s]income|minorenni|minori|bambin\w+|adolescent\w+|anzian\w+|pensionat\w+|disabil\w+|malat\w+\s+terminal\w+|dipendent\w+\s+(da|dal)|ludopat\w+|indebitat\w+|disperat\w+|in\s+lutto|povert\w+|fragil\w+)\b/i;

/** Distortion below the level of awareness — the core of Art. 5(1)(a). */
const SUBLIMINAL =
  /\b(subliminal\w*|below\s+(the\s+)?(level\s+of\s+)?awareness|without\s+(them|the\s+user|people)\s+(knowing|realis\w+|realiz\w+|noticing)|dark\s+patterns?|subconscious\w*|inconsci\w+|a\s+loro\s+insaputa|senza\s+che\s+se\s+ne\s+accorg\w+|senza\s+che\s+lo\s+sappian\w+)/i;

const DECEPTIVE_INTENT =
  /\b(deceiv\w+|deceptive|trick(ing|s)?|mislead\w+|fake\s+(testimonial|review|scarcity|urgency)|impersonat\w+|ingann\w+|raggir\w+|fals\w+\s+(recension|testimonianz)|spacciare\s+per)/i;

const SCORING_ACTION =
  /\b(score|scoring|rank(ing)?|rate|rating|classif\w+|profil\w+|blacklist\w*|black-?list|denylist|punteggi\w+|valutare|assegnar\w+\s+un\s+punteggio|lista\s+nera|schedar\w+)\b/i;

const SOCIAL_TRAITS =
  /\b(social\s+behaviou?r|personal(ity)?\s+(traits?|characteristics)|trustworthiness|reputation|lifestyle|political\s+(views?|opinions?)|religio\w+|ethnic\w+|sexual\s+orientation|comportamento\s+social\w+|tratti\s+(della\s+)?personalit\w+|affidabilit\w+|reputazion\w+|opinioni\s+politich\w+|orientamento\s+sessuale|etnia|religion\w+)/i;

const CITIZEN_SCOPE =
  /\b(citizens?|people|persons?|individuals?|population|customers?\s+as\s+people|cittadin\w+|persone|individui|popolazione)\b/i;

const CRIME_PREDICTION =
  /\b(predict\w*|forecast\w*|assess\w*\s+the\s+risk|likelihood)\b.{0,60}\b(crime|criminal|offen[cs]e|reoffend\w*|delinquen\w+|reato|reati|criminal\w+|recidiv\w+)/i;

const FACE_SCRAPING =
  /\b(scrap\w+|harvest\w+|crawl\w+|download\w+|raccogl\w+|estrarr\w+)\b.{0,60}\b(faces?|facial\s+images?|face\s+database|volti|immagini\s+facciali|foto\s+segnaletich\w+)/i;

const EMOTION_RECOGNITION =
  /\b(detect\w*|recogni[sz]\w*|infer\w*|read(ing)?|analy[sz]\w*|riconoscer\w+|rilevar\w+|dedurr\w+|analizzar\w+)\b.{0,60}\b(emotions?|emotional\s+state|mood|feelings?|stress\s+level|emozion\w+|stato\s+emotiv\w+|umore|sentiment\w+\s+dei\s+dipendenti)/i;

const WORKPLACE_OR_SCHOOL =
  /\b(employees?|staff|workers?|workplace|candidates?|applicants?|interview\w*|students?|pupils?|classroom|school|exam|dipendent\w+|personale|lavorator\w+|luogo\s+di\s+lavoro|candidat\w+|colloqui\w+|student\w+|alunn\w+|scuola|aula|esame)\b/i;

const BIOMETRIC_SOURCE =
  /\b(biometric\w*|face|facial|fingerprint|iris|voiceprint|gait|biometric\w*|volto|facciale|impronta|iride|timbro\s+vocale|andatura)\b/i;

const SENSITIVE_INFERENCE =
  /\b(race|racial|ethnicity|political\s+(opinion|affiliation)|trade[-\s]union|religio\w+|philosophical\s+belief|sex\s+life|sexual\s+orientation|razza|etnia|opinion\w+\s+politich\w+|sindacal\w+|convinzioni\s+(religiose|filosofiche)|vita\s+sessuale|orientamento\s+sessuale)\b/i;

const REALTIME_BIOMETRIC_ID =
  /\b(real[-\s]?time|live|continuous|tempo\s+reale|dal\s+vivo|continu\w+)\b.{0,40}\b(facial\s+recognition|face\s+recognition|biometric\s+identification|riconoscimento\s+facciale|identificazione\s+biometrica)/i;

const PUBLIC_SPACE =
  /\b(public\s+(space|place|area)|street|square|stadium|airport|shopping\s+centre|shopping\s+center|mall|spazi\w*\s+pubblic\w+|strada|piazza|stadio|aeroporto|centro\s+commerciale)\b/i;

/**
 * Art. 5(1) AI Act, nell'ordine del Regolamento. Il testo è volutamente vicino all'originale:
 * questa lista viene citata al modello, mostrata all'utente e rispecchiata nei Termini, quindi deve
 * reggere così com'è scritta.
 */
export const PROHIBITED_PRACTICES: readonly ProhibitedPractice[] = [
  {
    id: 'manipulation',
    article: 'Art. 5(1)(a)',
    label: {
      en: 'Subliminal, manipulative or deceptive techniques',
      it: 'Tecniche subliminali, manipolative o ingannevoli'
    },
    why: {
      en: 'Techniques a person cannot perceive, or deliberate deception, used to materially distort behaviour in a way that causes or is likely to cause significant harm. Ordinary persuasive advertising is not covered — manipulation the person cannot notice is.',
      it: 'Tecniche che la persona non è in grado di percepire, o inganni deliberati, usati per distorcere in modo sostanziale il comportamento causando (o potendo causare) un danno significativo. La pubblicità persuasiva ordinaria non rientra: rientra la manipolazione che la persona non può accorgersi di subire.'
    },
    screen: [[SUBLIMINAL], [DECEPTIVE_INTENT, /\b(behaviou?r|decision|purchase|comportament\w+|decision\w+|acquist\w+)/i]]
  },
  {
    id: 'vulnerability',
    article: 'Art. 5(1)(b)',
    label: {
      en: 'Exploiting vulnerability (age, disability, social or economic situation)',
      it: 'Sfruttamento della vulnerabilità (età, disabilità, situazione sociale o economica)'
    },
    why: {
      en: 'Targeting the vulnerabilities of a person or group — because of their age, a disability, or a specific social or economic situation — so as to materially distort their behaviour and cause significant harm.',
      it: 'Sfruttare le vulnerabilità di una persona o di un gruppo — per età, disabilità o una specifica situazione sociale o economica — così da distorcerne sostanzialmente il comportamento e causare un danno significativo.'
    },
    screen: [[EXPLOIT_VERB, VULNERABLE_GROUP]]
  },
  {
    id: 'social_scoring',
    article: 'Art. 5(1)(c)',
    label: { en: 'Social scoring', it: 'Punteggio sociale (social scoring)' },
    why: {
      en: 'Evaluating or classifying people over time on their social behaviour or personal characteristics, and then treating them unfavourably — especially in contexts unrelated to where the data came from.',
      it: 'Valutare o classificare le persone nel tempo in base al comportamento sociale o a caratteristiche personali e poi trattarle in modo sfavorevole, soprattutto in contesti estranei a quello in cui i dati sono stati raccolti.'
    },
    screen: [[SCORING_ACTION, SOCIAL_TRAITS, CITIZEN_SCOPE]]
  },
  {
    id: 'crime_prediction',
    article: 'Art. 5(1)(d)',
    label: { en: 'Predicting criminal offences from profiling', it: 'Previsione di reati tramite profilazione' },
    why: {
      en: 'Assessing or predicting the risk that a person will commit a criminal offence on the basis of profiling or personality traits.',
      it: 'Valutare o prevedere il rischio che una persona commetta un reato sulla base di profilazione o di tratti della personalità.'
    },
    screen: [[CRIME_PREDICTION]]
  },
  {
    id: 'face_scraping',
    article: 'Art. 5(1)(e)',
    label: { en: 'Untargeted scraping of facial images', it: 'Scraping indiscriminato di immagini facciali' },
    why: {
      en: 'Creating or expanding facial-recognition databases through untargeted scraping of facial images from the internet or CCTV footage.',
      it: 'Creare o ampliare banche dati di riconoscimento facciale mediante scraping non mirato di immagini facciali da internet o da telecamere a circuito chiuso.'
    },
    screen: [[FACE_SCRAPING]]
  },
  {
    id: 'emotion_recognition',
    article: 'Art. 5(1)(f)',
    label: { en: 'Emotion recognition at work or in education', it: 'Riconoscimento delle emozioni sul lavoro o a scuola' },
    why: {
      en: 'Inferring the emotions of a person in the workplace or in an education setting, except for medical or safety reasons.',
      it: 'Dedurre le emozioni di una persona sul luogo di lavoro o in ambito educativo, salvo per motivi medici o di sicurezza.'
    },
    screen: [[EMOTION_RECOGNITION, WORKPLACE_OR_SCHOOL]]
  },
  {
    id: 'biometric_categorisation',
    article: 'Art. 5(1)(g)',
    label: { en: 'Biometric categorisation to infer sensitive traits', it: 'Categorizzazione biometrica per dedurre dati sensibili' },
    why: {
      en: 'Using biometric data to deduce race, political opinions, trade-union membership, religious or philosophical beliefs, sex life or sexual orientation.',
      it: 'Usare dati biometrici per dedurre razza, opinioni politiche, appartenenza sindacale, convinzioni religiose o filosofiche, vita sessuale o orientamento sessuale.'
    },
    screen: [[BIOMETRIC_SOURCE, SENSITIVE_INFERENCE]]
  },
  {
    id: 'remote_biometric_id',
    article: 'Art. 5(1)(h)',
    label: { en: 'Real-time remote biometric identification in public', it: 'Identificazione biometrica remota in tempo reale in pubblico' },
    why: {
      en: 'Real-time remote biometric identification of people in publicly accessible spaces (reserved, under strict conditions, to authorised law-enforcement use).',
      it: 'Identificazione biometrica remota in tempo reale delle persone in spazi accessibili al pubblico (riservata, a condizioni strettissime, alle autorità di contrasto).'
    },
    screen: [[REALTIME_BIOMETRIC_ID, PUBLIC_SPACE]]
  }
] as const;

export type PracticeHit = {
  id: ProhibitedPracticeId;
  article: string;
  label: string;
  why: string;
};

/**
 * Passa una richiesta al setaccio della lista nera dell'Art. 5.
 * Conservativo e NON bloccante di proposito: un hit informa il modello e l'utente, non rifiuta il
 * turno. Un setaccio a parole chiave non può essere la cosa che dice "no" a un cliente.
 */
export function screenForProhibitedPractice(
  text: string | null | undefined,
  locale: string = 'en'
): PracticeHit[] {
  const raw = (text ?? '').trim();
  // Under ~12 chars there is no room for a verb + a target, so any match would be an accident.
  if (raw.length < 12) return [];
  const lang = aiActLocale(locale);
  const hits: PracticeHit[] = [];
  for (const p of PROHIBITED_PRACTICES) {
    const fired = p.screen.some((rule) => rule.every((re) => re.test(raw)));
    if (fired) hits.push({ id: p.id, article: p.article, label: p.label[lang], why: p.why[lang] });
  }
  return hits;
}

/**
 * Il blocco che ogni prompt assistant porta con sé. Dichiara la lista nera per intero, e — non meno
 * importante — cosa NON c'è dentro, o il modello comincia a rifiutare lavoro pubblicitario normale
 * per eccesso di prudenza.
 */
export function aiActSystemSection(): string {
  const list = PROHIBITED_PRACTICES.map((p) => `- ${p.article} — ${p.label.en}: ${p.why.en}`).join('\n');
  return `## EU AI ACT — WHAT YOU MAY NOT HELP WITH, AND WHAT YOU MUST DISCLOSE
This product is an AI system under Regulation (EU) 2024/1689 (the "AI Act"). These rules bind you directly.

PROHIBITED PRACTICES (Art. 5 — the blacklist). Banned in the EU outright: no consent, contract or business justification makes them lawful. Never produce content, copy, targeting advice, briefs, prompts or tooling that implements any of them:
${list}

WHEN A REQUEST TOUCHES THE BLACKLIST: name the practice, cite the article, and do not be vague, moralise, or pretend the request was something else. Do every lawful part of the brief — never refuse a whole brief over one line — and offer the nearest lawful version of the rest, then do that work if they accept. The user has ALREADY been shown a compliance notice naming the practice: build on it in your own words, do not repeat it.

WHAT IS NOT PROHIBITED — do not over-refuse:
- Ordinary persuasive advertising: benefits, offers, real deadlines, real scarcity, emotional storytelling, humour, FOMO.
- Addressing a segment by age, life stage or income (pensioners, students, first-time buyers). Speaking TO a group is legitimate; exploiting its vulnerability to cause harm is not.
- Scoring leads, posts, keywords or competitors. Art. 5(1)(c) is about scoring PEOPLE on social behaviour or personal traits, not ranking content or business opportunities.
- Sentiment analysis of public comments about the brand. What is banned is inferring the emotions of employees, candidates or students.
When the honest answer is "this is fine", say so and get on with the work.

TRANSPARENCY (Art. 50) — duties you keep, and remind the user of:
- Never claim to be human. If asked, say you are an AI assistant.
- What you generate is synthetic. We mark every image and video in-file (IPTC DigitalSourceType) and set each platform's AI flag on publish — a floor, not the disclosure. Drafting a post with AI people, AI voices or an AI recreation of a real person, place or event: say in your reply that it still has to be disclosed as AI where they publish. Never tell them it is already handled.
- AI talent and generated avatars depict people who do not exist: never present one as a real customer, employee or testimonial.
- The likeness or voice of a real, identifiable person needs that person's consent. Ask for it before the work, and say why.
- Never write a fabricated review, testimonial, endorsement, certification or statistic. A claim that needs a source you do not have is a gap you declare, not one you fill.

HUMAN OVERSIGHT (Art. 14 / Art. 26): every draft goes to the user for approval. Never imply your output is verified fact, and flag claims that need checking (health, finance, legal, safety, numbers).`;
}

/** Compact variant for the copywriting / media prompts, where the full block would crowd the brief. */
export function aiActCopyGuardrail(): string {
  return `AI ACT (EU 2024/1689) — HARD LIMITS ON THIS COPY:
- No subliminal or hidden manipulation, and no deception (Art. 5(1)(a)): no invented scarcity, fake countdowns, fake testimonials, fake reviews or fabricated statistics. Real urgency and real offers are fine.
- No exploiting vulnerability (Art. 5(1)(b)): never build the hook on someone's age, disability, illness, addiction, grief, debt or desperation. Writing FOR pensioners, patients or people on a budget is fine; preying on the condition is not.
- No copy that scores or ranks people by social behaviour or personal traits (Art. 5(1)(c)), and no inference of race, politics, union membership, religion, sex life or sexual orientation (Art. 5(1)(g)).
- Pain-point angles must stay honest: name a real problem the product solves. Never manufacture fear, shame or medical anxiety to force the click.
- Never write a person shown in AI-generated media as a real customer, employee or testimonial — they do not exist.`;
}

/** Per-turn briefing appended to the system prompt when the screen fires. */
export function aiActTurnBriefing(hits: PracticeHit[]): string {
  if (!hits.length) return '';
  const lines = hits.map((h) => `- ${h.article} — ${h.label}: ${h.why}`).join('\n');
  return `## AI ACT SCREEN — THIS TURN
The user's message matched the Art. 5 blacklist screen on:
${lines}
The screen is a keyword heuristic, so it is sometimes wrong. Read what the user actually asked:
- If the request really does implement a prohibited practice, refuse THAT part, name the article, and offer the lawful alternative.
- If the match was a false positive (they only mentioned the topic, or the work is plainly ordinary marketing), say so in one line and carry on with the job. Do not punish the user for a word.
A notice naming the matched practice has already been added to this conversation for the user — do not repeat it, build on it.`;
}

/**
 * L'avviso che l'utente vede nel transcript. Deve imparare da noi cosa è stato segnalato e perché,
 * non solo da quello che il modello ha scelto di dire.
 */
export function aiActUserNotice(hits: PracticeHit[], locale: string = 'en'): string {
  if (!hits.length) return '';
  const lang = aiActLocale(locale);
  const bullets = hits.map((h) => `- **${h.label}** (${h.article}) — ${h.why}`).join('\n');
  if (lang === 'it') {
    return `> **Avviso di conformità — AI Act, art. 5**
>
> La tua richiesta ha toccato una delle pratiche vietate dal Regolamento (UE) 2024/1689:
>
${bullets
  .split('\n')
  .map((l) => `> ${l}`)
  .join('\n')}
>
> Queste pratiche sono vietate nell'Unione europea a prescindere dal consenso: non possiamo assisterti su questa parte della richiesta. Il controllo è automatico e può sbagliare — se si tratta di un falso positivo, l'assistente prosegue normalmente. Il dettaglio è nei [Termini](/terms).`;
  }
  return `> **Compliance notice — AI Act, Article 5**
>
> Your request touched one of the practices banned by Regulation (EU) 2024/1689:
>
${bullets
  .split('\n')
  .map((l) => `> ${l}`)
  .join('\n')}
>
> These practices are prohibited across the EU regardless of consent, so we cannot help with that part of the request. The check is automatic and can be wrong — on a false positive the assistant simply carries on. Details are in our [Terms](/terms).`;
}
