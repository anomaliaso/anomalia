/**
 * UGC reels — "shot on a phone by a real person".
 *
 * Deliberately NOT a style knob on the normal image path: a brand's `visual_style` is a PREMIUM
 * brief and UGC is its opposite craft. Applying both gives the uncanny middle — an advert
 * pretending to be candid — which is the most common way AI social video reads as fake. So
 * `UGC_VISUAL_STYLE` REPLACES the brand style; person refs, product refs, the logo rule and the QC
 * critic all still apply, because who is on camera and what they hold must stay as grounded as on
 * a normal post. Only the LOOK swaps.
 */

import { DEFAULT_VIDEO_DURATION, SCRIPT_FIT_RATIO } from '$lib/server/video';
import {
  formatBeats,
  formatIsMultiScene,
  ugcFormatById,
  type UgcFormatId,
  type UgcPlatformId
} from '$lib/ugc-formats';

/**
 * First-frame identity (People refs + product refs + QC) needs the same Pro path as normal stills:
 * the candid look is enforced in the PROMPT, not by downgrading the model.
 */
export const UGC_COVER_MODEL = 'gemini-3-pro-image-preview';

/** Replaces the brand's visual_style for UGC frames. See the module note for why it is a swap. */
export const UGC_VISUAL_STYLE = `PHOTOGRAPHY: ultra-realistic iPhone front-camera selfie. Handheld, held at arm's length, framing slightly off-centre, chest-up with headroom above the hair.
LIGHTING: name a real source — window left, overhead bulb, lamp behind, screen glow. Never studio softbox, never "good lighting", never golden-hour campaign light. Lighting inconsistency is fine.
LENS/FEEL: TikTok vlog aesthetic, shallow depth of field, soft background falloff — phone portrait, not cinema bokeh.
GRADING: none. Flat, slightly underexposed or slightly blown, faint sensor noise.
SUBJECT: one specific real person, candid mid-sentence, eyes off lens. Imperfect presence — posture realism, casual grip on the phone.
SKIN: real skin texture, visible pores, under-eye shadows — no beauty filter, no plastic-smooth retouch.
MOOD: a frame from a camera roll mid-conversation, not a composed ad still.
DO NOT: no on-image text, no captions, no logo, no watermark, no graphic overlay, no product-shot lighting, no clean seamless backdrop.`;

/**
 * Life-Force 8 (Whitman / Ca$hvertising) — the desire UNDER the pain beat.
 * Every UGC hook should name a concrete painful moment that sits on one of these.
 */
export const LIFE_FORCE_DESIRES = [
  'stay alive / feel well / live longer',
  'enjoy food and drink',
  'free from fear, pain and danger',
  'find a partner',
  'live comfortably',
  'be better than the people around you',
  'look after the people you love',
  'be liked and respected'
] as const;

/**
 * Spoken structure for ≤15s UGC ads:
 * Hook (call-out / pain moment) → body (problem + demo + proof) → CTA (qualify + soft action).
 * Product never in the first ~8s / never leads the hook.
 */
export type UgcScript = {
  /** HOOK / call-out (~8–12 words): painful moment + implied desire — mid-conversation. */
  hook: string;
  /** PROBLEM + DEMO + PROOF (~18–28 words): cost, then mechanic out loud, then one proof. */
  body: string;
  /** CTA (~6–10 words): qualify the viewer + soft action — never a slogan. */
  cta: string;
};

/** Handheld flaws Seedance defaults AWAY from — name them or the take looks too clean. */
export const UGC_CAMERA_FLAWS =
  'natural micro-shakes, drifting frames, hunting autofocus, uneven light, slight over/underexposure, faint sensor noise — never tripod stillness, never cinematic move, never beauty filter';

/**
 * ~3.3 words/second con margine, così una micro-pausa più una CTA che sfuma finiscono comunque.
 * Frasi INTERE, non frammenti da telegramma ("Calendar chaos? Resolve it.").
 */
export const UGC_WORDS_PER_SECOND = 3.3;

/** The word budget a script must fit for a clip of `seconds`. */
export function scriptWordBudget(seconds: number = DEFAULT_VIDEO_DURATION): number {
  return Math.max(1, Math.floor(seconds * UGC_WORDS_PER_SECOND * SCRIPT_FIT_RATIO));
}

/** Soft floor — below this the script reads as sparse headline fragments, not spoken talk. */
export function scriptMinWords(seconds: number = DEFAULT_VIDEO_DURATION): number {
  return Math.max(16, Math.floor(scriptWordBudget(seconds) * 0.72));
}

/** True when hook/body/cta look like ad fragments rather than continuous spoken sentences. */
export function looksLikeTelegramScript(script: UgcScript): boolean {
  const full = [script.hook, script.body, script.cta]
    .map((s) => (s ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
  const words = full.split(/\s+/).filter(Boolean);
  if (words.length < 12) return true;
  const clauses = full.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  if (clauses.length >= 2 && words.length / clauses.length < 5.5) return true;
  // Pattern da slogan staccato: tante proposizioni cortissime ("X? Y. Try Z.").
  const short = clauses.filter((c) => c.split(/\s+/).filter(Boolean).length <= 4).length;
  return clauses.length >= 3 && short >= 3;
}

/** Join a structured script into the single line the video model speaks, trimmed to the clip. */
export function ugcSpokenLine(script: UgcScript, seconds: number = DEFAULT_VIDEO_DURATION): string {
  const joined = [script.hook, script.body, script.cta]
    .map((s) => (s ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
  const budget = scriptWordBudget(seconds);
  const words = joined.split(/\s+/).filter(Boolean);
  if (words.length <= budget) return joined;
  // Un confine di frase dentro la finestra, altrimenti un taglio pulito di parola.
  const keep = words.slice(0, budget).join(' ');
  const boundary = Math.max(keep.lastIndexOf('. '), keep.lastIndexOf('! '), keep.lastIndexOf('? '));
  if (boundary >= Math.floor(keep.length * 0.55)) return keep.slice(0, boundary + 1).trim();
  return keep;
}

/** True when the script fits its clip without the CTA being cut off. */
export function scriptFits(script: UgcScript, seconds: number = DEFAULT_VIDEO_DURATION): boolean {
  const full = [script.hook, script.body, script.cta].join(' ').trim().split(/\s+/).filter(Boolean).length;
  return full <= scriptWordBudget(seconds);
}

export type UgcFrameOpts = {
  /** Who is on camera. When the brand has a matching Person, their photos ride in as references. */
  person?: string;
  /** Exact offering name when the clip should show a product, or '' / undefined. */
  product?: string;
  /** Where the clip is shot — from the seed's `setting`. */
  setting?: string;
  /** The opening claim, so the expression on the first frame matches what is being said. */
  hook?: string;
  /**
   * Cosa ACCADE fisicamente a schermo al secondo uno. È il componente che guadagna lo stop: la riga
   * parlata viene sentita solo se il frame compra il secondo. Derivare il primo frame dal solo hook
   * PARLATO fa aprire ogni clip sullo stesso scatto — una persona a metà frase, seccata.
   */
  hookVisual?: string;
};

/**
 * Il PRIMO FRAME regge tutta la clip: l'image-to-video fissa da lì soggetto, stanza e vestiti, e il
 * prompt di movimento dirige solo la recitazione. Quindi descrive una PERSONA A METÀ FRASE, non una
 * scena — una stanza vuota non dà niente da animare e il modello si inventa un parlante, perdendo
 * la faccia vera del brand.
 */
export function buildUgcFramePrompt(opts: UgcFrameOpts = {}): string {
  const who = opts.person?.trim()
    ? `The person in the attached reference photos is on camera — keep their face, hair and build exactly.`
    : `One specific real person on camera — invent a concrete look and COMMIT (age band, hair, wardrobe). Not a stock beauty campaign.`;
  // Setting is caller-owned (AI / seed). Do not invent tidy vs messy décor when unset.
  const where = opts.setting?.trim()
    ? `Shot in: ${opts.setting.trim().replace(/\s+/g, ' ').slice(0, 200)}.`
    : '';
  // Il prodotto compare solo se è davvero in mano: una clip UGC non stacca su uno scatto prodotto,
  // e un prodotto che fluttua è il segnale che il video è uno spot.
  // "In one hand" con la contabilità esplicita dell'altra: l'arto in più nasce quasi sempre
  // nell'interazione mano-prodotto, e dire dove sta OGNI mano toglie lo spazio per inventarne una terza.
  const what = opts.product?.trim()
    ? `They are holding ${opts.product.trim()} casually in ONE hand, the way someone shows a friend — not presenting it to camera. Their other hand is the one holding the phone, off-frame.`
    : '';
  // La cover è il secondo uno della clip: senza questo il primo frame viene dal solo hook parlato,
  // e ogni clip del batch apre sullo stesso scatto.
  const doing = opts.hookVisual?.trim()
    ? `On screen right now: ${opts.hookVisual.trim().replace(/\s+/g, ' ').slice(0, 160)} — stage it literally, it is what earns the stop.`
    : '';
  // Primo frame = riconoscimento del dolore, così l'i2v parte con un arco espressivo e non da una
  // faccia neutra.
  const face = opts.hook?.trim()
    ? `Their expression matches the PAIN MOMENT they say: "${opts.hook.trim().replace(/\s+/g, ' ').slice(0, 160)}" — brows knit, lean in, frustrated recognition of the desire underneath (less chaos / get it done / look competent), mouth open mid-sentence, eyes off lens.`
    : `Expressive PAIN MOMENT face mid-sentence — brows knit, lean in, mouth open, eyes off lens — not posed, not blank deadpan.`;

  return [
    'ALWAYS STACK: ultra realistic iPhone front camera selfie • real skin texture, visible pores, under-eye shadows • candid mid-sentence expression, eyes off lens • named light source (window left, lamp behind) — never "good lighting" • lived-in background with one imperfect detail • shallow depth of field, TikTok vlog aesthetic, no text, 9:16.',
    'Vertical 9:16 chest-up with clear headroom above the hair. They hold the phone themselves at arm\'s length — framing slightly off-centre.',
    who,
    where,
    what,
    doing,
    face,
    'Imperfect presence: casual posture, micro hesitation in the face — not clean delivery energy.',
    // Nano Banana non ha un negative prompt: i vincoli si dichiarano nel positivo, contando le
    // mani invece di dire genericamente "niente errori".
    'LIMB ACCOUNTING: exactly two arms. One hand holds the phone (at most its edge visible at the frame border); ONLY the other hand appears in frame, doing at most one thing, five fingers, attached to its arm. Never a third hand, never a hand without an arm.',
    'PERSPECTIVE: true front-camera geometry at arm’s length — mild wide-angle proximity on the face, room lines behind them converging in one consistent scheme, objects scaling with distance, reflections matching the room.',
    'No text, no captions, no logo, no watermark anywhere in the frame.'
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Il pavimento duro sotto il digest /trending: quello è testo AMBIENTALE e degrada a stringa vuota
 * quando è stantio, queste sono le meccaniche INVARIANTI scritte come regole numerate. Iniettate in
 * ENTRAMBI i planner, così nessun percorso pianifica senza.
 */
export const UGC_CAPTURE_RULES = `CAPTURE RULES (hard, numbered — from measured winning clips, not taste):
1. SECOND 1 = a physical ACTION already happening on screen (hands ripping / dropping / opening something, a reveal mid-motion). A person looking at the camera is NOT an action — hook_visual must name the action, verb first.
2. The spoken hook opens a LOOP by second 3: a stake, contradiction or named payoff the clip has not paid yet. A fact the viewer already knows is a skip.
3. The REVEAL (the sentence a stranger would repeat to a friend) lands before 60% of the clip.
4. NO DEAD SECONDS: something visible changes at least every ~2s — framing, prop, face, or state. Consecutive seconds with no change are where clips die.
5. MULTI-SCENE formats: every scene CHANGES something named vs the previous one (framing, or a physical state — something now open, moved, shown). Never two consecutive scenes with the same framing in the same spot; the renderer alternates framings, write scenes that use the cut.`;

/** Behavioral beats from the MASTER brief — pick 2–3 per clip so batches do not clone. */
export const UGC_BEHAVIORAL_BEATS = [
  'glance away',
  'lean back',
  'shrug',
  'adjust phone grip',
  'react to a sound',
  'half-laugh at own sentence'
] as const;

/** MASTER list as a single prompt clause (fallback when no concrete pick is baked in). */
export const UGC_BEHAVIORAL_BEATS_PROMPT =
  'BEHAVIORAL BEATS — pick 2–3, vary per video: glance away • lean back • shrug • adjust phone grip • react to a sound • half-laugh at own sentence. Do them on camera during the body; do not skip.';

/** Scelta stabile dal seed: deterministica per i test, ma diversa fra clip con campi diversi. */
export function pickUgcBehavioralBeats(seed: string, n?: number): string[] {
  const pool = [...UGC_BEHAVIORAL_BEATS];
  let h = 0;
  const s = seed || 'ugc';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  // Senza `n`, l'hash sceglie fra 2 e 3.
  const count = n != null ? Math.max(2, Math.min(3, n)) : 2 + (h % 2);
  const out: string[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = (h + i * 17) % pool.length;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/** One timed beat in a Seedance shot brief (second-by-second, not a vibe). */
export type UgcShotBeat = {
  start: number;
  end: number;
  action: string;
  /**
   * L'inquadratura di QUESTO shot. `CAMERA:` è una riga per tutta la clip: su un formato
   * multi-scena significherebbe shot che cambiano COSA succede e mai COME è ripreso, cioè un
   * talking head fisso tagliato a pezzi. Vuoto = eredita la `camera` della clip.
   */
  framing?: UgcShotFraming | null;
};

/**
 * Deliberatamente pochi: i campi che una persona sola col telefono ottiene senza troupe. È il
 * vocabolario che tiene il risultato dentro il formato invece di farlo somigliare a uno spot.
 */
export const UGC_SHOT_FRAMINGS = [
  'wide',
  'medium',
  'close',
  'insert',
  'pov',
  'over-shoulder'
] as const;
export type UgcShotFraming = (typeof UGC_SHOT_FRAMINGS)[number];

/**
 * Come ogni campo si scrive nel prompt: cosa inquadra, a che serve, e — perché gli arti in più sono
 * il difetto n.1 dei render — l'ALTEZZA della camera e il CONTEGGIO delle mani che può contenere.
 * Gli arti extra nascono dove la composizione è ambigua, quindi ogni campo dichiara la composizione
 * a MINOR ambiguità che può ospitare.
 */
export const UGC_FRAMING_DIRECTION: Record<UgcShotFraming, string> = {
  wide: 'wide shot at eye level, full upper body and the room around them — establishes where this is happening; both arms visible and resting naturally, hands empty or one hand on one object',
  medium: 'medium shot, chest up, eye-level front camera at arm’s length — the default talking framing; one arm extends off-frame to hold the phone, only the other hand appears in frame',
  close: 'close-up on the face at eye level, filling the frame — for the reaction, never for exposition; no hands in frame',
  insert: 'insert shot from a high three-quarter angle looking down: ONE hand and the product only, the hand entering from a frame edge with its forearm, no face — what is being done, up close',
  pov: 'POV from the speaker’s eyeline, high angle looking down at what they are holding or using — at most their own two hands, entering from the bottom edge',
  'over-shoulder': 'over-the-shoulder from behind at shoulder height, onto a screen or surface — shows what they are looking at; their arms stay in front of their own body'
};

export function isUgcShotFraming(v: unknown): v is UgcShotFraming {
  return typeof v === 'string' && (UGC_SHOT_FRAMINGS as readonly string[]).includes(v);
}

/**
 * Il default quando il pianificatore non sceglie: una copertura che ALTERNA. Due shot di fila nello
 * stesso campo si leggono come un jump cut e non come uno stacco — la clip sembra tagliata male
 * invece che montata.
 */
export function defaultUgcFramings(count: number): UgcShotFraming[] {
  const cycle: UgcShotFraming[] = ['medium', 'wide', 'insert', 'close', 'over-shoulder', 'medium'];
  return Array.from({ length: Math.max(0, count) }, (_, i) => cycle[i % cycle.length]);
}

/**
 * Structured Seedance UGC brief — subject / camera / audio / timeline.
 * Prefer this over a freeform "vibe" paragraph; reverse-engineered refs and the default UGC
 * template both serialize through `formatUgcShotBrief`.
 */
export type UgcShotBrief = {
  subject: string;
  camera: string;
  audio: string;
  /** Concrete 2–3 MASTER behavioral beats for THIS clip (required for UGC variety). */
  behavioralBeats: string[];
  timeline: UgcShotBeat[];
  /** Sul brief, così il serializer nomina l'arco in STAGES senza un secondo argomento ovunque. */
  format?: UgcFormatId | null;
};

export type UgcShotBriefOpts = UgcFrameOpts & {
  /** Clip length in seconds — scales default timeline beats. */
  seconds?: number;
  /** Optional spoken line (for BRAND / STAGES blocks). */
  script?: string;
  /** Desire under the pain (Life-Force) — steers hook face + copy craft. */
  desire?: string;
  /**
   * Il FORMATO di questa clip. Un formato è una TIMELINE diversa, non un tono diverso: unboxing
   * apre su un pacco, comparison spende un terzo della clip a recitare il modo vecchio. Senza,
   * ogni clip di ogni batch gira gli stessi cinque beat e dieci copioni sembrano uno.
   */
  format?: UgcFormatId | null;
  /** Where the clip is going — only used to label the brief; length is decided by the caller. */
  platform?: UgcPlatformId | null;
};

/**
 * Quando il prodotto può entrare, per formato. Quasi tutti lo vietano presto: un prodotto che apre
 * i primi secondi è il segnale più chiaro che la clip è uno spot. I due formati commerce sono
 * l'eccezione — lì il prodotto È lo scatto d'apertura, e trattenerlo romperebbe il formato.
 */
function formatHolding(product: string | undefined, productEarly: boolean): string {
  const name = product?.trim();
  if (!name) return '';
  return productEarly
    ? `, ${name} in hand from the first frame — it is the subject of the opening shot`
    : `, later casually holding ${name} (not presenting it; product NOT leading the first seconds)`;
}

/**
 * Default UGC shot brief — 5-beat ad arc for ≤15s:
 *  ~0–15%  HOOK call-out (pain moment + desire under — product NOT on screen yet)
 *  ~15–35% PROBLEM (cost / agitate)
 *  ~35–60% DEMO (give away the mechanic out loud)
 *  ~60–80% PROOF (relief + one concrete proof)
 *  ~80–100% CTA (qualify + soft action)
 */
export function buildUgcShotBrief(opts: UgcShotBriefOpts = {}): UgcShotBrief {
  // Tetto a 60s e non 30: YouTube Shorts vuole 30-60. Il tetto vero di un render resta quello del
  // modello (UGC_ORGANIC_MAX_DURATION / UGC_AD_DURATION).
  const seconds = Math.max(4, Math.min(60, opts.seconds ?? 15));
  const hookEnd = Math.max(1, Math.round(seconds * 0.15 * 10) / 10);
  const problemEnd = Math.max(hookEnd + 1, Math.round(seconds * 0.35 * 10) / 10);
  const demoEnd = Math.max(problemEnd + 1, Math.round(seconds * 0.6 * 10) / 10);
  const proofEnd = Math.max(demoEnd + 1, Math.round(seconds * 0.8 * 10) / 10);
  const who = opts.person?.trim()
    ? `the person from the reference frame (${opts.person.trim()}) — same face, hair, wardrobe, skin texture`
    : 'the person from the reference frame — same face, hair, wardrobe, skin texture';
  const where = opts.setting?.trim() ? ` in ${opts.setting.trim().replace(/\s+/g, ' ').slice(0, 160)}` : '';
  const holding = opts.product?.trim()
    ? `, later casually holding ${opts.product.trim()} (not presenting it; product NOT leading the first seconds)`
    : '';
  const desire = opts.desire?.trim()
    ? opts.desire.trim().replace(/\s+/g, ' ').slice(0, 120)
    : 'less chaos / get the work done / look competent';
  const beats = pickUgcBehavioralBeats(
    [opts.person, opts.setting, opts.hook, opts.product, desire].filter(Boolean).join('|')
  );

  // Un formato SOSTITUISCE la timeline PAS con la sua. Il mestiere (battito di ciglia, beat
  // comportamentali, parlato che finisce, hook guadagnato a vista) non è parte del formato e si
  // aggiunge sopra: cambiare formato non costa mai le cose che fanno sembrare vera una clip.
  const spec = ugcFormatById(opts.format);
  if (spec) {
    return {
      format: spec.id,
      subject: `${who}${where}${formatHolding(opts.product, spec.productEarly)}`,
      camera: `handheld front-camera selfie perspective, chest-up with headroom above the hair, ${UGC_CAMERA_FLAWS}, 9:16`,
      audio:
        'clear phone-mic voice with light room tone, one quiet ambient sound event, no background music, no studio VO',
      behavioralBeats: beats,
      timeline: formatBeats(spec, seconds).map((b, i, all) => ({
        start: b.start,
        end: b.end,
        action: [
          i === 0 && opts.hookVisual?.trim()
            ? `VISUAL ACTION (this is what earns the stop, stage it literally): ${opts.hookVisual
                .trim()
                .replace(/\s+/g, ' ')
                .slice(0, 140)}`
            : '',
          b.action,
          i === 0 && opts.hook?.trim()
            ? `spoken line already running ("${opts.hook.trim().replace(/\s+/g, ' ').slice(0, 100)}"); desire under it: ${desire}; no warm-up`
            : '',
          i === 1 ? `behavioral beats: ${beats.join(' • ')}; blink every ~2–3s; one gaze break` : '',
          i === all.length - 1
            ? 'every spoken word finishes before the clip ends; never cut mid-word'
            : ''
        ]
          .filter(Boolean)
          .join(' — ')
      }))
    };
  }

  return {
    subject: `${who}${where}${holding}`,
    camera: `handheld front-camera selfie perspective, chest-up with headroom above the hair, ${UGC_CAMERA_FLAWS}, 9:16`,
    audio:
      'clear phone-mic voice with light room tone, one quiet ambient sound event, no background music, no studio VO',
    behavioralBeats: beats,
    timeline: [
      {
        start: 0,
        end: hookEnd,
        // L'azione visiva guida quando il seed ne nomina una: è ciò che ferma il pollice, e deve
        // portare qualcosa che il parlato non dice già.
        action: [
          opts.hookVisual?.trim()
            ? `VISUAL ACTION (this is what earns the stop, stage it literally): ${opts.hookVisual.trim().replace(/\s+/g, ' ').slice(0, 140)}`
            : '',
          opts.hook?.trim()
            ? `HOOK call-out mid-sentence — PAIN MOMENT already named ("${opts.hook.trim().replace(/\s+/g, ' ').slice(0, 100)}"); desire under it: ${desire}; brows knit, lean in; NO product yet; blinks; no warm-up`
            : `HOOK call-out mid-sentence — PAIN MOMENT + desire (${desire}); brows knit, lean in; NO product yet; already talking`
        ]
          .filter(Boolean)
          .join(' — ')
      },
      {
        start: hookEnd,
        end: problemEnd,
        action: `PROBLEM — deepen the cost (time/money/stress/shame); face stays worked up; blink every ~2–3s; one gaze break; behavioral beats: ${beats.join(' • ')}`
      },
      {
        start: problemEnd,
        end: demoEnd,
        action:
          'DEMO — give away the mechanic out loud (exactly how it works in one concrete step); product may appear casually in hand now; still handheld, still blinking; NO on-screen UI text'
      },
      {
        start: demoEnd,
        end: proofEnd,
        action:
          'PROOF — energy SHIFT to relief (shoulders drop, brows soften, small real smile or half-laugh); one concrete proof detail; lips synced; keep skin texture'
      },
      {
        start: proofEnd,
        end: seconds,
        action:
          'CTA — qualify the viewer then soft action as an afterthought, trailing off — never a slogan; every word of the spoken line still finishes (never cut mid-word)'
      }
    ]
  };
}

export type UgcStoryboardFrame = {
  /** The PAS beat, or the format's own beat key when the clip runs a named format. */
  beat: 'hook' | 'problem' | 'demo' | 'proof' | 'cta' | (string & {});
  /** Fraction of clip this frame represents (for labeling). */
  atPct: number;
  /** Nano Banana still prompt for this storyboard cell. */
  prompt: string;
};

/**
 * IL CASTING, PRIMA DELLE SCENE. Uno storyboard reso scena per scena dallo stesso testo non dà lo
 * stesso film: ne dà cinque — il modello reinventa faccia, prodotto e stanza a ogni frame. La
 * coerenza non è una proprietà del testo, è una proprietà delle IMMAGINI che il testo si porta
 * dietro: si gira prima un ritratto e uno still del prodotto, e quelli entrano come reference in
 * OGNI frame. Col talent o le foto vere del brand non si genera niente.
 */
export function buildUgcCastPortraitPrompt(opts: { person?: string; setting?: string } = {}): string {
  const who = opts.person?.trim()
    ? `The person in the attached reference photos — keep their face, hair and build exactly.`
    : 'One specific real person: invent a concrete look and COMMIT to it (age band, hair, skin, wardrobe). Not a stock beauty campaign face.';
  const where = opts.setting?.trim()
    ? ` Shot in ${opts.setting.trim().replace(/\s+/g, ' ').slice(0, 160)}.`
    : '';
  return [
    'CASTING PORTRAIT — this image exists to LOCK an identity for the clips that follow, nothing else.',
    who,
    'Chest-up, front-facing, neutral relaxed expression, eyes to camera. Even ordinary light so the face reads clearly.',
    `Ultra-realistic phone photo: real skin texture, visible pores, under-eye shadows, no beauty filter, no retouch.${where}`,
    'No text, no logo, no watermark, no graphic overlay. One person only.'
  ].join(' ');
}

/** Lo still del prodotto: serve a tenerlo IDENTICO fra una scena e l'altra, non a venderlo. */
export function buildUgcProductStillPrompt(product: string, opts: { setting?: string } = {}): string {
  const name = product.trim().slice(0, 120);
  const where = opts.setting?.trim()
    ? ` On a surface in ${opts.setting.trim().replace(/\s+/g, ' ').slice(0, 120)}.`
    : '';
  return [
    `PRODUCT REFERENCE STILL of ${name} — this image exists to keep the object IDENTICAL across the clip.`,
    `Shot on a phone, plain even light, the whole object in frame, readable shape, colour and proportions.${where}`,
    'No hands, no person, no studio softbox, no packshot styling, no text, no logo overlay, no watermark.'
  ].join(' ');
}

/**
 * Still di storyboard PRIMA del render video: facce, stanze e oggetti si iterano su immagini. Il
 * frame 0 è la cover i2v; i successivi sono reference opzionali.
 */
export function buildUgcStoryboardFrames(opts: UgcShotBriefOpts = {}): UgcStoryboardFrame[] {
  const base = buildUgcFramePrompt(opts);
  const product = opts.product?.trim() || 'the product';
  const desire = opts.desire?.trim() || 'less chaos / get the work done';

  // Con un formato lo storyboard sono i beat DI QUEL formato: un unboxing che apre su una faccia
  // frustrata è lo storyboard di un altro video.
  const spec = ugcFormatById(opts.format);
  if (spec) {
    const seconds = Math.max(4, Math.min(60, opts.seconds ?? 15));
    const beats = formatBeats(spec, seconds);
    // Lo STESSO ciclo di campi che `formatSeedanceUgcBlocks` assegnerà agli shot: se la reference
    // mostra un medium mentre STAGES dichiara un insert, il modello ne sceglie una e il montaggio
    // perde l'altra.
    const framings = defaultUgcFramings(beats.length);
    return beats.map((b, i) => ({
      beat: b.key,
      atPct: Math.round(((b.start + b.end) / 2 / seconds) * 100),
      prompt: `${base} STORYBOARD ${b.key.toUpperCase().replace(/_/g, ' ')} frame (${spec.id}) — FRAMING for this cell: ${UGC_FRAMING_DIRECTION[framings[i]]}. ${b.action}. Product: ${product}. Desire under it: ${desire}. Same person, same wardrobe, same room across frames. ${UGC_CAMERA_FLAWS}.`
    }));
  }

  return [
    {
      beat: 'hook',
      atPct: 8,
      prompt: `${base} STORYBOARD HOOK frame: pain moment only — desire under it (${desire}). Product NOT visible yet. Lived-in room. ${UGC_CAMERA_FLAWS}.`
    },
    {
      beat: 'problem',
      atPct: 25,
      prompt: `${base} STORYBOARD PROBLEM frame: same person/room; deeper frustration / cost of the pain; still no polished ad pose.`
    },
    {
      beat: 'demo',
      atPct: 48,
      prompt: `${base} STORYBOARD DEMO frame: same person casually showing ${product} the way you'd show a friend — not presenting to camera. No readable UI text on any screen.`
    },
    {
      beat: 'proof',
      atPct: 70,
      prompt: `${base} STORYBOARD PROOF frame: relief face — shoulders drop, softer eyes, small real smile; same wardrobe/room identity.`
    },
    {
      beat: 'cta',
      atPct: 90,
      prompt: `${base} STORYBOARD CTA frame: softer afterthought energy, trailing off — still imperfect UGC, never a slogan pose.`
    }
  ];
}

/**
 * The one-line arc that opens STAGES. With a format it names that format's beats and its own
 * product rule; without one it stays the PAS arc every UGC clip used to run.
 */
function stagesHeader(brief: UgcShotBrief): string {
  const spec = ugcFormatById(brief.format);
  if (!spec) return 'Hook → Problem → Demo → Proof → CTA. Product must NOT lead the hook (~first 8s).';
  const arc = spec.beats.map((b) => b.key.replace(/_/g, ' ')).join(' → ');
  return `FORMAT ${spec.id} — ${arc}. ${
    spec.productEarly
      ? 'The product IS the opening shot in this format — it leads.'
      : 'Product must NOT lead the hook (~first half of the clip).'
  }`;
}

/**
 * Seedance 2.5 block prompt (ALL-CAPS labels). References + camera first; bans last.
 * Prefer this over a vibe paragraph; pairs with a storyboard cover as first frame.
 */
export function formatSeedanceUgcBlocks(opts: {
  brief: UgcShotBrief;
  script?: string;
  product?: string;
  desire?: string;
  /** Describe attached refs: what each controls / does NOT control. */
  references?: string[];
}): string {
  const { brief } = opts;
  const line = (opts.script ?? '').replace(/\s+/g, ' ').trim();
  const desire = (opts.desire ?? 'less chaos / get the work done / look competent').replace(/\s+/g, ' ').trim();
  const product = (opts.product ?? '').replace(/\s+/g, ' ').trim();
  const refs = (opts.references ?? []).map((r) => r.trim()).filter(Boolean);
  // Lo stacco si DICHIARA solo dove il formato cambia davvero scena: su un talking head in ripresa
  // unica "Hard cut" invita a tagliare un video che non deve avere tagli.
  const multiScene = formatIsMultiScene(brief.format);
  const beats = (brief.timeline ?? []).filter((b) => b && String(b.action ?? '').trim());
  /**
   * L'inquadratura per shot, SOLO sui formati multi-scena: su una ripresa unica il campo è uno e
   * sta in `CAMERA:`, e scriverne uno per beat chiederebbe stacchi a un video che non deve averne.
   * La deduplica qui sotto impedisce due campi uguali di fila anche quando li sceglie il
   * pianificatore — due shot consecutivi nello stesso campo si leggono come un jump cut.
   */
  const fallbackFramings = defaultUgcFramings(beats.length);
  let previousFraming: UgcShotFraming | null = null;
  const stages = beats.flatMap((b, i) => {
    const a = Number(b.start);
    const z = Number(b.end);
    const start = Number.isFinite(a) ? a.toFixed(2).replace(/\.?0+$/, '') : '0';
    const end = Number.isFinite(z) ? z.toFixed(2).replace(/\.?0+$/, '') : start;
    let framing: UgcShotFraming | null = null;
    if (multiScene) {
      const wanted = isUgcShotFraming(b.framing) ? b.framing : fallbackFramings[i];
      framing =
        wanted && wanted === previousFraming
          ? fallbackFramings.find((f) => f !== previousFraming) ?? wanted
          : wanted;
      previousFraming = framing;
    }
    const shot = `SHOT ${i + 1} (${start}-${end}s)`;
    const head = framing ? `${shot} — ${UGC_FRAMING_DIRECTION[framing]}` : shot;
    const line = `${head}: ${String(b.action).replace(/\s+/g, ' ').trim()}`;
    return multiScene && i < beats.length - 1 ? [line, 'Hard cut.'] : [line];
  });
  const picked = (brief.behavioralBeats ?? []).map((b) => String(b).trim()).filter(Boolean);

  return [
    // GLOBAL STYLE in cima, POSITIVE LOCKS in fondo, il lavoro diviso in shot in mezzo: è la forma
    // che Seedance 2.5 rispetta, e saltare una sezione fa fallire l'output in modo prevedibile.
    'GLOBAL STYLE:',
    'phone-shot UGC, vertical 9:16, real 24fps with no speed ramps, flat ungraded look with faint sensor noise; no film emulation, no cinematic grade, no on-screen text of any kind',
    '',
    'REFERENCES:',
    refs.length
      ? refs.map((r, i) => `@Image ${i + 1} ${r}`).join('\n')
      : '@Image 1 defines the speaker face, hair, build, wardrobe and room from the cover — do not invent a different person or location.',
    'Everything about the speaker — face, skin, hair, wardrobe — comes from the references and stays identical in every shot.',
    '',
    'CAMERA:',
    brief.camera.replace(/\s+/g, ' ').trim(),
    // Su multi-scena la riga sopra descrive COME si gira, non il campo — quello cambia in STAGES.
    // Senza questa frase le due sezioni si contraddicono e il modello ne sceglie una.
    ...(multiScene
      ? [
          'Framing changes shot by shot as written in STAGES — same phone, same operator, same room: the camera is repositioned between takes, never a second camera and never a crew.'
        ]
      : []),
    '',
    'LOOK:',
    'realistic skin texture, visible pores around the nose and cheeks, natural slight unevenness, no filter quality; named practical light (window / lamp / screen glow); flat grading, faint sensor noise',
    'no doll skin, no porcelain skin, no airbrushed skin, no skin blur, no glossy plastic finish',
    '',
    'STYLE:',
    `talking-head UGC on camera in every beat; expressive pain→relief arc; desire under the pain: ${desire}; mid-conversation, never presenting; behavioral beats: ${picked.join(' • ') || 'glance away • shrug'}`,
    '',
    // Il mezzo battito di ritardo è la nota che più di tutte toglie il sapore di spot.
    'ACTING:',
    'understated and real: blinks at a natural rate, reactions arrive half a beat late, small smiles that grow instead of appearing whole, glances away mid-sentence',
    'no wide eyes, no exaggerated faces, no performing to camera; speaks at a slightly lower volume, like someone aware they are being recorded',
    '',
    'VOICE:',
    'same natural phone-mic voice for the full clip; fast spoken pace; light slang OK; no announcer energy; no studio VO',
    '',
    'CHARACTER:',
    brief.subject.replace(/\s+/g, ' ').trim(),
    '',
    'SETTING:',
    'only the room from the cover / references — do not invent a second location',
    '',
    'STAGES:',
    stagesHeader(brief),
    multiScene
      ? 'Every shot boundary below is a HARD CUT — no fades, no dissolves, no whip pans.'
      : 'ONE CONTINUOUS TAKE: the beats below happen inside a single unbroken shot. No cuts, no jumps, no re-framing between them.',
    ...stages,
    '',
    // La fisica separata dal movimento del personaggio, e monotòna: un prodotto che si consuma non
    // torna intero, ed è il difetto che nessuna regola di camera copre.
    'PHYSICS:',
    'handheld motion is irregular and decays naturally — nothing snaps to perfect stillness; fabric, hair and liquids move with weight',
    'physical progression only ever goes one way: what is opened stays opened, what is used up stays used up, what is bitten never becomes whole again',
    '',
    'BRAND:',
    line
      ? `Speak exactly this line and nothing else: "${line}"${product ? ` Pronounce product name "${product}" naturally when it appears.` : ''}`
      : product
        ? `If the product is named, say "${product}" naturally — never show on-screen logos or UI text.`
        : 'Speak the attached spoken line only. Never render brand logos or UI text on screen.',
    '',
    'AUDIO:',
    brief.audio.replace(/\s+/g, ' ').trim(),
    '[SOUND] Strictly only naturally occurring sound and foley, no music allowed.',
    '',
    'CONSISTENCY LOCKS:',
    'same face, hair, wardrobe, props count, and room geography for the whole clip; no morphing; no new people',
    // Gli arti come lock, non come augurio: contarli è l'unico modo in cui un modello video
    // rispetta un vincolo anatomico.
    'the speaker has exactly TWO arms and TWO hands in total — a third hand or arm must never appear, not even for a single frame; every hand is attached to its arm',
    'exactly five fingers per hand; hands keep their shape while holding and gesturing; when the product is held, ONE hand holds it and the other stays where the shot says it is',
    'perspective stays that of one phone camera: room lines keep a single consistent vanishing scheme, objects scale with distance, reflections match the room',
    'anyone in the background keeps the same position, clothes and activity in every shot — nobody teleports, nobody swaps seats',
    'screen direction never flips: what enters from the right keeps entering from the right',
    '',
    'ENDING:',
    'the clip ends ON THE PERSON — no product packshot, no logo card, no title at the end',
    '',
    'POSITIVE LOCKS (must NOT happen):',
    'NO subtitles, captions, burned-in words, lower thirds, titles, watermarks, UI overlays, emoji, or logos',
    'NO beauty filter, NO doll skin, NO studio softbox, NO tripod stillness, NO cinematic camera move',
    'NO readable phone/UI text — if a device is held, screen content stays soft/illegible',
    'NO music, NO speed ramps, NO slow motion, NO extra people appearing mid-clip',
    'NO extra limbs, NO merged or extra fingers, NO warped hands, NO hand detached from an arm, NO impossible perspective (walls or furniture bending, mismatched reflections)',
    'SPEECH COMPLETE — every spoken word finishes before the clip ends; never cut mid-word'
  ].join('\n');
}

/** Serialize a shot brief — Seedance blocks (preferred) built from the structured brief. */
export function formatUgcShotBrief(
  brief: UgcShotBrief,
  opts?: { script?: string; product?: string; desire?: string; references?: string[] }
): string {
  return formatSeedanceUgcBlocks({
    brief,
    script: opts?.script,
    product: opts?.product,
    desire: opts?.desire,
    references: opts?.references
  });
}
