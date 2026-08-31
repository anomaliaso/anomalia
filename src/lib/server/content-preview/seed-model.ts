import sharp from 'sharp';
import { env } from '$env/dynamic/private';
import { structured } from '$lib/server/research';
import { CONTENT_FORMATS, type ContentFormat } from '$lib/content-formats';
import { classifyHookTactic, type HookTacticId } from '$lib/server/hook-tactics';
import { byLadderPriority, ladderFor, type LadderContext } from '$lib/server/production-ladder';
import { applyRubricToSeed, type Rubric } from '$lib/server/rubrics';
import { PLATFORM_IDS } from '$lib/platforms';

export type Progress = (step: string, message: string) => void;

export type PreviewPost = {
  platform: string;
  // Cross-post target set (incl. the primary platform) when the planner reuses this exact post on
  // more channels — same visual, same caption. Absent/single → plain single-platform post.
  platforms?: string[];
  format: ContentFormat;
  // 'video' exists for the paid generate path's typing; the onboarding planner never emits it.
  media: 'image' | 'text' | 'video' | 'link';
  day: string;
  time: string;
  caption: string;
  image_prompt: string;
  // Reddit post title (required for Reddit, max 300 chars; empty for other platforms).
  title?: string;
  // URL for Reddit link posts (sharing a blog article/resource). Empty for non-link posts.
  link_url?: string;
  // Target subreddit for Reddit posts (without r/ prefix). Empty for non-Reddit posts.
  subreddit?: string;
  // Verbatim from the brand's products: it resolves the real photo fed to the generator as a
  // reference. Not persisted.
  product?: string;
  // Verbatim from the brand's People: their photos lock face/identity across renders.
  person?: string;
  // The content pillar this post serves ("Scopo") — carried from seed to produced post.
  pillar?: string;
  // Provenance: the seed's one-line ANGLE plus a REFERENCE to the source row, never a copy of it.
  angle?: string;
  planRowId?: string;
  // The approved rubric (recurring series) this post is an episode of — carried seed → post →
  // posts.rubric_id. Absent for out-of-series posts and for brands without rubrics.
  rubricId?: string;
  imageUrl?: string;
  // Carousel craft (format 'carousel' only): one prompt per slide, index 0 == image_prompt (the
  // cover); and the uploaded slide URLs in order once rendered. Absent on single-image posts.
  image_prompts?: string[];
  imageUrls?: string[];
  // Extra angles the user can pick from when editing the post.
  alt_captions?: string[]; // 1-2 alternative captions
  // Cuts of the SAME post for 280/500-char networks. Missing key → that platform gets the main caption.
  platform_captions?: Record<string, string>;
  first_comment?: string; // the seeded first comment (hashtags/CTA park)
  hook_variants?: string[]; // alternative opening lines/hooks
  // Brand Media library asset to reuse instead of (or as the subject of) AI image generation.
  mediaId?: string;
  // use_as_is = publish the asset pixels as the post media; composite = Nano Banana with asset as fidelity ref.
  mediaMode?: 'use_as_is' | 'composite';
  /** Chunk ids injected into the caption prompt — persist as used_by edges after the post has an id. */
  knowledgeChunkIds?: string[];
  /** Evidence-based justification from the produce agent (why this caption/scene). */
  justification?: string;
  /**
   * Una riga: perché il produttore ha DEVIATO dalla scena proposta dal seed (contratto a due
   * livelli — vedi PostSeed). Vuoto/assente = ha seguito la proposta. Persistito in
   * posts.qc.scene_deviation così la review può mostrare "il produttore ha deviato: …".
   */
  sceneDeviation?: string;
  /** Batch-level plan explanation from the produce agent. */
  batchJustification?: string;
  // VIDEO / UGC — spoken script carried seed → post → generate (ugcSpokenLine). Without these the
  // clip renders as silent handheld b-roll even when ugc defaults true.
  ugc?: boolean;
  /**
   * Paid UGC ad — 22s on Seedance 2.5 (Hook→Problem→Demo→Proof→CTA with room for mechanic + proof).
   * Organic UGC stays ≤15s. Ignored when ugc is false.
   */
  ugc_ad?: boolean;
  // Un hook video è TRE cose insieme che non devono dire la stessa cosa: il visivo guadagna lo
  // stop, il parlato apre l'argomento, il testo a schermo aggiunge la posta. Se due coincidono,
  // uno dei tre è sprecato.
  hook?: string;
  /** What is physically HAPPENING on screen in second one. Not the setting — the action. */
  hook_visual?: string;
  /** The caption/overlay burned over the first seconds. Must NOT restate the spoken hook. */
  hook_text?: string;
  body?: string;
  cta?: string;
  // Scene setting for the UGC cover frame (buildUgcFramePrompt).
  setting?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BrandProfile = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRec = Record<string, any>;

// Preferences that steer the whole plan.
// `language`: English name of the caption language; empty = let the planner infer it.
// `platformInstructions`: brand-authored, keyed by internal platform key, layered ON TOP of the
// built-in defaults — the brand's own words win on conflict.
export type ContentPrefs = {
  mood?: string;
  tone?: string;
  frequency?: string;
  goal?: string;
  /** One-line personality from the approved editorial plan — leads over HOUSE_VOICE when set. */
  personality?: string;
  language?: string;
  platformInstructions?: Record<string, string>;
  // Brand-approved hashtags per platform (internal key → list, each incl. leading '#'). When set for
  // a platform, the copywriter may ONLY use these and must never invent new ones.
  platformHashtags?: Record<string, string[]>;
  // Operational rule: words/phrases the brand bans from its copy (Strategia operativa page).
  avoid?: string[];
  // Il modello accetta 1–15 e fattura al secondo: è la leva principale sul costo video. Sempre
  // via clampVideoDuration, così un valore stantio o editato a mano non raggiunge il provider.
  videoDuration?: number;
  /** '480p' (default/recommended) | '720p' — Settings → Video. */
  videoResolution?: string;
  // Steers the CLIP (recitazione e movimento) via buildVideoPrompt, non la caption — quella la
  // copre già platformInstructions.
  videoInstructions?: string;
  // Real past social posts (captions only) the AI uses to learn and match the brand's voice/style.
  voiceExamples?: string[];
  // Le riscritture MANUALI del proprietario (prima → dopo): il suo gusto come esempi concreti e
  // non solo come regole astratte in brand_memory. Jsonb esistente — le migration non girano al
  // deploy — e sempre sanificato da ownerCaptionEditPairs prima dell'uso.
  captionEditPairs?: Array<{ before: string; after: string; at?: string }>;
  // Strategia operativa: 'manual' injects the structured voice framework below into every
  // caption; 'auto' (default) lets the planner read voice from the Studio as always.
  voiceMode?: 'auto' | 'manual';
  voiceFramework?: {
    purpose?: string;
    audience?: string;
    tone?: string;
    register?: number; // 0 (informal) → 100 (formal)
    emotion?: string;
    character?: string;
    syntax?: string;
    terminology?: string;
  };
};

// Senza steering esplicito il copywriter collassa a una o due frasi corte OVUNQUE: giusto per X,
// troppo magro per LinkedIn. Sovrascrivibili via content_prefs.platformInstructions.
const PLATFORM_GUIDE: Record<string, string> = {
  linkedin:
    'LinkedIn — write LONG-FORM, never one or two lines: open with a strong one-line hook, then 3–6 short paragraphs (mostly single-sentence lines with a blank line between them) that tell a story or unpack a concrete insight, and close on a clear takeaway or a question. Aim for ~700–1500 characters. Professional but human and first-person; no fluff. At most 3 hashtags at the very end, often none.',
  instagram:
    'Instagram — a scroll-stopping first line that works as a preview, then 2–4 short lines of story or value, an emoji or two where natural, and a clear CTA. Aim for ~300–700 characters. 3–5 relevant hashtags.',
  facebook:
    'Facebook — conversational and concrete: a hook plus 2–4 short sentences. Light on hashtags (0–2). Aim for ~200–500 characters.',
  x: 'X — one sharp, self-contained thought under 280 characters. No filler; at most 1–2 hashtags, often none.',
  threads:
    'Threads — casual and conversational, like talking to a friend: 1–3 short sentences, minimal or no hashtags, under ~400 characters.',
  tiktok:
    'TikTok — a short, hooky caption (often a question or bold claim) that complements the video. One or two lines, 2–4 trend-relevant hashtags.',
  youtube:
    'YouTube — video-only (one clip per post). Shorts vs long-form is auto-detected by YouTube: a clip ≤3 minutes AND 9:16 vertical is a Short; longer or 16:9 is a regular video. There is no separate Shorts channel. Write a punchy TITLE (max 100 chars) plus a description (the caption, up to ~5000 chars) with a hook in the first two lines, then context, then 3–8 search-relevant hashtags. We produce short vertical UGC that YouTube classifies as Shorts.',
  bluesky:
    'Bluesky — a microblog like X: one sharp, authentic, self-contained thought under ~300 characters. Casual and human, no marketing tone; minimal or no hashtags.',
  reddit:
    'Reddit — community-native and NON-promotional: write like a real member, not a brand. Reddit posts MUST have a title (max 300 chars, plain and honest, cannot be edited after posting). TEXT posts: title + a body of 2-6 paragraphs in Markdown (genuine value, a real question, or a useful guide — NO marketing). LINK posts: title + a URL to a useful resource (a blog article, a tool, a guide) — the title says what the link is about, the body adds context. IMAGE posts: title + a single on-brand image. NO hashtags, NO emoji spam, NO marketing phrasing (Reddit punishes it). Respect the subreddit\'s norms.'
};

// Normalise a platform name to our internal key (lowercase; Zernio/legacy 'twitter' → 'x').
export function platformKey(platform: string | null | undefined): string {
  const p = String(platform ?? '').toLowerCase().trim();
  return p === 'twitter' ? 'x' : p;
}

// Default + optional brand-specific guidance for ONE platform. '' when neither exists.
export function guidanceFor(platform: string, prefs: ContentPrefs): string {
  const key = platformKey(platform);
  const base = PLATFORM_GUIDE[key] ?? '';
  const custom = prefs.platformInstructions?.[key]?.trim();
  let out = base;
  if (custom) {
    // Le istruzioni del brand vincono sul default dove i due sono in conflitto.
    out = base
      ? `${base} Brand-specific instructions for ${key} (these take priority): ${custom}`
      : `${key} — brand-specific instructions (authoritative): ${custom}`;
  }
  // Vincolo duro: il writer sceglie SOLO da qui, non inventa.
  const tags = (prefs.platformHashtags?.[key] ?? []).filter(Boolean);
  if (tags.length) {
    out += ` HASHTAGS for ${key}: use ONLY these brand-approved hashtags, exactly as written — ${tags.join(' ')} — including the ones relevant to this post (respect the platform's typical count). NEVER invent, alter, translate or add any hashtag outside this set.`;
  }
  return out.trim();
}

// Solo le piattaforme usate in questo batch, così il writer dimensiona ogni caption sulla sua
// rete invece di riusare un unico blurb. '' quando nessuna ha guidance.
export function platformPlaybook(platforms: string[], prefs: ContentPrefs): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const p of platforms) {
    const key = platformKey(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const g = guidanceFor(p, prefs);
    if (g) lines.push(`- ${g}`);
  }
  return lines.length
    ? `\nPLATFORM PLAYBOOK (write each caption to fit its platform's length and register — do NOT write the same short blurb for every platform; in particular LinkedIn must be long-form, not one or two sentences):\n${lines.join('\n')}\n`
    : '';
}

// Le caption vere che hanno performato + le loro metriche, non solo il brief distillato: è ciò
// che àncora la strategia a quello che ha funzionato per QUESTO brand.
export type PastWinner = { content: string | null; platform: string | null; metrics: AnyRec | null };

// Una clip costa ~25x un'immagine: il tetto vive sia nel prompt sia come clamp dopo il parse.

// Capacità delle piattaforme. Instagram/TikTok/YouTube RICHIEDONO un visual: un post text/link non
// può esistere lì. Reddit è l'unica che regge text + link + image. Clamp duro sopra il prompt (e
// sulle righe editate a mano): un seed text/link su una piattaforma visual-only diventa image, e
// non ci fa cross-post.
export const VISUAL_REQUIRED = new Set(['instagram', 'tiktok', 'facebook', 'linkedin', 'youtube']);
// YouTube accepts video only (Zernio: one video file per post). Shorts vs long-form is
// auto-detected from duration + aspect ratio — not a separate post type or platform.
const VIDEO_ONLY = new Set(['youtube']);
// Dove un URL nella CAPTION è cliccabile. Su Instagram/TikTok/YouTube non lo è, quindi il link
// viene tolto ("link in bio"). Reddit porta l'URL come post, via media:'link'.
export const CAPTION_LINK_PLATFORMS = new Set(['x', 'twitter', 'threads', 'linkedin', 'facebook']);

// Un carosello rende N immagini (~4-7x un post), quindi ha un tetto come il video: in codice, mai
// fidandosi dell'LLM, e regolabile da env senza deploy.
//   CAROUSEL_MAX_PER_BATCH — quanti seed per batch (0 = kill switch, nemmeno le bozze esistenti).
//   CAROUSEL_MAX_SLIDES — slide per carosello (clampato 3..8).
// Platforms whose publish API accepts multiple images (Zernio mediaItems): IG/FB/LinkedIn.
// TikTok photo-mode and Reddit galleries are deliberately out of the first cut.
export const CAROUSEL_PLATFORMS: Set<string> = new Set([
  PLATFORM_IDS.instagram,
  PLATFORM_IDS.facebook,
  PLATFORM_IDS.linkedin
]);
export const CAROUSEL_MIN_SLIDES = 3;
const CAROUSEL_HARD_MAX_SLIDES = 8;
export function carouselMaxPerBatch(): number {
  const n = Number(env.CAROUSEL_MAX_PER_BATCH ?? '1');
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
}
export function carouselMaxSlides(): number {
  const n = Number(env.CAROUSEL_MAX_SLIDES ?? '6');
  return Math.max(CAROUSEL_MIN_SLIDES, Math.min(CAROUSEL_HARD_MAX_SLIDES, Number.isFinite(n) ? Math.floor(n) : 6));
}

// Coerenza format ↔ media: `media` è autoritativo sulle decisioni text/link e `format` lo segue.
// Un helper solo, così ogni punto di mutazione (clamp, sanitiser, fix del reviewer) ripristina
// l'invariante allo stesso modo.
function syncFormatMedia<T extends { format: ContentFormat; media: 'image' | 'text' | 'video' | 'link' }>(seed: T): T {
  if (seed.media === 'text') seed.format = 'text_post';
  else if (seed.media === 'link') seed.format = 'link_post';
  else if (seed.media === 'video' || seed.format === 'video') {
    // Accoppiati per i reel: sganciati, format:'video' con media:'image' fa sembrare uno still
    // un post che ha un copione parlato.
    seed.format = 'video';
    seed.media = 'video';
  } else if (seed.format === 'text_post' || seed.format === 'link_post') seed.format = 'single_image';
  return seed;
}

export function clampMediaCapabilities<T extends { platform: string; platforms?: string[]; format: ContentFormat; slide_count?: number; beats?: string[]; media: 'image' | 'text' | 'video' | 'link'; link_url?: string }>(seed: T): T {
  // Un seed text/link non può vivere (né fare cross-post) su una piattaforma visual-only.
  // 'video' È un visual: farlo cadere qui lo riscriverebbe a 'image', spogliando il reel.
  if (seed.media !== 'image' && seed.media !== 'video') {
    if (VISUAL_REQUIRED.has(platformKey(seed.platform))) {
      seed.media = 'image';
    } else if (Array.isArray(seed.platforms)) {
      seed.platforms = seed.platforms.filter((p) => !VISUAL_REQUIRED.has(platformKey(p)));
    }
  }
  // YouTube is video-only. An image/text/carousel seed whose primary platform is YouTube becomes
  // a video; YouTube is stripped from the cross-post list of non-video seeds.
  if (VIDEO_ONLY.has(platformKey(seed.platform))) {
    seed.format = 'video';
    seed.media = 'video';
  } else if (seed.media !== 'video' && Array.isArray(seed.platforms)) {
    seed.platforms = seed.platforms.filter((p) => !VIDEO_ONLY.has(platformKey(p)));
  }
  // Link clamp: a page URL only survives where it's usable — a Reddit link post, or a caption on
  // X/Threads/LinkedIn/Facebook. Anywhere else (Instagram/TikTok/YouTube) it's dropped.
  if (seed.link_url) {
    const pk = platformKey(seed.platform);
    const usable = (pk === 'reddit' && seed.media === 'link') || CAPTION_LINK_PLATFORMS.has(pk);
    if (!usable) seed.link_url = '';
  }
  // I multi-immagine esistono solo dove l'API di publish li accetta; altrove si degrada a una
  // immagine sola, e i target di cross-post si filtrano — un post non può avere due forme di media.
  if (seed.format === 'carousel') {
    if (!CAROUSEL_PLATFORMS.has(platformKey(seed.platform))) seed.format = 'single_image';
    else if (Array.isArray(seed.platforms)) {
      seed.platforms = seed.platforms.filter((p) => CAROUSEL_PLATFORMS.has(platformKey(p)));
    }
  }
  syncFormatMedia(seed);
  // Slide-count invariant: a carousel always carries a clamped slide count; nothing else does.
  // Le BATTUTE, quando ci sono, sono la misura della storia: lo slide_count le segue invece di
  // contraddirle, o si renderizzano tre slide di un racconto lungo sei.
  if (seed.format === 'carousel') {
    const beats = (seed.beats ?? []).map((b) => String(b ?? '').trim()).filter(Boolean);
    seed.beats = beats.length ? beats : undefined;
    seed.slide_count = Math.max(
      CAROUSEL_MIN_SLIDES,
      Math.min(carouselMaxSlides(), Math.round(beats.length || Number(seed.slide_count) || 5))
    );
    if (seed.beats && seed.beats.length > seed.slide_count) seed.beats = seed.beats.slice(0, seed.slide_count);
  } else {
    seed.slide_count = undefined;
    seed.beats = undefined;
  }
  return seed;
}

// Sanitiser deterministico, prima della review AI (più cara). Chiude i due fallimenti che non
// richiedono un modello per essere visti:
//   1. una PERSONA non presente nella lista People — il generatore inventerebbe faccia E genere;
//   2. un PRODOTTO reale marcato media:'text' — un prodotto fotografabile non è un post di testo.
export function sanitizeSeed(seed: PostSeed, knownPeople: Set<string>, hasProductCatalog: boolean): PostSeed {
  if (seed.person && !knownPeople.has(seed.person.toLowerCase().trim())) {
    seed.person = '';
  }
  if ((seed.media === 'text' || seed.media === 'link') && seed.product && hasProductCatalog) {
    seed.media = 'image';
  }
  return syncFormatMedia(seed);
}

//   'face'     — il brand È una persona: quasi ogni post la mostra.
//   'ensemble' — azienda con più volti: persone selettivamente (~1 su 3).
//   'none'     — nessuna persona usabile; mai inventare soggetti umani.
export type FaceBrandMode = 'face' | 'ensemble' | 'none';

export function peopleList(profile: BrandProfile): Array<{ name: string; role?: string }> {
  return (Array.isArray(profile?.people) ? profile.people : [])
    .map((p: AnyRec) => ({ name: String(p?.name ?? '').trim(), role: String(p?.role ?? '').trim() || undefined }))
    .filter((p: AnyRec) => p.name);
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Brand personale (la persona È il prodotto) contro azienda che ha delle persone in anagrafica.
 * Archetipo + numero di persone + sovrapposizione di nome, senza una chiamata LLM in più.
 */
export function faceBrandMode(profile: BrandProfile): FaceBrandMode {
  const people = peopleList(profile);
  if (!people.length) return 'none';
  if (people.length >= 3) return 'ensemble';

  const siteType = String(profile?.site_type ?? '').toLowerCase();
  const personalArchetype = siteType === 'creator' || siteType === 'portfolio';
  const brand = normName(String(profile?.name ?? ''));
  const about = String(profile?.about ?? '').toLowerCase();
  const firstPerson = /\b(i |i'm|i’m|my |me )\b/.test(about) || /\b(io |sono |il mio |la mia )\b/.test(about);
  const nameOverlap = people.some((p) => {
    const pn = normName(p.name);
    if (!pn || !brand) return false;
    // "Andrea Buttarelli" vs brand "Andrea Buttarelli" / domain-derived "Andreabuttarelli"
    return brand.includes(pn) || pn.includes(brand) || brand.replace(/\s/g, '') === pn.replace(/\s/g, '');
  });

  // Una persona sola su un archetipo personale basta anche senza sovrapposizione di nome.
  if (people.length === 1 && (personalArchetype || nameOverlap || firstPerson)) return 'face';
  if (people.length === 1) return 'face'; // monopersonal by default when only one face exists
  // Exactly 2 people: face only when personal archetype or clear name overlap with the brand.
  if (personalArchetype || nameOverlap || firstPerson) return 'face';
  return 'ensemble';
}

export function primaryPersonName(profile: BrandProfile): string {
  return peopleList(profile)[0]?.name ?? '';
}

export function peopleGuidanceBlock(profile: BrandProfile): string {
  const people = peopleList(profile);
  if (!people.length) return '';
  const lines = people
    .map((p) => `- ${p.name}${p.role ? `: ${p.role}` : ''}`)
    .join('\n');
  const mode = faceBrandMode(profile);
  if (mode === 'face') {
    const face = people[0].name;
    return `\nBRAND FACE MODE — PERSONAL / MONOPERSONAL:
This brand IS ${face}. The website and socials revolve around this one person.
PEOPLE (use the EXACT name in a seed's "person" field):
${lines}
RULES (authoritative):
- At least 2 of every 3 IMAGE seeds MUST set person to "${face}" (ideally ALL image seeds).
- NEVER invent other human subjects, stock models, or unnamed "a woman/man" protagonists.
- If a post shows a person at all, it must be ${face} — no exceptions.
- Text-only posts may omit the person field; image posts that depict a human must name ${face}.
`;
  }
  return `\nPEOPLE you can feature (use the EXACT name in a seed's "person" field; aim for roughly 1 in 3 seeds to be person-led when it fits — the rest stay product/lifestyle). NEVER invent people who are not on this list; if a post shows a human face it MUST be one of these people or no person at all:\n${lines}\n`;
}

/** After planning: for face brands, force-assign the primary person onto image seeds that lack one. */
export function enforceFaceBrandPeople(seeds: PostSeed[], profile: BrandProfile): void {
  if (faceBrandMode(profile) !== 'face') return;
  const face = primaryPersonName(profile);
  if (!face) return;
  for (const seed of seeds) {
    if (seed.media === 'text' || seed.media === 'link') continue;
    if (!seed.person) seed.person = face;
  }
  // Ensure a clear majority are person-led even if the model left some blank earlier.
  const imageSeeds = seeds.filter((s) => s.media !== 'text' && s.media !== 'link');
  const withPerson = imageSeeds.filter((s) => s.person).length;
  const need = Math.ceil(imageSeeds.length * (2 / 3));
  if (withPerson < need) {
    for (const s of imageSeeds) {
      if (!s.person) s.person = face;
      if (imageSeeds.filter((x) => x.person).length >= need) break;
    }
  }
}

// DUE passaggi invece di uno. Pass 1 (planStrategy) decide l'ANGOLO del batch e lo rompe in un
// "seed" per post, sparso su piattaforme, formati e prodotti diversi. Pass 2 (executePlan /
// produce-agent) è solo mestiere: seed → caption + image_prompt. Separarli è ciò che impedisce al
// planner one-shot di collassare in N scatti prodotto quasi identici.
//
// IL CONTRATTO SEED → PRODUTTORE È A DUE LIVELLI (leggere prima di toccare i campi):
//
// 1. VINCOLANTE — il COSA (strategia e logistica). platform/platforms, format, slide_count,
//    media, day, time, pillar, product, person, title/subreddit/link_url (Reddit),
//    rubric/rubric_id, media_id/media_mode, e per i VIDEO l'intero copione parlato
//    (hook/hook_visual/hook_text/body/cta + ugc/ugc_ad). Il piano decide, il produttore
//    copia verbatim (seedToPost). I campi video restano vincolanti su ENTRAMBI i percorsi
//    (organico e ad 22s) perché il copione È il formato di una clip: budget di parole legato
//    alla durata del render, contratto a tre componenti dell'hook (enforceHookComponents),
//    e nessun produttore ha oggi uno slot di output per riscriverlo — un override qui
//    produrrebbe clip mute o fuori budget, il bug che ci è già costato una volta.
//
// 2. CONSULTIVO — il COME (la scena). subject, setting, props sono la PROPOSTA del planner:
//    un default concreto, non un ordine. Il produttore può deviare quando ha un'idea più
//    forte, MA la deviazione deve comunque servire l'angle e il pillar del seed e i
//    doDont/theme del batch — si devia sulla messa in scena, mai sullo scopo del post.
//    Quando devia, dichiara il perché in UNA riga (scene_deviation → PreviewPost.sceneDeviation
//    → posts.qc.scene_deviation), così la pagina di review può mostrare
//    "il produttore ha deviato: …". `angle` resta l'intento da servire: consultivo nel
//    fraseggio, vincolante nella sostanza.
//
// Contro il collasso, con la scena diventata consultiva, restano: doDont/theme vincolanti,
// l'obbligo di servire angle+pillar, e detectSceneCollapse dopo il pass 2.

// One planned post BEFORE the copy/image craft is written: the skeleton + its angle.
export type PostSeed = {
  // Assegnato alla reidratazione in normalizeWeeklyStrategy (unico punto di derivazione): i seed
  // freschi del pass 1 possono non averlo finché la bozza non è normalizzata.
  id?: string;
  platform: string;
  // Full publish target set (primary first) when this post is cross-posted; [platform] otherwise.
  platforms: string[];
  // The content pillar this post serves ("Scopo") — e.g. "CTA verso sito", "UGC e recensioni".
  pillar: string;
  format: ContentFormat;
  // Carousel seeds only: how many slides the series needs (clamped 3..CAROUSEL_MAX_SLIDES).
  // undefined for every other format. Quando ci sono le BATTUTE, le seguono: sono loro a dire
  // quanto è lunga la storia.
  slide_count?: number;
  // SOLO CAROSELLI — la storia, una battuta per slide, decisa nel PIANO. LIVELLO VINCOLANTE (vedi
  // il contratto sopra): senza, il produttore riceve una riga di `angle` e improvvisa N immagini,
  // che è esattamente il motivo per cui un carosello narrativo non arrivava mai in fondo. Vuoto →
  // comportamento di prima, il produttore compone lui la serie.
  beats?: string[];
  // Il MEDIUM di questo post: fumetto, illustrazione, collage, reportage. Arriva dalla rubrica
  // (applyRubricToSeed) o dal planner per un one-off, e BATTE il visual_style del brand.
  art_direction?: string;
  // Approved-rubric linkage (brands with rubrics only): the series NAME the planner picked and
  // the resolved rubric row id. Absent when the brand has no approved rubrics.
  rubric?: string;
  rubric_id?: string;
  media: 'image' | 'text' | 'link' | 'video';
  // SOLO SEED VIDEO — il copione parlato. LIVELLO VINCOLANTE (vedi contratto sopra): il copione è
  // formato, non scena, e una clip senza è uno still animato. Scritto a budget di parole (~3.3/s
  // con margine, vedi ugc.ts) così la CTA si accorcia scrivendo invece di troncarsi al render.
  //   hook — richiamo (~primo 15%): il dolore e il desiderio sotto, prodotto NON ancora
  //   body — problema + demo + prova
  //   cta  — qualifica + azione morbida
  //
  // I tre componenti dell'hook non devono dire la stessa cosa: `hook_visual` guadagna lo stop,
  // `hook` apre l'argomento, `hook_text` aggiunge la posta.
  hook?: string;
  /** What is physically HAPPENING on screen in second one. The action, not the set dressing. */
  hook_visual?: string;
  /** On-screen text over the first seconds. Must NOT restate the spoken hook. */
  hook_text?: string;
  body?: string;
  cta?: string;
  // UGC a mano invece del default cinematografico: inverte lo stile visivo del brand sulla cover,
  // di proposito.
  ugc?: boolean;
  /** Paid UGC ad (22s / Seedance 2.5). Organic UGC stays ≤15s. */
  ugc_ad?: boolean;
  day: string;
  time: string;
  // Reddit post title (required for Reddit, max 300 chars; empty for other platforms).
  title?: string;
  // URL for Reddit link posts (sharing a blog article/resource). Empty for non-link posts.
  link_url?: string;
  // Target subreddit for Reddit posts (without r/ prefix). Empty for non-Reddit posts.
  subreddit?: string;
  // Exact product name from the brand's Products list, or '' if the post isn't about one.
  product: string;
  // Exact name from the brand's People list when this post should feature that person, or ''.
  person: string;
  // L'INTENTO che il produttore deve servire: consultivo nel fraseggio, vincolante nella sostanza.
  angle: string;
  // LIVELLO CONSULTIVO — la scena PROPOSTA dal planner (vedi contratto sopra). Il produttore la
  // usa come default concreto ma può sostituirla con un'idea più forte, dichiarando il perché in
  // una riga (scene_deviation).
  subject: string; // the main subject/focus (e.g. "the founder", "the product on a desk")
  setting: string; // location/environment (e.g. "sunlit kitchen", "studio seamless")
  props: string; // supporting objects/styling (e.g. "linen napkin, fresh herbs")
  // Brand Media library id (full UUID) when this post should reuse a user-uploaded asset.
  media_id?: string;
  // How to use that asset: pixel-perfect post media vs composite into a generated frame.
  media_mode?: 'use_as_is' | 'composite' | '';
};

export type WeeklyStrategy = {
  theme: string; // the single editorial angle tying the batch together
  rationale: string; // why this theme now, grounded in what performs
  doDont: string; // sharp, brand-specific guardrails for the writer
  seeds: PostSeed[];
};

export const STRATEGY_SCHEMA = {
  type: 'object' as const,
  properties: {
    theme: { type: 'string' as const, description: "The single editorial angle/hook tying this batch of posts together (one sentence)." },
    rationale: { type: 'string' as const, description: "Why this theme now — grounded in the brand's voice and what has performed. Cite concrete patterns, not generic advice." },
    do_dont: { type: 'string' as const, description: '2-4 sharp, brand-specific do\'s and don\'ts for the copywriter.' },
    seeds: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          platform: { type: 'string' as const, description: 'One of the requested platforms only — the PRIMARY channel (drives the visual aspect ratio and the caption register)' },
          cross_platforms: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description:
              "OTHER requested platforms where this exact post should ALSO be published as-is (same visual, same caption) — cross-posting multiplies distribution without growing the batch. Only list platforms where the post works natively (e.g. Instagram ↔ Facebook, X ↔ Threads); NEVER pair clashing registers (a long LinkedIn essay does not go on X), and a text-only post can only cross-post to text-capable platforms (X, Threads, Facebook, LinkedIn) — never to Instagram/TikTok/YouTube, which require a visual. Empty array when the post is single-platform."
          },
          pillar: {
            type: 'string' as const,
            description: "The content PILLAR ('scopo') this post serves, as a short label (2-4 words) picked from the brand's content pillars or the editorial plan's content-mix types. Every seed must carry one — it is the row's WHY."
          },
          format: {
            type: 'string' as const,
            enum: [...CONTENT_FORMATS] as const,
            description:
              "How this post is PRODUCED — one of the engine's REAL formats, never invented: 'single_image' = one visual (the default for most posts); 'carousel' = a multi-slide visual sequence (Instagram/Facebook/LinkedIn ONLY, and only within the batch's carousel budget); 'text_post' = text-only (X/Threads/Reddit only — matches media 'text'); 'link_post' = a Reddit link post (matches media 'link'); 'video' = a reel/short (only when the video constraint allows it). Never a story — the engine does not produce stories."
          },
          slide_count: {
            type: 'integer' as const,
            description:
              'ONLY for carousel seeds: how many slides the series needs (3-8; prefer 4-6). The angle must genuinely sustain that many DISTINCT slides (a list, a process, a comparison, a story arc). 0 for every non-carousel seed.'
          },
          beats: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description:
              "ONLY for carousel seeds: the STORY, one beat per slide, in order — exactly slide_count entries. A beat is what THAT slide says or shows in one concrete sentence (a moment, a turn, a line of dialogue, a step), never a topic label. Together they must form a real arc: a situation, something that changes, a landing. Write them here, at plan time, so the client reads the story before approving it. Empty array for every non-carousel seed.",
          },
          art_direction: {
            type: 'string' as const,
            description:
              "The MEDIUM this post is drawn/shot in, when it must differ from the brand's default visual style: ink-and-wash comic panels, flat vector illustration, risograph collage, typographic poster, documentary photography… Include the page grammar (panels, gutters, lettering) and palette. When the seed belongs to a rubric that declares an art direction, copy that rubric's art direction VERBATIM. Empty string when the brand's default visual style is the right medium.",
          },
          media: {
            type: 'string' as const,
            enum: ['image', 'text', 'link', 'video'] as const,
            description:
              "How the post is delivered. Use 'video' whenever format is 'video' — the two go together. Use 'image' for most of the rest — X and Threads carry photos perfectly well, so 'text' there is a deliberate choice, never their default. Use 'text' ONLY for X or Threads when a sharp text-only post is stronger than a visual, OR for Reddit text posts (a discussion, question, or guide with a title + body). Use 'link' ONLY for Reddit link posts (sharing a blog article or resource URL — also fill link_url). NEVER 'text' or 'link' on Instagram, TikTok or YouTube — those platforms require a visual."
          },
          ugc: {
            type: 'boolean' as const,
            description:
              "VIDEO seeds only. true = shoot it as UGC: one real-looking person filming themselves on a phone, talking straight into the lens, in a real room. This is the DEFAULT for video and what performs — it reads as a person, not as an advert. Set false only when the clip genuinely needs a polished product shot with no one on camera. Ignored for non-video seeds."
          },
          ugc_ad: {
            type: 'boolean' as const,
            description:
              "VIDEO + UGC only. true = paid UGC AD: 22s on Seedance 2.5 with fuller Hook→Problem→Demo→Proof→CTA (~55–66 spoken words). false/omit = organic feed UGC ≤15s (~40–48 words). Use sparingly for boost/ads creatives — most batch seeds stay organic."
          },
          hook: {
            type: 'string' as const,
            description:
              "VIDEO seeds only — HOOK call-out (~8–12 spoken words, first ~15% of ≤15s): a concrete PAIN MOMENT that sits on a Life-Force desire (comfort, respect, less fear, looking after people you love…). Label / yes-question / if-then / ridiculous-result shapes OK. Product NEVER in the hook. BAD: 'Calendar chaos? Resolve it.' GOOD: 'I was still writing captions at midnight and nothing had posted.' Empty string for non-video seeds."
          },
          hook_visual: {
            type: 'string' as const,
            description:
              "VIDEO seeds only — what is physically HAPPENING on screen in second one, in a few words. The ACTION, not the set dressing. GOOD: 'hands ripping a printed report in half'. BAD: 'sunlit kitchen'. This is what earns the stop; the spoken line only gets heard if the visual buys the second. Empty string for non-video seeds."
          },
          hook_text: {
            type: 'string' as const,
            description:
              "VIDEO seeds only — the on-screen text burned over the first seconds (max ~6 words). It must NOT restate the spoken hook: the visual earns the stop, the spoken line opens the argument, the text adds the STAKE or calls out WHO this is for. If spoken is 'I stopped sending clients reports', the text is 'agencies: read this', never the same sentence. Empty string for non-video seeds."
          },
          body: {
            type: 'string' as const,
            description:
              "VIDEO seeds only — PROBLEM + DEMO + PROOF (~18–28 spoken words). Cost of the pain, THEN give away the mechanic out loud (one concrete step), THEN one proof detail. Concise, personal — never product-first, never a rant. Empty string for non-video seeds."
          },
          cta: {
            type: 'string' as const,
            description:
              "VIDEO seeds only — CTA (~6–10 spoken words): qualify the viewer then soft action. Example: 'anyway if you're done guessing, try Anomalia and tell me I'm wrong.' Empty string for non-video seeds."
          },
          title: {
            type: 'string' as const,
            description: "REQUIRED for Reddit (max 300 chars, cannot be edited after posting) and YouTube (max 100 chars — the video title). For other platforms, empty string — the caption serves as the text."
          },
          link_url: {
            type: 'string' as const,
            description: "A page URL to share, copied VERBATIM from the LINKABLE PAGES list (never invent, guess, or shorten). Two uses: (1) a Reddit link post (media:'link') where the post IS the link; (2) an X, Threads, LinkedIn or Facebook post that references one of those pages — the URL goes into its caption. Leave EMPTY on Instagram/TikTok/YouTube (links aren't clickable there) and whenever no listed page genuinely fits the angle — don't force a link."
          },
          subreddit: {
            type: 'string' as const,
            description:
              "Only for Reddit posts: the target subreddit name WITHOUT the r/ prefix (e.g. 'marketing', not 'r/marketing'). Prefer the brand's KNOWN SUBREDDITS listed in the brief when one fits; otherwise the most relevant real active sub. Empty string for non-Reddit posts."
          },
          day: { type: 'string' as const, description: 'Day of week, e.g. Monday' },
          time: { type: 'string' as const, description: 'HH:MM' },
          product: {
            type: 'string' as const,
            description: "If this post features a specific offering, its EXACT name copied verbatim from the Offerings list (a product, service, project or feature). Empty string if not about a specific offering."
          },
          person: {
            type: 'string' as const,
            description: "If this post should feature one of the brand's PEOPLE (creator/founder/avatar), their EXACT name copied verbatim from the People list. Empty string otherwise. Only use a person when it genuinely strengthens the post."
          },
          angle: { type: 'string' as const, description: "One line: what THIS post says or shows — the specific hook/idea, distinct from every other seed." },
          subject: { type: 'string' as const, description: 'The concrete main subject/focus of the visual (e.g. "the product held in hand", "the founder mid-laugh").' },
          setting: { type: 'string' as const, description: 'The location/environment for the visual (e.g. "sunlit kitchen counter", "neutral studio seamless").' },
          props: { type: 'string' as const, description: 'Supporting objects/styling in the scene (e.g. "linen napkin, fresh herbs"); empty string if none.' },
          media_id: {
            type: 'string' as const,
            description:
              "When a MEDIA LIBRARY asset fits this seed, copy its FULL UUID verbatim from the MEDIA LIBRARY list. Prefer this over inventing a new AI scene whenever a real uploaded photo/video still works. Empty string when generating a new visual from scratch."
          },
          media_mode: {
            type: 'string' as const,
            enum: ['use_as_is', 'composite'],
            description:
              "ONLY when media_id is set: 'use_as_is' = publish the user's asset pixel-perfect as the post image (preferred for photos/product/person shots); 'composite' = Nano Banana generates a branded frame that integrates the asset with high fidelity (logos, graphics, or when light restyle/overlay is needed). OMIT this field entirely (do not set it to an empty string) when media_id is empty."
          }
        },
        required: ['platform', 'cross_platforms', 'pillar', 'format', 'slide_count', 'media', 'title', 'link_url', 'subreddit', 'day', 'time', 'product', 'person', 'angle', 'subject', 'setting', 'props', 'media_id']
      }
    }
  },
  required: ['theme', 'rationale', 'do_dont', 'seeds']
};

// applyRubricToSeed + i clamp di capacità, nell'ordine ESATTO in cui planStrategy li esegue: il
// formato della rubrica batte la proposta del Pass 1, e ogni divergenza residua è FISICA della
// piattaforma, mai la preferenza del Pass 1 che vince. Loggata, così un episodio degradato si vede.
export function resolveSeedWithRubrics(seed: PostSeed, rubrics: Rubric[]): PostSeed {
  const resolved = clampMediaCapabilities(applyRubricToSeed(seed, rubrics));
  if (resolved.rubric_id) {
    const r = rubrics.find((x) => x.id === resolved.rubric_id);
    if (r && resolved.format !== r.format) {
      console.warn(`[rubrics] episode of "${r.name}" (${r.format}) degraded to ${resolved.format} on ${resolved.platform} — the platform can't carry the rubric's format`);
    }
  }
  return resolved;
}

// STRATEGY_SCHEMA + il campo `rubric`, costruito SOLO se il brand ha rubriche approvate: senza,
// lo schema resta identico byte per byte.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function strategySchemaWithRubrics(names: string[]): any {
  const seedItem = STRATEGY_SCHEMA.properties.seeds.items;
  return {
    ...STRATEGY_SCHEMA,
    properties: {
      ...STRATEGY_SCHEMA.properties,
      seeds: {
        ...STRATEGY_SCHEMA.properties.seeds,
        items: {
          ...seedItem,
          properties: {
            ...seedItem.properties,
            rubric: {
              type: 'string' as const,
              description: `The APPROVED RUBRIC this seed is an episode of — EXACTLY one of: ${names.map((n) => `"${n}"`).join(', ')} (copied verbatim). Empty string ONLY for a deliberate out-of-series post (something timely no rubric covers).`
            }
          },
          required: [...seedItem.required, 'rubric']
        }
      }
    }
  };
}

// Execution only writes the craft (caption + image_prompt); every structural field comes from
// the seed, so we keep the schema minimal and zip the outputs back onto the seeds by index.
export const EXEC_SCHEMA = {
  type: 'object' as const,
  properties: {
    posts: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          caption: { type: 'string' as const, description: "On-brand caption that delivers this seed's angle, written at the length and register the PLATFORM PLAYBOOK specifies for this seed's platform (long-form for LinkedIn, one tight line for X, etc.), with a platform-appropriate number of hashtags. For Reddit TEXT posts this is the body (Markdown paragraphs); for Reddit LINK/IMAGE posts this is a short body/description. For non-Reddit platforms this is the full post text." },
          title: { type: 'string' as const, description: "For Reddit posts: the post title (max 300 chars). For YouTube posts: the video title (max 100 chars). For other platforms: empty string." },
          image_prompt: {
            type: 'string' as const,
            description: "Prompt for a photorealistic, scroll-stopping image fitting the platform/format (the renderer sets the aspect ratio — don't specify one) and matching the brand VISUAL STYLE, grounded in the seed's subject/setting/props. For video formats describe a strong cover frame. Empty string when the seed's media is 'text'."
          },
          slide_prompts: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description:
              "ONLY for a carousel seed: one image prompt per slide, EXACTLY the seed's slide count, forming ONE coherent visual series — same medium, palette, lighting and art direction across all slides. Slide 1 is the scroll-stopping hook/cover; each later slide advances the seed's angle one step (a list item, a process step, a comparison side). Every prompt must describe its slide STANDALONE (never 'same as previous'). Empty array for every non-carousel seed."
          },
          alt_captions: { type: 'array' as const, items: { type: 'string' as const }, description: '1-2 alternative captions taking a different angle on the same post.' },
          x_caption: { type: 'string' as const, description: "The SAME post rewritten to fit X: max 280 characters, one tight line, at most 1-2 hashtags. Empty string when the seed's own platform is already X." },
          threads_caption: { type: 'string' as const, description: "The SAME post rewritten to fit Threads: max 500 characters, conversational. Empty string when the seed's own platform is already Threads." },
          first_comment: { type: 'string' as const, description: 'A seeded first comment (extra hashtags or a CTA/question to drive engagement). Empty string if none.' },
          hook_variants: { type: 'array' as const, items: { type: 'string' as const }, description: '1-2 alternative opening lines/hooks for the caption.' },
          scene_deviation: {
            type: 'string' as const,
            description:
              "ONLY when you replaced the seed's proposed scene (subject/setting/props) with a stronger idea: ONE line saying why yours serves the angle better. Empty string when you followed the proposal (the normal case)."
          }
        },
        required: ['caption', 'title', 'image_prompt', 'slide_prompts', 'alt_captions', 'x_caption', 'threads_caption', 'first_comment', 'hook_variants', 'scene_deviation']
      }
    }
  },
  required: ['posts']
};

/**
 * THE NO-DUPLICATION RULE for a video hook's three components.
 *
 * The visual earns the stop, the spoken line opens the argument, the on-screen text adds the stake
 * or names who this is for. If the text repeats the spoken line, one of the three carries nothing —
 * and a model handed two text fields for the same moment returns the same sentence twice more often
 * than not.
 *
 * Enforced in CODE and not only in the prompt, because a prompt rule that nothing checks is a
 * suggestion. A duplicate is dropped rather than rewritten: rewriting needs a model, and an empty
 * overlay is strictly better than one that spends the slot echoing the audio.
 *
 * Exported for the test — pure, mutates in place like the other clamps here.
 */
export function enforceHookComponents<T extends { hook?: string; hook_text?: string }>(seeds: T[]): number {
  let dropped = 0;
  for (const seed of seeds) {
    const spoken = String(seed.hook ?? '').trim();
    const onScreen = String(seed.hook_text ?? '').trim();
    if (!spoken || !onScreen) continue;
    const words = (t: string): Set<string> =>
      new Set(
        t
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, ' ')
          .split(/\s+/)
          .filter((w) => w.length > 2)
      );
    const a = words(spoken);
    const b = words(onScreen);
    if (!a.size || !b.size) continue;
    let shared = 0;
    for (const w of b) if (a.has(w)) shared++;
    // Measured against the SHORTER side: an overlay that is a six-word excerpt of the spoken line
    // is a full duplicate even though it overlaps little of the sentence it was cut from.
    if (shared / Math.min(a.size, b.size) >= 0.6) {
      seed.hook_text = '';
      dropped++;
    }
  }
  if (dropped) console.warn(`[hook] dropped ${dropped} on-screen line(s) that restated the spoken hook`);
  return dropped;
}

export function clampVideos<
  T extends { format: ContentFormat; media: 'image' | 'text' | 'video' | 'link'; platform?: string; hook?: string }
>(items: T[], maxVideos: number, ladder?: LadderContext): void {
  // WHICH videos survive the cap, not just how many. The cap is a budget; spending it on whichever
  // clips the planner happened to list first allocates real money by array order. With a ladder
  // context the clips whose ANGLE has earned the spend keep their format and the unproven ones
  // become statics — same cap, same cost, better bet. See `production-ladder.ts`.
  const order = ladder
    ? byLadderPriority(items, (item) =>
        item.format === 'video' ? ladderFor(classifyHookTactic(item.hook)?.tactic ?? null, ladder).rung : 1
      )
    : items;

  let kept = 0;
  for (const item of order) {
    if (item.format !== 'video') continue;
    // YouTube cannot become a still — keep the clip even when the batch is over the video cap.
    const videoOnly = VIDEO_ONLY.has(platformKey(item.platform));
    if (videoOnly || kept < maxVideos) {
      kept += 1;
      continue;
    }
    // Over the cap → downgrade to a single image; media:'image' keeps it in image rendering.
    item.format = 'single_image';
    item.media = 'image';
  }
}

/**
 * The brand's ladder context, derived from the same history the planners already read.
 *
 * `coldStart` is true whenever there is nothing to rank — no classified openings, or a sample too
 * small for "this one won" to mean anything (`hookCoverage` withholds the winner flag itself, so an
 * empty `proven` on a real history simply means nothing has separated from the mean yet).
 */
export function ladderContextFrom(
  insights: { hooks?: { used: HookTacticId[]; proven: HookTacticId[] } } | null | undefined
): LadderContext {
  const tried = insights?.hooks?.used ?? [];
  return { proven: insights?.hooks?.proven ?? [], tried, coldStart: tried.length === 0 };
}

// Downgrade every carousel past the cap to a single image — the COST guardrail (an N-slide
// carousel renders ~N images). Mirrors clampVideos; maxCarousels 0 = the kill switch.
export function clampCarousels<T extends { format: ContentFormat; slide_count?: number; beats?: string[] }>(items: T[], maxCarousels: number): void {
  let kept = 0;
  for (const item of items) {
    if (item.format !== 'carousel') continue;
    if (kept < maxCarousels) {
      kept += 1;
      continue;
    }
    item.format = 'single_image';
    item.slide_count = undefined;
    // Le battute vivono solo su un carosello. Questo declassamento gira DOPO
    // clampMediaCapabilities, che è il posto dove quella regola sta scritta: senza toglierle qui,
    // l'immagine singola si porta dietro una storia che nessuno renderà.
    item.beats = undefined;
  }
}

// Re-hydrate a WeeklyStrategy from stored/user-edited JSON (content_plans.seeds): never trust the

export type ImagePart = { inlineData: { mimeType: string; data: string } };

export const MAX_COMPETITOR_MOOD_IMAGES = 4;
