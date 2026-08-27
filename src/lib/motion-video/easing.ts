/**
 * LE CURVE DEL MOTION — expo in-out sempre, lineare mai.
 *
 * PERCHÉ SERVE UN MODULO E NON UNA RIGA DI PROMPT. La regola "mai linear" c'era già nelle craft
 * specs, e non è bastata, per una ragione che il prompt non poteva risolvere: in Remotion
 * `interpolate(frame, [a, b], [c, d])` SENZA il campo `easing` è lineare. Il modo più comune di
 * scrivere movimento lineare non è scrivere `Easing.linear` — è dimenticarsi l'opzione. Un modello
 * che ha letto "mai linear" e poi omette l'easing è convinto di aver obbedito, e il video esce con
 * quel movimento a velocità costante che si riconosce a occhio da un secondo di clip.
 *
 * Quindi la regola vive in tre posti che dicono la stessa cosa: le craft specs (il modello la
 * legge), il seed (il modello la copia), e `findLinearMotion` (il codice la verifica, e `finish`
 * la rifiuta). Le prime due sole sono già state provate.
 *
 * LA CURVA. Expo in-out: quasi piatta alle estremità, ripidissima in mezzo. È il contrario della
 * cubica timida — l'elemento parte lentissimo, attraversa lo schermo di scatto e si posa senza
 * frenata brusca. L'overshoot resta, ma è un ALTRO ruolo: la posa finale, sulle molle o su
 * un'entrata, non il sostituto della curva di percorrenza.
 *
 * Puro: nessun I/O, nessun clock, nessuna dipendenza da Remotion. Vive fuori da `$lib/server`
 * perché il seed e il pannello del codice lo leggono nel browser.
 */

/** I quattro numeri della bezier expo in-out. Una sola fonte per prompt, seed e messaggi. */
export const MOTION_EXPO_IN_OUT_POINTS = [0.87, 0, 0.13, 1] as const;

/** Come si scrive nel sorgente Remotion. */
export const MOTION_EXPO_IN_OUT = `Easing.bezier(${MOTION_EXPO_IN_OUT_POINTS.join(', ')})`;

/**
 * La curva dell'assestamento: sfonda il valore finale e rientra. Non sostituisce l'expo in-out —
 * si usa sull'ultima posa di un'entrata, dove serve il micro-rimbalzo che le specs chiamano
 * "settle". Le molle (`spring`) fanno lo stesso mestiere con damping basso.
 */
export const MOTION_OVERSHOOT_OUT = 'Easing.bezier(0.16, 1.18, 0.28, 1)';

export type EasingViolationKind =
  /** `interpolate(...)` senza il campo `easing`: in Remotion è lineare. */
  | 'missing_easing'
  /** `Easing.linear` scritto esplicitamente. */
  | 'explicit_linear';

export type EasingViolation = {
  kind: EasingViolationKind;
  /** Riga 1-based nel sorgente. */
  line: number;
  /** Il frammento incriminato, tagliato corto. */
  excerpt: string;
};

/**
 * Salta stringhe, template e commenti: `easing:` dentro una stringa non è un easing.
 * Esportata perché il gate sulla voce (voice-gate.ts) analizza lo stesso sorgente con le stesse
 * regole — e PRESERVA LA LUNGHEZZA (ogni carattere mascherato diventa uno spazio), quindi un
 * indice trovato nel sorgente originale vale anche qui.
 */
export function stripNonCode(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      // I newline restano: le righe non devono spostarsi.
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === quote) break;
        j++;
      }
      const stop = Math.min(src.length, j + 1);
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

/**
 * Trova il movimento lineare in un sorgente Remotion.
 *
 * Due casi, e il primo è quello che conta: `interpolate` senza `easing` (default lineare) e
 * `Easing.linear` esplicito. `interpolateColors` è escluso — non accetta easing e un colore che
 * transita linearmente non è il difetto che stiamo cercando.
 */
export function findLinearMotion(source: string): EasingViolation[] {
  const code = stripNonCode(source);
  const out: EasingViolation[] = [];

  for (const m of code.matchAll(/\binterpolate\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) continue; // parentesi non chiusa: è un problema di sintassi, non di easing
    const args = code.slice(open + 1, close);
    if (/\beasing\s*:/.test(args)) continue;
    out.push({
      kind: 'missing_easing',
      line: lineOf(code, m.index!),
      excerpt: source.slice(m.index!, Math.min(source.length, close + 1)).replace(/\s+/g, ' ').slice(0, 120)
    });
  }

  for (const m of code.matchAll(/\bEasing\s*\.\s*linear\b/g)) {
    out.push({
      kind: 'explicit_linear',
      line: lineOf(code, m.index!),
      excerpt: source.slice(m.index!, m.index! + 60).replace(/\s+/g, ' ')
    });
  }

  return out.sort((a, b) => a.line - b.line);
}

/* ------------------------------------------------------------------------------------------------
 * STASI — "nessuna scena deve essere statica, mai" (proprietario, 2026-08-21, dopo aver guardato
 * un trailer con 3 secondi di card finale congelata). La regola in prosa c'era già ("keep it alive
 * through the cut") e non è bastata, per la stessa ragione dell'easing: il modo comune di produrre
 * una scena ferma non è deciderlo — è far finire tutte le interpolate a metà beat. Quindi anche
 * questa regola vive nel codice: si leggono gli input range delle interpolate di ogni beat e si
 * misura il buco fra l'ultimo frame animato e la fine del beat (coda di transizione inclusa: in
 * TransitionSeries l'overlap sta DENTRO durationInFrames).
 *
 * ponytail: analisi su regex + mini-evaluator, non un AST. I limiti sono dichiarati e tutti nella
 * direzione del silenzio: un'espressione che non si risolve, un beat senza durata leggibile, un
 * figlio annidato con `from` — non si flagga. Meglio una stasi non vista che un FIX inventato.
 * Se un giorno serve precisione, il passo dopo è il piccolo interprete sul sorgente transpilato.
 * ---------------------------------------------------------------------------------------------- */

/** Oltre questo buco (in secondi) senza interpolate attive, la coda del beat è una scena ferma. */
export const MOTION_STASIS_MAX_GAP_S = 1.2;

export type StasisViolation = {
  /** Il componente del beat fermo. */
  component: string;
  /** Durata del beat in frame (risolta dal sorgente). */
  beatFrames: number;
  /** L'ultimo frame coperto da un input range di interpolate. */
  lastActiveFrame: number;
  /** beatFrames - lastActiveFrame. */
  gapFrames: number;
};

/** Valuta un'espressione numerica semplice (numeri, aritmetica, Math.round/floor/ceil/min/max/abs). */
export function resolveNumber(expr: string, consts: Map<string, number>): number | null {
  let e = expr.trim();
  for (let pass = 0; pass < 3; pass++) {
    e = e.replace(/\b[A-Za-z_$][\w$]*\b/g, (name) => {
      if (/^(?:Math|round|floor|ceil|min|max|abs)$/.test(name)) return name;
      const v = consts.get(name);
      return v == null ? name : String(v);
    });
  }
  if (!/^(?:[\d\s+\-*/().,]|Math\.(?:round|floor|ceil|min|max|abs))+$/.test(e)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const v = new Function('Math', `return (${e});`)(Math) as unknown;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Le `const NAME = expr;` numeriche del sorgente, risolte iterativamente (b2 = b1 + 0.5 * fps). */
export function collectConsts(code: string): Map<string, number> {
  const candidates: Array<[string, string]> = [];
  for (const m of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+?)\s*;/g)) {
    candidates.push([m[1], m[2]]);
  }
  const consts = new Map<string, number>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const [name, expr] of candidates) {
      if (consts.has(name)) continue;
      const v = resolveNumber(expr, consts);
      if (v != null) {
        consts.set(name, v);
        progress = true;
      }
    }
  }
  return consts;
}

type ComponentMotion = {
  /** Ultimo frame coperto da un input range risolto. */
  lastActive: number;
  /** Un input range che non si è risolto: il componente non è giudicabile. */
  unresolved: boolean;
  /** Ha almeno una interpolate (una scena senza NESSUNA interpolate è ferma per costruzione). */
  interpolates: number;
  /** I componenti figli renderizzati nel body (per accreditare il loro movimento al beat). */
  children: string[];
  body: string;
};

/** Gli input range delle interpolate di uno slice, col massimo risolto. */
function motionOfSlice(slice: string, consts: Map<string, number>): ComponentMotion {
  let lastActive = 0;
  let unresolved = false;
  let interpolates = 0;
  for (const m of slice.matchAll(/\binterpolate\s*\(/g)) {
    interpolates += 1;
    const open = m.index! + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < slice.length; i++) {
      if (slice[i] === '(') depth++;
      else if (slice[i] === ')') {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) {
      unresolved = true;
      continue;
    }
    const arr = slice.slice(open + 1, close).match(/\[([^\][]*)\]/);
    if (!arr) {
      unresolved = true;
      continue;
    }
    for (const entry of arr[1].split(',')) {
      const v = resolveNumber(entry, consts);
      if (v == null) unresolved = true;
      else if (v > lastActive) lastActive = v;
    }
  }
  const children = [...new Set([...slice.matchAll(/<([A-Z][\w$]*)[\s/>]/g)].map((m) => m[1]))];
  return { lastActive, unresolved, interpolates, children, body: slice };
}

/**
 * Il movimento di ogni componente del file, per nome. Lo slice di un componente va dalla sua
 * dichiarazione alla successiva dichiarazione top-level.
 */
function componentMotionMap(code: string, consts: Map<string, number>): Map<string, ComponentMotion> {
  const decls: Array<{ name: string; start: number }> = [];
  for (const m of code.matchAll(
    /(?:^|\n)(?:export\s+)?(?:default\s+)?(?:function\s+([A-Z][\w$]*)\s*\(|const\s+([A-Z][\w$]*)\s*(?::[^=\n]*)?=)/g
  )) {
    decls.push({ name: m[1] ?? m[2], start: m.index! });
  }
  decls.sort((a, b) => a.start - b.start);
  const motion = new Map<string, ComponentMotion>();
  for (let i = 0; i < decls.length; i++) {
    const end = i + 1 < decls.length ? decls[i + 1].start : code.length;
    motion.set(decls[i].name, motionOfSlice(code.slice(decls[i].start, end), consts));
  }
  return motion;
}

type GuardedBeat = {
  /** La variabile della guardia (`s2Active`) — è così che il modello ritrova il punto. */
  guard: string;
  component: string;
  startFrame: number;
  frames: number;
};

/**
 * LE BATTUTE MONTATE A MANO: `const s2Active = frame >= 82 && frame < 172` usata come
 * `{s2Active && <OldWayBeat />}`. È la forma in cui il modello scrive davvero quando il seme non
 * gli mette davanti delle `<Sequence>`, e la leggono due controlli — la stasi e le entrate morte.
 *
 * ponytail: solo le guardie a DUE lati. Una sola (`frame < 92` in apertura, `frame >= 436` in
 * chiusura) non dice dove finisce la scena senza indovinare, e qui un falso positivo rifiuta un
 * `finish` legittimo.
 */
function guardMountedBeats(
  code: string,
  consts: Map<string, number>,
  isLocalComponent: (name: string) => boolean,
  /**
   * La lunghezza della composizione. Passandola si leggono anche le guardie di CHIUSURA a un lato
   * solo (`frame >= 436`), la cui fine non è un'ipotesi: è la fine del video. È l'ultima battuta,
   * cioè la CTA — nel trailer 3,5 era il fermo immagine peggiore e nessuno lo vedeva.
   * Omessa: solo le guardie a due lati, com'era.
   */
  totalFrames?: number | null
): GuardedBeat[] {
  const spans = new Map<string, { startFrame: number; frames: number }>();
  for (const m of code.matchAll(
    /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*frame\s*(>=|>)\s*([\w$.]+)\s*&&\s*frame\s*(<=|<)\s*([\w$.]+)/g
  )) {
    const from = resolveNumber(m[3], consts);
    const to = resolveNumber(m[5], consts);
    if (from == null || to == null || to <= from) continue;
    const startFrame = m[2] === '>' ? from + 1 : from;
    const end = m[4] === '<=' ? to + 1 : to;
    spans.set(m[1], { startFrame, frames: end - startFrame });
  }

  if (totalFrames != null && totalFrames > 0) {
    // Il `;` subito dopo è ciò che distingue una guardia a un lato solo da metà di una a due lati.
    // L'apertura (`frame < 92`) non serve: parte da 0, dove locale e assoluto coincidono.
    for (const m of code.matchAll(
      /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*frame\s*(>=|>)\s*([\w$.]+)\s*;/g
    )) {
      if (spans.has(m[1])) continue;
      const from = resolveNumber(m[3], consts);
      if (from == null) continue;
      const startFrame = m[2] === '>' ? from + 1 : from;
      if (startFrame <= 0 || startFrame >= totalFrames) continue;
      spans.set(m[1], { startFrame, frames: totalFrames - startFrame });
    }
  }

  const out: GuardedBeat[] = [];
  for (const [guard, span] of spans) {
    // Fra la guardia e il componente ci può stare un wrapper (`<AbsoluteFill style={…}>`): si
    // prende il PRIMO tag maiuscolo dichiarato in QUESTO file — gli importati (AbsoluteFill, Img)
    // non sono locali e vengono saltati da soli.
    const re = new RegExp(String.raw`\{\s*` + guard + String.raw`\s*&&[\s\S]{0,400}?/>`, 'g');
    for (const hit of code.matchAll(re)) {
      for (const t of hit[0].matchAll(/<([A-Z][\w$]*)/g)) {
        if (!isLocalComponent(t[1])) continue;
        out.push({ guard, component: t[1], ...span });
        break;
      }
    }
  }
  return out;
}

/**
 * Trova i beat con la coda ferma: componenti ospitati in una `*.Sequence` con `durationInFrames`
 * risolvibile, le cui interpolate (proprie e dei figli diretti) finiscono tutte più di
 * {@link MOTION_STASIS_MAX_GAP_S} secondi prima della fine del beat.
 */
export function findStaticTails(source: string): StasisViolation[] {
  const code = stripNonCode(source);
  const consts = collectConsts(code);
  const fps = consts.get('fps') ?? 30;

  const motion = componentMotionMap(code, consts);

  // Beat = componente ospitato in una Sequence con durata leggibile.
  const hosted = new Map<string, number>(); // component -> worst (max) durata fra gli hosting
  const hostRe =
    /<(?:TransitionSeries\.Sequence|Series\.Sequence|Sequence)\b[^>]*?durationInFrames=\{([^}]+)\}[^>]*>[^<]*<([A-Z][\w$]*)/g;
  for (const m of code.matchAll(hostRe)) {
    const frames = resolveNumber(m[1], consts);
    if (frames == null || frames <= 0) continue;
    const prev = hosted.get(m[2]);
    if (prev == null || frames > prev) hosted.set(m[2], frames);
  }

  /**
   * LE SCENE SCRITTE A MANO, che è come il modello le scrive davvero.
   *
   * Sonda del 22/8/2026 sul trailer `c1b4fe72` (18s, bocciato 3,5 «kill», con dentro DUE SECONDI
   * DI NERO che il giudice ha nominato come anello più debole): quel sorgente non ha **nessun**
   * `<Sequence>`, di nessun tipo. Sono `<AbsoluteFill>` accesi da guardie nominate
   * (`const s2Active = frame >= 82 && frame < 172`) e usate come `{s2Active && <OldWayBeat />}`.
   *
   * Il `hostRe` qui sopra legge solo i tag, quindi su quel video `hosted` restava VUOTO e questa
   * funzione tornava `[]` senza guardare niente. Cioè: «nessuna scena deve essere statica, mai» —
   * il difetto numero due — non ha mai guardato la classe di video in cui il difetto era.
   * Un controllo che non riconosce la forma in cui il modello scrive è un controllo spento.
   *
   * ponytail: solo le guardie a DUE lati. Una sola (`frame < 92` in apertura, `frame >= 436` in
   * chiusura) non dice quanto dura la scena senza indovinare, e un falso positivo qui rifiuta un
   * `finish` legittimo — la politica di questo file è «range illeggibile = silenzio». Il passo
   * successivo, se le due estremità cominciano a scappare: chiuderle su `durationInFrames`, che
   * è già in `consts`.
   */
  if (!hosted.size) {
    for (const b of guardMountedBeats(code, consts, (n) => motion.has(n))) {
      const prev = hosted.get(b.component);
      if (prev == null || b.frames > prev) hosted.set(b.component, b.frames);
    }
  }

  const maxGap = Math.round(MOTION_STASIS_MAX_GAP_S * fps);
  const out: StasisViolation[] = [];
  for (const [name, beatFrames] of hosted) {
    const own = motion.get(name);
    if (!own) continue;
    // Il movimento dei figli DIRETTI conta per il beat (un beat che vive solo del suo <Cursor />
    // è comunque vivo). Un figlio dentro una Sequence annidata con `from` resta un'approssimazione
    // dichiarata: qui si somma il suo range così com'è.
    let lastActive = own.lastActive;
    let unresolved = own.unresolved;
    for (const child of own.children) {
      const c = motion.get(child);
      if (!c) continue;
      if (c.unresolved) unresolved = true;
      if (c.lastActive > lastActive) lastActive = c.lastActive;
    }
    // Conservativo: un range illeggibile rende il beat non giudicabile — niente falsi FIX.
    if (unresolved) continue;
    const gap = beatFrames - lastActive;
    if (gap > maxGap) {
      out.push({ component: name, beatFrames, lastActiveFrame: lastActive, gapFrames: gap });
    }
  }
  return out.sort((a, b) => b.gapFrames - a.gapFrames);
}

/* ------------------------------------------------------------------------------------------------
 * ENTRATE MORTE — il difetto che nessun cancello vedeva, e che è costato un 3,5.
 *
 * Sonda del 22/8/2026 sul trailer `c1b4fe72`. Il componente principale dichiara `s2Local = frame -
 * 82`, `s3Local`, `s4Local`, `s5Local`, `s6Local` — CINQUE variabili, NESSUNA usata — e monta le
 * battute come `{s2Active && <OldWayBeat />}`. Dentro `OldWayBeat`, `useCurrentFrame()` restituisce
 * il fotogramma ASSOLUTO (82…172), ma ogni interpolate è scritta su un range locale: `[0, 90]` per
 * la deriva, `[66, 90]` per il collasso, `[0, 14]` per l'etichetta. Al primo fotogramma della
 * battuta l'entrata è già finita e il collasso è già al 67%. `CtaEndCard` monta al 436 con range
 * `[0, 24]`: è un fermo immagine per tutti i suoi 3,5 secondi.
 *
 * Nessun controllo lo vedeva. `findLinearMotion` è verde (44 interpolate su 44 hanno l'easing).
 * `findStaticTails` confronta la DURATA della battuta (90) con l'ultimo range (90) e trova buco
 * zero: il codice si legge come corretto. `detectWowMechanisms` conta le battute e trova i
 * marcatori. Tutti i cancelli verdi, video rotto.
 *
 * E non nasce da un errore: nasce da un RIORDINO RAGIONEVOLE. Interpolare sul fotogramma assoluto
 * dentro UN SOLO componente è corretto; è la fattorizzazione — estrarre `OldWayBeat` perché è più
 * pulito — che la uccide. Per questo la correzione vera sta nel seme (`source.ts`, ora una
 * `<Series.Sequence>` per battuta: dentro una Sequence il tempo locale è vero per costruzione), e
 * questo controllo è la rete sotto, per i sorgenti scritti prima e per chi ci ricasca.
 * ---------------------------------------------------------------------------------------------- */

export type DeadEntranceViolation = {
  /** Il componente che riceve il fotogramma sbagliato. */
  component: string;
  /** La guardia che lo monta (`s2Active`) — è la stringa con cui il modello ritrova il punto. */
  guard: string;
  /** Il fotogramma a cui la battuta compare. */
  mountFrame: number;
  beatFrames: number;
  /** L'ultimo fotogramma coperto da un range del componente, letto come se fosse locale. */
  lastActiveFrame: number;
  /** La prima interpolate scritta in locale, per nome. Null quando non se ne isola una. */
  variable: string | null;
};

/** Il nome della prima `const X = interpolate(frame, [...])` dello slice. */
function firstLocalInterpolate(body: string): string | null {
  const m = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*interpolate\s*\(\s*frame\s*[,)]/.exec(body);
  return m ? m[1] : null;
}

/**
 * I componenti montati da una guardia sul fotogramma ASSOLUTO ma scritti in tempo LOCALE: quando
 * la scena compare, la sua animazione è già finita.
 *
 * La condizione è stretta di proposito: la battuta non parte da zero (a fotogramma 0 locale e
 * assoluto coincidono, non c'è niente da sbagliare) e OGNI range del componente sta dentro la
 * DURATA della battuta invece che dentro il suo intervallo assoluto. Un beat che monta al 82 con
 * range fino a 90 ha i suoi range interamente prima di esistere: è rotto, non è un'opinione.
 * Un componente scritto in assoluto — range `[82, 172]` — supera la durata (90) e non viene
 * toccato.
 *
 * ponytail: stessa politica del resto del file, il silenzio quando non si legge. Un range che non
 * si risolve, un componente senza nessuna interpolate, una guardia a un lato solo: nessuna
 * violazione. Un falso positivo qui rifiuta un `finish` legittimo e brucia una slice.
 */
export function findDeadEntrances(source: string): DeadEntranceViolation[] {
  const code = stripNonCode(source);
  const consts = collectConsts(code);
  const motion = componentMotionMap(code, consts);

  const out: DeadEntranceViolation[] = [];
  const seen = new Set<string>();
  const total = consts.get('durationInFrames') ?? null;
  for (const beat of guardMountedBeats(code, consts, (n) => motion.has(n), total)) {
    const own = motion.get(beat.component);
    if (!own || own.unresolved || own.interpolates === 0) continue;
    if (beat.startFrame <= 0 || own.lastActive <= 0) continue;
    if (own.lastActive > beat.frames) continue; // scritta in assoluto: corretta
    if (seen.has(beat.component)) continue;
    seen.add(beat.component);
    out.push({
      component: beat.component,
      guard: beat.guard,
      mountFrame: beat.startFrame,
      beatFrames: beat.frames,
      lastActiveFrame: own.lastActive,
      variable: firstLocalInterpolate(own.body)
    });
  }
  return out.sort((a, b) => b.mountFrame - a.mountFrame);
}

/** Il rifiuto in parole. Vuoto quando non c'è niente da dire. */
export function formatDeadEntrances(violations: DeadEntranceViolation[], max = 4): string {
  if (!violations.length) return '';
  const lines = violations
    .slice(0, max)
    .map(
      (v) =>
        `  ${v.component} (montato da ${v.guard}) compare al fotogramma ${v.mountFrame}, ma ${
          v.variable ? `\`${v.variable}\` e le altre interpolate finiscono` : 'le sue interpolate finiscono'
        } entro il ${v.lastActiveFrame} — sono scritte come se il tempo ripartisse da zero, e la scena appare ad animazione già finita`
    )
    .join('\n');
  const more = violations.length > max ? `\n  …e altre ${violations.length - max}` : '';
  return `${violations.length} battuta/e con l'ENTRATA MORTA: \`useCurrentFrame()\` dà il fotogramma ASSOLUTO a un componente montato da una guardia, non da una <Sequence>.\n${lines}${more}\nLa correzione è una sola e vale per tutte: monta ogni battuta in una <Series.Sequence durationInFrames={...}> — dentro una Sequence useCurrentFrame() riparte da 0 e il codice che hai già scritto diventa giusto.`;
}

/** La stasi in parole, per il rifiuto di finish e per il brief della QC. Vuoto = niente da dire. */
export function formatStasisViolations(violations: StasisViolation[], fps = 30, max = 4): string {
  if (!violations.length) return '';
  const lines = violations
    .slice(0, max)
    .map(
      (v) =>
        `  ${v.component}: ferma per gli ultimi ${(v.gapFrames / fps).toFixed(1)}s del beat (ultima interpolate al frame ${v.lastActiveFrame} su ${v.beatFrames})`
    )
    .join('\n');
  const more = violations.length > max ? `\n  …e altri ${violations.length - max} beat` : '';
  return `${violations.length} beat con la coda FERMA (nessuna interpolate attiva fino alla chiusura):\n${lines}${more}`;
}

/** Il rifiuto in parole, per il messaggio che torna all'agente. Vuoto quando non c'è niente da dire. */
export function formatEasingViolations(violations: EasingViolation[], max = 6): string {
  if (!violations.length) return '';
  const missing = violations.filter((v) => v.kind === 'missing_easing').length;
  const explicit = violations.length - missing;
  const head = [
    missing ? `${missing} interpolate senza easing (in Remotion è LINEARE)` : '',
    explicit ? `${explicit} Easing.linear esplicito` : ''
  ]
    .filter(Boolean)
    .join(' + ');
  const lines = violations
    .slice(0, max)
    .map((v) => `  riga ${v.line}: ${v.excerpt}`)
    .join('\n');
  const more = violations.length > max ? `\n  …e altre ${violations.length - max}` : '';
  return `${head}:\n${lines}${more}`;
}

/* ------------------------------------------------------------------------------------------------
 * IL CONTROLLO ARITMETICO — la somma delle scene non fa la durata della composizione.
 *
 * E' il difetto piu' contato nei giudizi di mestiere: 4 volte su 10. Nelle parole del giudice,
 * «the composition terminates into dead black frames because the Sequences are shorter than the
 * container», «2,5 secondi di vuoto nero, frame 410-485». Non e' un'opinione estetica e non serve
 * guardare un fotogramma per accorgersene: sono DUE NUMERI. `durationInFrames` dice quanto dura il
 * video; le scene montate dicono quanto e' coperto. Se il secondo e' piu' piccolo del primo, la
 * coda e' nera; se e' piu' grande, l'ultima scena viene tagliata a meta'.
 *
 * QUINDI NON E' UN CONSIGLIO, E' UN RIFIUTO. La regola in prosa («fai tornare i conti») c'era gia'
 * ed e' esattamente il tipo di regola che il modello legge e poi salta — come «mai linear» prima di
 * `findLinearMotion`.
 *
 * E DEVE LEGGERE ENTRAMBE LE FORME, o e' spento su meta' del parco. Sonda del 22/8/2026 su 24
 * sorgenti in produzione: 16 non contengono NESSUN tag `<Sequence>` di nessun tipo — sono
 * `<AbsoluteFill>` accesi da guardie nominate — e 8 usano `<TransitionSeries>` o `<Series>`. Un
 * controllo indicizzato solo sui tag e' gia' stato scritto due volte in questo file e due volte
 * era spento proprio dove il difetto viveva. Qui le forme lette sono quattro, in ordine di
 * precisione, e la quarta e' quella che copre i due terzi.
 *
 * ponytail: quando la copertura non si legge — un `offset` su una Series.Sequence, un timing di
 * transizione che dipende da una molla, una durata che non si risolve — si tace. Stessa politica
 * del resto del file: un falso positivo qui rifiuta un `finish` legittimo. E il buco in TESTA
 * (una prima scena che monta dopo il fotogramma 0) non e' guardato: il fondo della composizione
 * e' dipinto dall'AbsoluteFill che le avvolge, quindi non e' nero — e' vuoto, che e' il mestiere
 * di `findStaticTails`. Se un giorno servisse, i numeri per farlo sono gia' tutti qui.
 * ---------------------------------------------------------------------------------------------- */

/**
 * Quanto scarto si perdona, in secondi. Non e' tolleranza estetica: e' l'ARROTONDAMENTO. Una
 * composizione di sei battute scritte come `Math.round(2.1 * fps)` accumula qualche fotogramma di
 * differenza contro un totale calcolato in secondi, ed e' aritmetica corretta. 0,25 s sta un
 * ordine di grandezza sopra quel rumore e un ordine sotto il difetto misurato (2,5 s di nero).
 */
export const MOTION_DURATION_MAX_GAP_S = 0.25;

export type DurationMismatch = {
	/** Il `durationInFrames` esportato dalla composizione. */
	totalFrames: number;
	/** I fotogrammi davvero coperti dalle scene montate. */
	coveredFrames: number;
	/** total - covered. Positivo: coda morta. Negativo: l'ultima scena viene tagliata. */
	gapFrames: number;
	/** Da quale forma di sorgente e' stata letta la copertura. */
	form: 'transition-series' | 'series' | 'sequence' | 'guards';
};

/** La somma dei `durationInFrames={...}` dei tag che corrispondono, o null se uno non si legge. */
function sumSequenceDurations(code: string, tag: string, consts: Map<string, number>): number | null {
	let total = 0;
	let found = false;
	const re = new RegExp(String.raw`<${tag}\b([^>]*)>`, 'g');
	for (const m of code.matchAll(re)) {
		const attrs = m[1];
		// `offset` sposta la battuta rispetto alla precedente: leggibile, ma raro e facile da
		// sbagliare. Si tace invece di indovinare.
		if (/\boffset\s*=/.test(attrs)) return null;
		const d = /\bdurationInFrames\s*=\s*\{([^}]+)\}/.exec(attrs);
		if (!d) return null;
		const v = resolveNumber(d[1], consts);
		if (v == null || v <= 0) return null;
		total += v;
		found = true;
	}
	return found ? total : null;
}

/**
 * I due numeri della composizione: quanto dura, e quanto e' coperto. `null` quando uno dei due non
 * si legge — che in questo file vuol dire «nessuna violazione», mai «probabilmente rotto».
 */
export function findDurationMismatch(source: string): DurationMismatch | null {
	const code = stripNonCode(source);
	const consts = collectConsts(code);
	const totalFrames = consts.get('durationInFrames');
	const fps = consts.get('fps') ?? 30;
	if (totalFrames == null || totalFrames <= 0) return null;

	let covered: number | null = null;
	let form: DurationMismatch['form'] = 'guards';

	if (/<TransitionSeries\b/.test(code)) {
		// In una TransitionSeries la durata totale e' la SOMMA delle battute MENO le transizioni:
		// i fotogrammi dell'overlap appartengono a entrambe le scene e si contano una volta sola.
		// E' l'errore aritmetico piu' facile da fare in questa forma.
		const beats = sumSequenceDurations(code, 'TransitionSeries\\.Sequence', consts);
		if (beats != null) {
			let overlap = 0;
			let readable = true;
			const tRe = /<TransitionSeries\.Transition\b([\s\S]*?)\/>/g;
			for (const t of code.matchAll(tRe)) {
				const d = /\bdurationInFrames\s*:\s*([^,}\n]+)/.exec(t[1]);
				const v = d ? resolveNumber(d[1], consts) : null;
				// Un `springTiming` senza `durationInFrames` calcola la durata dalla molla: da qui
				// non e' leggibile, quindi tutta la composizione non e' giudicabile.
				if (v == null || v <= 0) {
					readable = false;
					break;
				}
				overlap += v;
			}
			if (readable) {
				covered = beats - overlap;
				form = 'transition-series';
			}
		}
	}

	if (covered == null && /<Series\.Sequence\b/.test(code)) {
		const beats = sumSequenceDurations(code, 'Series\\.Sequence', consts);
		if (beats != null) {
			covered = beats;
			form = 'series';
		}
	}

	if (covered == null && /<Sequence\b/.test(code)) {
		// `<Sequence>` sciolte: si sovrappongono a piacere, quindi la copertura e' il massimo di
		// `from + durationInFrames`, non la somma.
		let max = 0;
		let readable = false;
		for (const m of code.matchAll(/<Sequence\b([^>]*)>/g)) {
			const attrs = m[1];
			const d = /\bdurationInFrames\s*=\s*\{([^}]+)\}/.exec(attrs);
			if (!d) return null;
			const dur = resolveNumber(d[1], consts);
			if (dur == null || dur <= 0) return null;
			const f = /\bfrom\s*=\s*\{([^}]+)\}/.exec(attrs);
			const from = f ? resolveNumber(f[1], consts) : 0;
			if (from == null) return null;
			max = Math.max(max, from + dur);
			readable = true;
		}
		if (readable) {
			covered = max;
			form = 'sequence';
		}
	}

	if (covered == null) {
		// LE BATTUTE MONTATE A MANO, che sono 16 sorgenti su 24: `const s4Active = frame >= 300 &&
		// frame < 410` usata come `{s4Active && <Beat />}`. La copertura e' la fine dell'ultima
		// guardia — ed e' esattamente li' che il nero di 2,5 secondi e' stato misurato.
		const motion = componentMotionMap(code, consts);
		const beats = guardMountedBeats(code, consts, (n) => motion.has(n), totalFrames);
		if (!beats.length) return null;
		covered = Math.max(...beats.map((b) => b.startFrame + b.frames));
		form = 'guards';
	}

	const gapFrames = totalFrames - covered;
	if (Math.abs(gapFrames) <= Math.round(MOTION_DURATION_MAX_GAP_S * fps)) return null;
	return { totalFrames, coveredFrames: covered, gapFrames, form };
}

/** Il rifiuto in parole, con i due numeri e la correzione. Vuoto quando i conti tornano. */
export function formatDurationMismatch(m: DurationMismatch | null, fps = 30): string {
	if (!m) return '';
	const secs = (Math.abs(m.gapFrames) / fps).toFixed(1);
	if (m.gapFrames > 0) {
		return `LA COMPOSIZIONE FINISCE NEL NERO: durationInFrames = ${m.totalFrames}, ma le scene montate coprono ${m.coveredFrames} fotogrammi. Gli ultimi ${m.gapFrames} (${secs}s, dal fotogramma ${m.coveredFrames} alla fine) non hanno niente sopra. Correzione: porta durationInFrames a ${m.coveredFrames}, oppure allunga l'ultima battuta di ${m.gapFrames} fotogrammi. Non e' un giudizio: sono due numeri.`;
	}
	return `L'ULTIMA SCENA VIENE TAGLIATA: le scene montate coprono ${m.coveredFrames} fotogrammi ma durationInFrames = ${m.totalFrames}. Gli ultimi ${-m.gapFrames} (${secs}s) non vengono mai renderizzati. Correzione: porta durationInFrames a ${m.coveredFrames}, oppure accorcia le battute.${m.form === 'transition-series' ? ' In una <TransitionSeries> la durata totale e\' la somma delle battute MENO le transizioni: i fotogrammi dell\'overlap si contano una volta sola.' : ''}`;
}

/* ------------------------------------------------------------------------------------------------
 * IL FONDALE CONGELATO — «non usare image bg full viewport se queste sono UI, non aggiungere
 * elementi programmatici sopra a immagini statiche di UI» (proprietario, 22/8/2026).
 *
 * IL DIFETTO. Si prende uno screenshot dell'interfaccia, lo si mette a tutta tela come fondale, e
 * sopra ci si appiccicano elementi animati. Il risultato è morto e si vede: il fondo è fermo, la
 * roba sopra galleggia, e nessuna delle due cose è il prodotto. Nei giudizi di mestiere
 * «screenshot letterboxed» e «card letterboxed» tornano più volte, ed è l'anello debole del video
 * peggiore mai valutato (3,5, unico `kill`). Sui post statici lo stesso vizio: il 47,9% dei prompt
 * chiede UI o mockup, e il 25,1% delle review si lamenta di device finti.
 *
 * COSA QUESTO CONTROLLO NON PUÒ FARE, dichiarato: **distinguere una UI da una fotografia**. Tutti
 * i media di questo prodotto finiscono nello stesso bucket `media`, con lo stesso tipo di URL —
 * uno screenshot di `capture_website` e una foto di `generate_image` sono indistinguibili dal
 * sorgente. Un controllo che provasse a indovinarlo sarebbe largo, darebbe falsi allarmi, e
 * finirebbe spento come i due cancelli che indicizzavano su un tag che metà dei sorgenti non ha.
 *
 * QUINDI SI CONTROLLA LA METÀ CERTA, che è anche quella che porta il difetto: **il fondale non si
 * muove**. Un `<Img>` o un `<Video>` a tutta tela — figlio diretto di un `<AbsoluteFill>` — il cui
 * stile non dipende da nessuna espressione calcolata è un fermo immagine su cui galleggia il
 * resto, che sia una UI o un paesaggio. È la regola «nessuna scena statica, mai» applicata
 * all'unico elemento che `findStaticTails` non può vedere: un tag `<Img>` non contiene interpolate.
 *
 * E il verso positivo, che è quello che il modello può eseguire: se il prodotto va mostrato, il
 * movimento accade DENTRO l'interfaccia — elementi veri in un layout vero che si muovono — non
 * come decorazione sopra a una fotografia dell'interfaccia. Un divieto si dimentica, un meccanismo
 * si esegue: la stessa lezione delle molle.
 *
 * ponytail: la forma riconosciuta è una sola, `<AbsoluteFill …><Img …/>`, che è come il fondale a
 * tutta tela si scrive qui (il ricettario compreso). Un `<Img>` dentro una card dimensionata non è
 * un fondale e non viene toccato — è la ragione per cui le voci di `posts/`, che hanno un `<Img>`
 * al 100% dentro ogni card, restano verdi. Il costo dichiarato: un fondale scritto in un'altra
 * forma non si vede. Meglio muto che rumoroso.
 * ---------------------------------------------------------------------------------------------- */

export type FrozenBackplate = {
	/** `Img` o `Video`. */
	tag: string;
	/** Riga 1-based del tag nel sorgente. */
	line: number;
	/** Il frammento, tagliato corto. */
	excerpt: string;
};

/**
 * I fondali a tutta tela che non si muovono per tutto il tempo in cui stanno a schermo.
 *
 * «Si muove» vuol dire: nello stile del tag c'è un'espressione calcolata — una concatenazione
 * (`'scale(' + zoom + ')'`) oppure un `opacity`/`transform`/`filter` legato a un identificatore
 * invece che a un letterale. È il modo in cui il movimento si scrive in Remotion, e coincide con
 * ciò che fa la ricetta SCRIM_PLATE (che ha il suo ken burns e quindi non viene mai toccata).
 */
export function findFrozenBackplate(source: string): FrozenBackplate[] {
	const code = stripNonCode(source);
	const out: FrozenBackplate[] = [];
	// `<AbsoluteFill …>` seguito subito da `<Img …/>`: la forma del fondale a tutta tela.
	const re = /<AbsoluteFill\b[^>]*>\s*<(Img|Video)\b([^>]*?)\/>/g;
	for (const m of code.matchAll(re)) {
		const attrs = m[2];
		const style = /\bstyle\s*=\s*\{\{([\s\S]*?)\}\}/.exec(attrs);
		const s = style ? style[1] : '';
		// Un'espressione calcolata: concatenazione, oppure una proprietà di movimento il cui valore
		// non è un letterale (`opacity: fade`, `transform: t`, `filter: blurNow`).
		const animated =
			/\+/.test(s) ||
			/\b(?:opacity|transform|filter)\s*:\s*(?!['"\d])[A-Za-z_$]/.test(s) ||
			/\bstyle\s*=\s*\{[A-Za-z_$]/.test(attrs); // stile passato per variabile: non giudicabile
		if (animated) continue;
		const at = m.index! + m[0].indexOf('<' + m[1]);
		out.push({
			tag: m[1],
			line: lineOf(code, at),
			excerpt: source.slice(at, Math.min(source.length, at + 140)).replace(/\s+/g, ' ')
		});
	}
	return out;
}

/** Il rifiuto in parole, col verso positivo davanti. Vuoto quando non c'è niente da dire. */
export function formatFrozenBackplate(violations: FrozenBackplate[], max = 3): string {
	if (!violations.length) return '';
	const lines = violations
		.slice(0, max)
		.map((v) => `  riga ${v.line}: ${v.excerpt.slice(0, 120)}`)
		.join('\n');
	const more = violations.length > max ? `\n  …e altri ${violations.length - max}` : '';
	return `${violations.length} FONDALE/I CONGELATO/I: un <Img>/<Video> a tutta tela dentro un <AbsoluteFill>, con lo stile fatto di soli valori fissi — non si muove per l'intera battuta, e tutto quello che gli sta sopra galleggia.\n${lines}${more}\nSe è una FOTOGRAFIA: dalle un movimento suo (un ken burns lento, \`transform: 'scale(' + zoom + ')'\` con expo in-out, che arrivi fino all'ultimo fotogramma della battuta) — è la forma della ricetta SCRIM_PLATE.\nSe è un'INTERFACCIA: non va usata come fondale. Ricostruiscila in TSX e fai accadere il movimento DENTRO di lei — il cursore che arriva su un controllo, il campo che si compila, la tabella che si riordina — invece di appiccicare elementi animati sopra alla sua fotografia. Una UI ferma con roba che galleggia sopra non mostra il prodotto: mostra uno screenshot.`;
}
