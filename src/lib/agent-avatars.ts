// Facce SVG minime per gli agenti custom: un cerchio a tinta piatta con un paio di tratti sopra.
// Le usano il picker client e il parser server, quindi niente dipendenze. Il rendering sta in
// $lib/components/AgentAvatar.svelte.

export const AGENT_AVATAR_FACES = [
  'wide',
  'dot',
  'wink',
  'sleepy',
  'squint',
  'curious',
  'smile',
  'grin',
  'happy',
  'laugh',
  'sad',
  'visor',
  'focus',
  'surprise'
] as const;

export type AgentAvatarFace = (typeof AGENT_AVATAR_FACES)[number];

export const DEFAULT_AGENT_AVATAR_FACE: AgentAvatarFace = 'wide';
export const DEFAULT_AGENT_AVATAR_COLOR = '#111111';

/**
 * Campioni offerti dal picker. C'è UN solo disegno, in inchiostro neutro — il colore è CSS, e l'hex
 * è ciò che si salva — quindi la palette può essere larga quanto si vuole. Ogni altro hex valido è
 * comunque accettato.
 */
export const AGENT_AVATAR_COLORS = [
  // neutrals
  '#111111',
  '#3f3f46',
  '#64748b',
  '#94a3b8',
  // deep
  '#7f1d1d',
  '#9a3412',
  '#854d0e',
  '#14532d',
  '#155e75',
  '#1e3a8a',
  '#4c1d95',
  '#831843',
  // mid
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#10b981',
  '#06b6d4',
  '#0ea5e9',
  '#2563eb',
  '#6366f1',
  '#8b5cf6',
  '#d946ef',
  '#ec4899',
  // light
  '#fca5a5',
  '#fdba74',
  '#fde047',
  '#86efac',
  '#67e8f9',
  '#93c5fd',
  '#c4b5fd',
  '#f9a8d4'
] as const;

const HEX = /^#[0-9a-f]{6}$/i;

/** Stable 32-bit-ish hash so a row without an avatar always renders the same face. */
function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Face for rows saved before avatars existed: derived from the row id, not random. */
export function fallbackAvatarFace(seed: string | null | undefined): AgentAvatarFace {
  if (!seed) return DEFAULT_AGENT_AVATAR_FACE;
  return AGENT_AVATAR_FACES[hash(seed) % AGENT_AVATAR_FACES.length];
}

/** Colour for rows saved before avatars existed: derived from the row id. */
export function fallbackAvatarColor(seed: string | null | undefined): string {
  if (!seed) return DEFAULT_AGENT_AVATAR_COLOR;
  return AGENT_AVATAR_COLORS[hash(seed + ':c') % AGENT_AVATAR_COLORS.length];
}

export function normalizeAvatarFace(
  raw: unknown,
  fallback: AgentAvatarFace = DEFAULT_AGENT_AVATAR_FACE
): AgentAvatarFace {
  const id = String(raw ?? '')
    .trim()
    .toLowerCase();
  return (AGENT_AVATAR_FACES as readonly string[]).includes(id)
    ? (id as AgentAvatarFace)
    : fallback;
}

export function normalizeAvatarColor(raw: unknown, fallback = DEFAULT_AGENT_AVATAR_COLOR): string {
  const value = String(raw ?? '').trim();
  return HEX.test(value) ? value.toLowerCase() : fallback;
}

/** Perceived brightness of a hex, 0 (black) to 1 (white). */
export function avatarLuminance(color: string): number {
  const hex = normalizeAvatarColor(color);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Features read badly on pale fills — flip them to ink once the circle is light. */
export function avatarFeatureColor(color: string): string {
  return avatarLuminance(color) > 0.68 ? '#111111' : '#ffffff';
}

function blend(color: string, toward: number, amount: number): string {
  const hex = normalizeAvatarColor(color);
  const channels = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(v + (toward - v) * amount);
  });
  return '#' + channels.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Tiene visibile un colore salvato contro la pagina su cui atterra: una palla quasi nera sparisce
 * sul canvas scuro (`--paper` in dark è #111, esattamente il campione di default) e una quasi
 * bianca su quello chiaro. L'hex salvato non cambia mai: cambia solo ciò che si dipinge.
 */
export function adaptAvatarColor(color: string, dark: boolean): string {
  const lum = avatarLuminance(color);
  if (dark && lum < 0.18) return blend(color, 255, 0.88);
  if (!dark && lum > 0.93) return blend(color, 0, 0.82);
  return normalizeAvatarColor(color);
}

/**
 * Geometria delle facce. Le coordinate sono lunghezze d'arco sulla superficie della palla, misurate
 * dal punto rivolto a chi guarda (y verso il basso), NON offset piatti sullo schermo: le forme si
 * disegnano come se la palla fosse srotolata, e decalTransform() le riavvolge.
 */
export type AvatarFeature =
  | { kind: 'capsule'; x: number; y: number; w: number; h: number; tilt?: number }
  | { kind: 'dot'; x: number; y: number; r: number }
  | { kind: 'arc'; x: number; y: number; w: number; h: number; up?: boolean; weight?: number };

export type AvatarFaceSpec = {
  /** Turn of the head, always to the right: carries the face around toward that limb. */
  yaw: number;
  /** Roll around the view axis — the ball is tipped, not the drawing. */
  roll: number;
  features: AvatarFeature[];
};

export const AVATAR_FACE_SPECS: Record<AgentAvatarFace, AvatarFaceSpec> = {
  wide: {
    yaw: 7.8,
    roll: 5,
    features: [
      { kind: 'dot', x: -6.4, y: -3.4, r: 4.4 },
      { kind: 'dot', x: 6.4, y: -3.4, r: 4.4 }
    ]
  },
  dot: {
    yaw: 8.2,
    roll: 4,
    features: [
      { kind: 'dot', x: -5.8, y: -2.2, r: 2.7 },
      { kind: 'dot', x: 5.8, y: -2.2, r: 2.7 }
    ]
  },
  wink: {
    yaw: 6.6,
    roll: 5,
    features: [
      { kind: 'capsule', x: -5.8, y: -3, w: 7.4, h: 3.3 },
      { kind: 'dot', x: 5.8, y: -3, r: 4 }
    ]
  },
  sleepy: {
    yaw: 7.6,
    roll: 5,
    features: [
      { kind: 'capsule', x: -5.9, y: -2.6, w: 7.8, h: 3.3 },
      { kind: 'capsule', x: 5.9, y: -2.6, w: 7.8, h: 3.3 }
    ]
  },
  smile: {
    yaw: 7,
    roll: 4,
    features: [
      { kind: 'dot', x: -5.8, y: -4.8, r: 3.1 },
      { kind: 'dot', x: 5.8, y: -4.8, r: 3.1 },
      { kind: 'arc', x: 0, y: 4.2, w: 12, h: 3.4, weight: 3 }
    ]
  },
  happy: {
    yaw: 7.8,
    roll: 5,
    features: [
      { kind: 'arc', x: -5.8, y: -2.6, w: 7.6, h: 3.6, up: true, weight: 3 },
      { kind: 'arc', x: 5.8, y: -2.6, w: 7.6, h: 3.6, up: true, weight: 3 }
    ]
  },
  visor: {
    yaw: 6.2,
    roll: 4,
    features: [{ kind: 'capsule', x: 0, y: -2.6, w: 18, h: 8.4 }]
  },
  surprise: {
    yaw: 8,
    roll: 5,
    features: [
      { kind: 'dot', x: -5.6, y: -5.2, r: 2.9 },
      { kind: 'dot', x: 5.6, y: -5.2, r: 2.9 },
      { kind: 'dot', x: 0.4, y: 4.6, r: 3.2 }
    ]
  },
  /** Eyes narrowed and tilted toward each other — reading you, not sleeping. */
  squint: {
    yaw: 7.4,
    roll: 5,
    features: [
      { kind: 'capsule', x: -5.9, y: -2.8, w: 6.8, h: 3.2, tilt: -24 },
      { kind: 'capsule', x: 5.9, y: -2.8, w: 6.8, h: 3.2, tilt: 24 }
    ]
  },
  /** One eye wide, one small, head tipped further: the look of a question. */
  curious: {
    yaw: 7.6,
    roll: 9,
    features: [
      { kind: 'dot', x: -6.2, y: -3.2, r: 4.6 },
      { kind: 'dot', x: 6.2, y: -3.2, r: 2.6 }
    ]
  },
  /** Open mouth, wide: the grin that shows teeth. */
  grin: {
    yaw: 7.2,
    roll: 4,
    features: [
      { kind: 'dot', x: -5.8, y: -4.6, r: 2.9 },
      { kind: 'dot', x: 5.8, y: -4.6, r: 2.9 },
      { kind: 'capsule', x: 0.2, y: 4.8, w: 10.6, h: 6 }
    ]
  },
  /** Eyes squeezed shut over an open mouth — happy, but louder. */
  laugh: {
    yaw: 7.4,
    roll: 5,
    features: [
      { kind: 'arc', x: -5.8, y: -4.8, w: 7.4, h: 3.4, up: true, weight: 3 },
      { kind: 'arc', x: 5.8, y: -4.8, w: 7.4, h: 3.4, up: true, weight: 3 },
      { kind: 'dot', x: 0.4, y: 5, r: 3.4 }
    ]
  },
  /** The smile turned over. Kept for errors and empty hands. */
  sad: {
    yaw: 7,
    roll: 4,
    features: [
      { kind: 'dot', x: -5.8, y: -3.6, r: 3 },
      { kind: 'dot', x: 5.8, y: -3.6, r: 3 },
      { kind: 'arc', x: 0, y: 6.2, w: 11, h: 3.2, up: true, weight: 3 }
    ]
  },
  /** The visor narrowed to a slit — the same machine, concentrating. */
  focus: {
    yaw: 6.4,
    roll: 4,
    features: [{ kind: 'capsule', x: 0, y: -2.6, w: 17, h: 4.4 }]
  }
};

/**
 * Sentinella di colore: invece di un hex, l'inchiostro del tema — palla quasi nera con occhi
 * chiari in chiaro, e l'inverso in scuro, dove una palla #111 sparirebbe nella pagina. Solo un
 * valore di rendering: in database c'è sempre un hex.
 */
export const THEME_AVATAR_COLOR = 'theme';

/**
 * L'agente Anomalia: un avatar fisso, uguale ovunque nell'app. È la sua identità, come il marchio
 * del brand, e come quello segue il tema invece di scegliere un lato.
 */
export const DEFAULT_CHAT_AGENT_AVATAR: { face: AgentAvatarFace; color: string } = {
  face: 'wide',
  color: THEME_AVATAR_COLOR
};

/**
 * Facce degli agenti builtin, per il picker del composer. Fisse, non derivate: sono identità.
 */
export const BUILTIN_AGENT_AVATARS: Record<string, { face: AgentAvatarFace; color: string }> = {
  // `auto` è Anomalia: resta in tinta col tema, è l'unico neutro. Le chiavi devono essere gli id
  // VERI degli agenti (`$lib/server/chat/agents.ts`): con chiavi vecchie ogni agente ricade
  // sull'avatar di `auto` — cinque facce identiche in tutto il prodotto.
  auto: DEFAULT_CHAT_AGENT_AVATAR,
  content: { face: 'smile', color: '#f97316' },
  ugc: { face: 'happy', color: '#ec4899' },
  motion: { face: 'visor', color: '#8b5cf6' },
  analyst: { face: 'focus', color: '#10b981' },
  web: { face: 'dot', color: '#2563eb' }
};

const R = 20;
const CENTRE = 20;
/** Never let a feature wrap past this angle from the viewer, or it slides off the limb. */
const MAX_ANGLE = 1.15;

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Avvolge un tratto sulla palla e lo riproietta ortograficamente. Il punto di superficie sta a
 * `hypot(x, y)` di arco dal polo rivolto a chi guarda, e la matrice è la proiezione del suo piano
 * tangente: schiaccia la forma nella direzione che si allontana dal centro e la inclina verso
 * l'asse. Così un occhio che deriva verso il bordo si stringe e si piega da solo — è tutto il
 * motivo per cui un cerchio a tinta piatta legge come una sfera.
 */
export function decalTransform(x: number, y: number, tilt = 0): string {
  const rho = Math.hypot(x, y);
  const angle = Math.min(rho / R, MAX_ANGLE);
  const k = rho === 0 ? 0 : Math.sin(angle) / rho;
  const u = x * k;
  const v = y * k;
  const w = Math.cos(angle);
  const nv = Math.sqrt(Math.max(1 - v * v, 1e-4));

  const m =
    `matrix(${round(w / nv)} 0 ${round(-(u * v) / nv)} ${round(nv)} ` +
    `${round(CENTRE + R * u)} ${round(CENTRE + R * v)})`;
  return tilt ? `${m} rotate(${tilt})` : m;
}

/** Path for an arc feature, drawn around its own origin. */
export function arcPath(f: { w: number; h: number; up?: boolean }): string {
  const x = f.w / 2;
  const y = f.h / 2;
  return f.up
    ? `M ${round(-x)} ${round(y)} Q 0 ${round(-y * 2.2)} ${round(x)} ${round(y)}`
    : `M ${round(-x)} ${round(-y)} Q 0 ${round(y * 2.2)} ${round(x)} ${round(-y)}`;
}

/**
 * Come la faccia dell'agente segue la conversazione: waiting → sent → thinking → writing, e
 * ritorno.
 */
export type ChatFacePhase = 'idle' | 'sent' | 'thinking' | 'writing' | 'error';

export const CHAT_FACE_BY_PHASE: Record<ChatFacePhase, AgentAvatarFace> = {
  idle: 'wide',
  sent: 'happy',
  thinking: 'wink',
  writing: 'smile',
  error: 'sad'
};

/**
 * A riposo la faccia è quella DELL'AGENTE, non una neutra uguale per tutti: con `idle` fisso a
 * 'wide', Motion e Analyst si presentavano con la faccia di Anomalia finché non partiva un turno.
 * Le altre fasi restano condivise: cambia il tono del turno, non chi lo sta facendo.
 */
export function chatFaceForPhase(
  phase: ChatFacePhase,
  resting?: AgentAvatarFace | string | null
): AgentAvatarFace {
  if (phase === 'idle' && resting) return normalizeAvatarFace(resting, CHAT_FACE_BY_PHASE.idle);
  return CHAT_FACE_BY_PHASE[phase] ?? CHAT_FACE_BY_PHASE.idle;
}

/**
 * Loop suonato accanto a "thinking"/"generating" mentre un turno gira. Movimenti piccoli — due
 * battiti di ciglia, uno sguardo di lato — così legge come qualcuno che aspetta con te, non che
 * parla. La faccia è lo spinner.
 */
export const LOADING_FACE_CYCLE: AgentAvatarFace[] = [
  'wide',
  'happy',
  'dot',
  'smile',
  'wink',
  'visor',
  'squint',
  'curious'
];

/**
 * Quanto ogni faccia del loop resta in posa prima del morph. Col morph (~420ms di transizione vera)
 * il ritmo giusto è lento: la posa deve leggersi come un'espressione, non come uno sfarfallio.
 */
export const LOADING_FACE_MS = 2400;

/**
 * La faccia del loop di caricamento a un dato istante. Pura, quindi `agent-avatars.cycle.test.ts`
 * pinna il ciclo senza timer.
 */
export function loadingFaceAt(elapsedMs: number): AgentAvatarFace {
  const i = Math.floor(Math.max(0, elapsedMs) / LOADING_FACE_MS) % LOADING_FACE_CYCLE.length;
  return LOADING_FACE_CYCLE[i]!;
}

/**
 * Facce per una lista di chat: una calma a riposo, una più viva sotto il cursore. Derivate dall'id
 * della riga, così la sidebar porta una gamma di espressioni e ogni riga tiene le sue.
 */
const REST_FACES: AgentAvatarFace[] = ['wide', 'dot', 'sleepy', 'visor', 'squint', 'focus', 'curious'];
const HOVER_FACES: AgentAvatarFace[] = ['happy', 'smile', 'wink', 'surprise', 'grin', 'laugh'];

export function restingFaceFor(seed: string | null | undefined): AgentAvatarFace {
  if (!seed) return REST_FACES[0];
  return REST_FACES[hash(seed) % REST_FACES.length];
}

export function hoverFaceFor(seed: string | null | undefined): AgentAvatarFace {
  if (!seed) return HOVER_FACES[0];
  return HOVER_FACES[hash(seed + ':h') % HOVER_FACES.length];
}

/**
 * Il repertorio dell'attesa. `loadingFaceAt` è un metronomo (otto pose, stesso ordine, ogni 2.4s):
 * va bene per una riga di sidebar, non per l'avatar GRANDE che si guarda mentre si aspetta. Qui il
 * ritmo è irregolare, con ogni tanto una mossa vistosa, e cambia con la durata dell'attesa — prima
 * guarda e basta, poi si dà da fare, dopo il minuto si annoia.
 *
 * Pura e deterministica su (seed, step): il seme nasce al mount, i test la pinnano senza timer.
 * Il timer sta in AgentAvatar (`alive`).
 */
// `spin` (la giravolta di 360°) è stata tolta: dentro una riga da 28px legge come uno spinner, ed
// è la sola mossa che interrompe lo sguardo invece di accompagnarlo.
export type AvatarMove = 'nod' | 'tilt' | 'stretch';
export type AvatarBeat = { face: AgentAvatarFace; move: AvatarMove | null; holdMs: number };

type AlivePhase = {
  /** Fino a quanti ms di attesa vale questa fase. */
  until: number;
  faces: AgentAvatarFace[];
  moves: AvatarMove[];
  /** Probabilità che il battito porti anche una mossa grande. */
  chance: number;
  /** Durata della posa, [min, max] in ms. */
  hold: [number, number];
};

const ALIVE_PHASES: AlivePhase[] = [
  // Attento: ti ha appena sentito. Pose sveglie, cambi lenti, zero acrobazie.
  {
    until: 9000,
    faces: ['wide', 'dot', 'curious', 'focus', 'squint'],
    moves: [],
    chance: 0,
    hold: [1800, 3400]
  },
  // Occupato: sta lavorando davvero. Repertorio pieno, e ogni tanto una mossa.
  {
    until: 40000,
    faces: ['wide', 'dot', 'smile', 'wink', 'curious', 'focus', 'happy', 'visor'],
    moves: ['nod', 'tilt', 'stretch'],
    chance: 0.28,
    hold: [1200, 2800]
  },
  // Annoiato: è lunga. Occhi socchiusi, pause più lunghe, e si sgranchisce più spesso.
  {
    until: Infinity,
    faces: ['sleepy', 'visor', 'squint', 'dot', 'wide', 'wink'],
    moves: ['stretch', 'tilt', 'nod'],
    chance: 0.45,
    hold: [2400, 4400]
  }
];

/** splitmix32: un intero dentro, un numero in [0,1) fuori, e bit che si mescolano davvero. */
function mix(a: number): number {
  let t = (a + 0x9e3779b9) | 0;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
  return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
}

/**
 * Il battito numero `step` di un'attesa lunga `elapsedMs`, per un avatar seminato con `seed`.
 * `prev` tiene le due regole del ritmo: mai la stessa faccia due volte di fila, mai due mosse
 * grandi attaccate.
 */
export function avatarBeatAt(
  step: number,
  seed: number,
  elapsedMs: number,
  prev: AvatarBeat | null = null
): AvatarBeat {
  const p = ALIVE_PHASES.find((ph) => elapsedMs < ph.until) ?? ALIVE_PHASES[ALIVE_PHASES.length - 1];
  // Tre rivoli indipendenti: faccia, mossa, durata. NON `hash()`: quello è lineare (h*31 + c) e su
  // input che avanzano di uno restituisce numeri che avanzano di uno — pause di 2642, 2704, 2766 ms,
  // +62 ogni volta. Serve un mixer con avalanche.
  const r = (salt: number) => mix(Math.imul(seed, 2654435761) + Math.imul(step, 0x9e3779b1) + salt);
  const pool = prev ? p.faces.filter((f) => f !== prev.face) : p.faces;
  const face = pool[Math.floor(r(1) * pool.length)] ?? p.faces[0];
  const move =
    !prev?.move && p.moves.length && r(2) < p.chance
      ? (p.moves[Math.floor(r(3) * p.moves.length)] ?? null)
      : null;
  const holdMs = Math.round(p.hold[0] + r(4) * (p.hold[1] - p.hold[0]));
  return { face, move, holdMs };
}
