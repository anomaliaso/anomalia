import { swallow } from '$lib/server/swallow';
import { type AnyRec, type BrandProfile, type ImagePart, MAX_COMPETITOR_MOOD_IMAGES, type PreviewPost, platformKey } from './seed-model';
import { DIGITAL_SOURCE_TYPE, markImage } from '$lib/server/content-credentials';
import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { env } from '$env/dynamic/private';
import { fetchImagePart } from '$lib/server/brand-context';
import { getBrandContext, getOrgContext } from '$lib/server/ai-log';
import { NANO_BANANA_2_LITE } from '$lib/server/google-models';
import { GEMINI_NANO_BANANA_2, googleImageModel } from '$lib/image-models';
import { structured } from '$lib/server/research';
import { signKnowledgePaths } from '$lib/server/media-archive';
import { generateImageOnKie } from '$lib/server/kie-jobs';
import { generateImageOnOpenrouter } from '$lib/server/openrouter-image';
import { route } from '$lib/server/model-routing';
import { signPaths } from '$lib/server/people';
import { svgToPng } from '$lib/server/brand-analysis';
import { normalizeContentFormat } from '$lib/content-formats';
import { firstLogoUrl } from '$lib/brand-fields';
import { designWallDigestSection } from '$lib/server/wall-digest';


// Image MIME types Gemini ingests directly (SVG is rasterised via svgToPng).
const RASTER_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']);

// Best-effort: un logo mancante o strano non deve mai rompere la generazione.
export async function fetchLogoPart(url: string): Promise<ImagePart | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    let mime = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() || 'image/png';
    if (mime === 'image/jpg') mime = 'image/jpeg';
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 6_000_000) return null;
    if (mime === 'image/svg+xml' || /\.svg(\?|$)/i.test(url)) {
      const png = await svgToPng(buf);
      return png ? { inlineData: { mimeType: 'image/png', data: png.toString('base64') } } : null;
    }
    if (!RASTER_IMAGE_MIME.has(mime)) return null;
    return { inlineData: { mimeType: mime, data: buf.toString('base64') } };
  } catch {
    return null;
  }
}

/** Official brand-kit mark as an image part (skips og-image banners). Used by chat generate_image. */
export async function loadBrandLogoImagePart(logos: unknown): Promise<ImagePart | null> {
  const url = firstLogoUrl(logos);
  return url ? fetchLogoPart(url) : null;
}

// Palette + tipografia iniettate in OGNI render, o i grafici escono fuori marchio. '' senza
// colori/font.
export function brandVisualDirective(colors?: string[] | null, fonts?: string[] | null): string {
  const palette = (colors ?? []).filter(Boolean).slice(0, 6);
  const fams = (fonts ?? []).filter(Boolean).slice(0, 3);
  if (!palette.length && !fams.length) return '';
  const lines = [
    'BRAND IDENTITY — keep this unmistakably the SAME brand across every post:',
    palette.length
      ? `- Colour palette: ${palette.join(', ')}. Any graphic elements, backgrounds, UI, charts or on-image text MUST use these brand colours; photographic scenes must harmonise with them. Never introduce an off-brand colour scheme. The codes are how the colours are named to you, never something to show: never draw, letter, print or label a colour code anywhere in the image.`
      : '',
    fams.length ? `- Typography: use ${fams.join(', ')} (or a very close match) for any text or graphic elements.` : ''
  ].filter(Boolean);
  return lines.join('\n');
}

// Rapporto d'aspetto ottimale per piattaforma. Feed-safe di default: Instagram/Facebook rifiutano
// un 9:16 come post immagine (ammesso 0.75–1.91), quindi le foto non vanno mai verticali lì.
// TikTok è l'eccezione, le sue foto sono verticali native.
//
// `format` lo scavalca sui post VIDEO, e regge un peso: l'image-to-video deriva le dimensioni della
// clip DALLA COVER (il suo input aspect_ratio vale solo in multi-immagine), quindi una cover 4:5
// dà una clip 4:5 — sbagliata per Reels/TikTok/Shorts. La cover di un post video è un FRAME
// SORGENTE, non uno still pubblicabile, e va 9:16 ovunque. Il prezzo: se il render della clip
// fallisce, il post ripiega su quel 9:16 e Instagram lo rifiuta — accettabile perché il ripiego è
// raro e VISIBILE, dove un Reel deformato in silenzio non lo è.
export type AspectRatio = '1:1' | '4:5' | '9:16' | '16:9';

// Metà del prezzo di output immagine di Pro, e un articolo rende 3 immagini contro 1 di un post.
// I post social usano lo stesso id quando non c'è nulla da riprodurre; con riferimenti, Lite.
export const BLOG_IMAGE_MODEL = GEMINI_NANO_BANANA_2;

const ASPECT_LABEL: Record<AspectRatio, string> = {
  '1:1': 'Square 1:1',
  '4:5': 'Vertical portrait 4:5',
  '9:16': 'Vertical full-screen 9:16',
  '16:9': 'Landscape 16:9'
};
export function aspectRatioFor(platform: string | null | undefined, format?: unknown): AspectRatio {
  if (format !== undefined && normalizeContentFormat(format) === 'video') return '9:16';
  const p = platformKey(platform);
  if (p === 'tiktok' || p === 'youtube') return '9:16'; // vertical-native (YouTube Shorts)
  if (p === 'x') return '16:9'; // landscape-native feed
  if (p === 'instagram' || p === 'facebook' || p === 'linkedin' || p === 'threads' || p === 'bluesky') return '4:5'; // portrait feed
  return '1:1'; // reddit and anything else
}

// Il gemello visivo di HOUSE_VOICE: alza il pavimento di OGNI render lasciando palette, mood e
// soggetti interamente a visualStyle + brandLook.
// Tetto di ragionamento per i JUDGE: valutano contro una rubrica già scritta nel prompt e
// restituiscono un verdetto corto. Il thinking si fattura a tariffa OUTPUT, e lasciati liberi
// questi erano le chiamate meno efficienti del sistema (14x e 9x thinking per token restituito).
// Su 3.7 Flash non esiste 'off': 'low' è il pavimento.

const HOUSE_LOOK = `IMAGE QUALITY BAR (non-negotiable, applies ON TOP of the brand style):
photographic scenes must read as a real editorial/commercial photograph — believable optics (a real lens, natural depth of field), true-to-life materials and skin, natural colour grading. AVOID every AI/stock cliché: over-saturated HDR glow, waxy plastic skin, 3D-render sheen, impossible reflections, floating objects, warped hands or extra fingers, garbled or invented text, watermark-like artifacts, stiff stock-photo posing, and the generic "object on dark textured stone" backdrop. If the prompt does not explicitly ask for on-image text, render NO text at all.`;

// Via il genere e il fisico dal prompt quando ci sono foto di riferimento: il renderer segue
// "young man" più della faccia nei riferimenti. L'abbigliamento resta, l'identità viene dalle foto.
export function scrubPersonAppearance(prompt: string): string {
  let s = String(prompt ?? '');
  if (!s.trim()) return s;
  s = s.replace(
    /\b(?:a|an|the)\s+(?:young|old|middle[- ]aged|attractive|handsome|beautiful|pretty)?\s*(?:looking\s+)?(?:man|woman|boy|girl|guy|lady|gentleman|male|female|gentleman)\b/gi,
    'the person'
  );
  s = s.replace(
    /\b(?:young|old|middle[- ]aged)\s+(?:man|woman|boy|girl|guy|lady|male|female)\b/gi,
    'the person'
  );
  s = s.replace(/\b(?:he|she)\s+is\s+a\s+(?:man|woman|boy|girl|male|female)\b/gi, 'the person');
  s = s.replace(/\b(?:gender(?:ed| presentation)?|biological sex)\s*:\s*\w+\b/gi, '');
  s = s.replace(/\b(?:male|female|masculine|feminine)\s+(?:presenting|presentation|looking|coded)\b/gi, '');
  s = s.replace(/\b(?:as a|portray(?:ing|ed as)?(?: a)?)\s+(?:man|woman|boy|girl|male|female)\b/gi, 'as the person');
  // Fisico inventato (l'abbigliamento resta): "short hair", "bearded", tipi di corporatura.
  s = s.replace(
    /\b(?:with|featuring|showing)\s+(?:a\s+)?(?:beard|mustache|moustache|stubble|long hair|short hair|bald head|muscular build|athletic build|curvy figure)\b/gi,
    ''
  );
  return s.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

export type RenderImageOpts = {
  referenceImages?: ImagePart[];
  personImages?: ImagePart[];
  moodImages?: ImagePart[];
  userRefImages?: ImagePart[];
  visualStyle?: string;
  visualPlaybook?: string;
  referenceMode?: 'product' | 'ui';
  brandLook?: string;
  logoImage?: ImagePart;
  baseImage?: ImagePart;
  /** Il modello con cui il brand MODIFICA. Vale solo con `baseImage`: senza, non c'e' nulla da modificare. */
  refineModel?: string;
  aspectRatio?: AspectRatio;
  model?: string;
  craftFloor?: string;
};

/**
 * La richiesta al modello (prompt + parti + config) SENZA chiamare l'API. Separata da
 * renderPostImage così il percorso Batch costruisce richieste identiche byte per byte: riassemblare
 * questo prompt a mano significa vederlo divergere alla prima modifica di uno dei due lati.
 */
export function buildImageRequest(imagePrompt: string, opts: RenderImageOpts = {}) {
  const aspectRatio = opts.aspectRatio ?? '1:1';
  // Il default di render è Nano Banana 2 Lite OVUNQUE: decisione di prodotto del 2026-08, Lite al
  // posto di Pro su ogni superficie. Il ramo senza riferimenti era rimasto indietro sul modello
  // pieno, ed è dove cade la maggioranza delle immagini — un prompt e basta: misurate a $0,06 a
  // chiamata. Un opts.model esplicito vince comunque, ed è la strada per riportare un call site
  // sul modello pieno senza deploy; il blog lo fa già, passando BLOG_IMAGE_MODEL.
  const needsFidelity = !!(
    opts.personImages?.length ||
    opts.referenceImages?.length ||
    opts.userRefImages?.length ||
    opts.baseImage
  );
  // `baseImage` e' l'unico segnale che distingue una MODIFICA da un disegno nuovo, e passa tutto
  // di qui: un riferimento o un mood sono cose da riprodurre, non una base da modificare, quindi
  // non attivano il modello di refine — altrimenti la scelta di generazione del brand sparirebbe
  // su meta' dei suoi post senza che nessuno l'abbia toccata.
  const imageModel =
    (opts.baseImage ? opts.refineModel : undefined) ??
    opts.model ??
    (needsFidelity ? NANO_BANANA_2_LITE : env.IMAGE_MODEL_NO_REF || NANO_BANANA_2_LITE);
  // Con foto di persona, il testo sul genere non deve mai scavalcare le foto.
  const cleanPrompt = opts.personImages?.length ? scrubPersonAppearance(imagePrompt) : imagePrompt;
  const styleSuffix = opts.visualStyle ? `\n\nBRAND VISUAL STYLE to match: ${opts.visualStyle}` : '';
  const brandSuffix = opts.brandLook ? `\n\n${opts.brandLook}` : '';
  // Direttive visive estratte dai post migliori del brand, date al renderer e non solo al
  // copywriter.
  const playbookSuffix = opts.visualPlaybook ? `\n\n${opts.visualPlaybook}` : '';
  // L'immagine ATTUALE del post: il modello la modifica in loco invece di ricomporne una nuova,
  // così il feedback dell'utente agisce sull'immagine che sta guardando.
  const baseSuffix = opts.baseImage
    ? '\n\nThe FIRST attached image is the post\'s CURRENT image — treat it as the BASE to edit. Apply ONLY the change the prompt asks for and keep everything else (subject, composition, framing, lighting and style) faithful to this base image. Edit it, do not regenerate a different scene from scratch.'
    : '';
  // Il logo VERO, o il modello inventa un wordmark. Morbido di proposito: dove il branding appare,
  // non sulle foto candid.
  const logoSuffix = opts.logoImage
    ? '\n\nThe brand\'s actual LOGO is attached as a reference. Whenever the design shows the brand\'s wordmark/logo or any on-image branding, reproduce THIS EXACT logo faithfully and legibly — never redraw, restyle or invent a different wordmark. On a candid photo with no branding, you may omit it.'
    : '';
  // L'identità, presentazione di genere inclusa, si blocca DALLE FOTO: il prompt non deve
  // inventare il fisico da un nome androgino.
  const personSuffix = opts.personImages?.length
    ? '\n\nReference photo(s) of the person are attached: they are the ONLY source of identity. Match their face, gender presentation, approximate age, hair, skin and distinguishing features EXACTLY as shown in the photos — never invent or override appearance from the person\'s name or from any gendered words in the text brief (ignore man/woman/boy/girl/male/female if the text says them). Wardrobe and styling MAY follow the brief. Give them a genuine NATURAL expression and relaxed body language that fit the scene (a real smile, mid-laugh, candid in-between), in natural light with authentic framing — never a stiff stock-photo look.'
    : '';
  //  - 'ui': screenshot di software → UI fedele ma dentro un contesto reale (mockup o UGC), perché
  //    uno screenshot grezzo non è un post.
  //  - 'product' (default): oggetto fedele, scena ristilizzata.
  const refSuffix = !opts.referenceImages?.length
    ? ''
    : opts.referenceMode === 'ui'
      ? '\n\nThe attached reference is a screenshot of the product\'s user interface. Reproduce the on-screen UI faithfully and legibly, then present it inside a realistic context — a laptop or phone screen, a clean browser-window mockup, or held/used by a person in a natural UGC-style scene — restyling only the surrounding environment to fit the brand. Do NOT distort, blur or invent UI elements.'
      : '\n\nThe attached photo IS the real product. Reproduce THIS EXACT product faithfully — identical shape, COLOUR, materials, finish, label/branding, proportions and details. CRITICAL: keep the product\'s real colours exactly as shown in the reference photo — if it is red and blue, it stays red and blue; NEVER desaturate, greyscale or recolour it to match the brand palette. The brand\'s monochrome/visual style applies ONLY to the background, scene and lighting — the product itself always keeps its true colours. If the reference shows a SET or MULTIPLE units (e.g. a full keycap set, a pack of switches), depict the set/multiple units, not a single isolated piece. Do NOT redesign, restyle or "improve" the product, and do not swap it for a similar-looking one. Restyle ONLY the scene, background and lighting to fit the brand.';
  // I riferimenti di mood guidano solo l'ESTETICA, mai il contenuto.
  const moodSuffix = opts.moodImages?.length
    ? '\n\nAdditional image(s) are attached purely as STYLE & MOOD references — the brand\'s own reference shots. Draw on their overall aesthetic (colour grading, lighting, composition, framing, texture, atmosphere and vibe) so this image feels unmistakably part of the same brand. Do NOT copy their specific subjects, objects, people or any text — they guide the LOOK and FEELING, never the content.'
    : '';
  // Riferimenti allegati dall'utente per QUESTO edit: aperti — è il testo del feedback a decidere
  // cosa prenderne.
  const userRefSuffix = opts.userRefImages?.length
    ? '\n\nThe user attached the following image(s) as REFERENCES for this specific edit — use them to guide the change described above: match the look, composition, colours or subject they show, as the feedback implies. Let the user\'s instruction decide exactly what to take from them.'
    : '';
  const text = `${cleanPrompt}\n\n${ASPECT_LABEL[aspectRatio]}, high quality, social-media ready. No text overlays unless natural.\n\n${HOUSE_LOOK}${opts.craftFloor ?? ''}${styleSuffix}${brandSuffix}${playbookSuffix}${baseSuffix}${logoSuffix}${personSuffix}${refSuffix}${userRefSuffix}${moodSuffix}`;
  // L'immagine base va per PRIMA: il prompt la chiama "the FIRST attached image". I mood per ultimi.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [{ text }, ...(opts.baseImage ? [opts.baseImage] : []), ...(opts.logoImage ? [opts.logoImage] : []), ...(opts.personImages ?? []), ...(opts.referenceImages ?? []), ...(opts.userRefImages ?? []), ...(opts.moodImages ?? [])];
  return {
    model: imageModel,
    contents: [{ role: 'user' as const, parts }],
    // imageConfig.aspectRatio è il controllo autoritativo; l'etichetta nel prompt tiene solo la
    // composizione descritta coerente con esso.
    config: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio } }
  };
}

export async function renderPostImage(
  imagePrompt: string,
  opts: RenderImageOpts = {}
): Promise<string | undefined> {
  // Le immagini sono ~66% della spesa AI, quindi la quota si applica QUI, al chokepoint: un loop
  // in un flusso qualunque si ferma alla quota invece di bruciare per giorni. L'import dinamico
  // evita il ciclo di moduli crediti↔scheduler↔qui.
  //
  // Chi paga ha DUE forme, e leggerne una sola lasciava il punto più caro del prodotto senza
  // controllo appena il brand smetteva di essere obbligatorio. Nessuna delle due — un flusso
  // pre-brand come l'analisi del sito in onboarding — resta senza cancello com'era.
  const gateBrand = getBrandContext();
  const gateOrg = getOrgContext();
  if (gateBrand || gateOrg) {
    const { gateCredits, gateOrgCredits } = await import('$lib/server/credits');
    await (gateBrand ? gateCredits(gateBrand) : gateOrgCredits(gateOrg as string));
  }
  const req = buildImageRequest(imagePrompt, opts);
  const imageModel = req.model;
  // OpenRouter serve lo STESSO modello Google in una richiesta sincrona: 3,4s di media contro 25,0s
  // su kie, e senza createTask/polling non esiste il task abbandonato-e-fatturato. Costa il 68% in
  // più per render ($0,0336 contro ~$0,020), quindi è una scelta di latenza, non di risparmio.
  // Nessun ritentativo qui: un fallimento sincrono torna già diagnosticato, e `generateImageOnOpenrouter`
  // alza l'eccezione invece di restituire un successo vuoto.
  if (route('image').endpoint === 'openrouter') {
    return await generateImageOnOpenrouter(
      { ...req, model: googleImageModel(req.model, NANO_BANANA_2_LITE) },
      { context: `image:${imageModel}` }
    );
  }
  // Nano Banana gira su kie: stesso modello, −33%/−40% per immagine (misurato sui crediti
  // addebitati). È l'UNICO punto da cambiare perché ogni render del prodotto passa di qui.
  //
  // Due tentativi, non tre: su kie il fallimento arriva già diagnosticato in pochi secondi.
  // Il ritentativo vale su un RIFIUTO, che non ci è costato niente. Su una SCADENZA no: kie sta
  // ancora renderizzando quel task e lo fatturerà comunque, quindi aprirne un secondo è chiedere
  // lo stesso lavoro due volte — proprio quando il fornitore è in affanno — e pagarlo due volte.
  // Si riprende lo stesso taskId.
  let resumeTaskId: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    // L'URL di kie vive 24 ore: non deve sopravvivere alla funzione, men che meno finire in una
    // riga del database.
    const viaKie = await generateImageOnKie(req, {
      context: `image:${imageModel}`,
      resumeTaskId
    });
    if (viaKie.dataUrl) return viaKie.dataUrl;
    resumeTaskId = viaKie.timedOutTaskId;
  }
  throw new Error(
    resumeTaskId
      ? `kie task ${resumeTaskId} (${imageModel}) still unfinished — it is rendering and will be billed`
      : `No image returned from kie (${imageModel}) after 2 attempts`
  );
}

/**
 * Il verdetto del critico immagini NON esiste piu': niente candidati paralleli, niente ritentativi,
 * un'immagine = un render. Il tipo resta perche' `posts.qc` e' una colonna viva che porta anche
 * altro (`scene_deviation`, che scrive il produttore, non il critico) e i suoi lettori continuano a
 * leggerla. Sul percorso immagine il campo ora e' sempre assente, che e' la verita': nessuno ha
 * giudicato quel render.
 */
export type QcVerdict = {
  score: number;
  pass: boolean;
  issues: string[];
  retried: boolean;
  attempts: number;
  capped?: boolean;
  candidates?: number;
};

// Una slide di seguito (2..N), ancorata alla slide 1 finita come riferimento di stile, con un QC
// LEGGERO (solo fedeltà prodotto, un ritentativo, niente best-of-N). Tenere leggeri i seguiti è ciò
// che tiene un carosello a ~N render invece di N pipeline di QC complete. Una slide fallita si
// scarta, non blocca il post.
// La regola di serie che tiene N slide un oggetto solo, non N immagini: vive qui, in un posto solo,
// così la sonda creativa misura lo stesso prompt che la produzione manda.
export function carouselSeriesDirective(slideIndex: number, totalSlides: number): string {
  return `\n\nCAROUSEL SLIDE ${slideIndex + 1} of ${totalSlides} — this image is ONE SLIDE of a single carousel post. The FIRST attached style/mood reference is SLIDE 1 of the same carousel: match its medium, palette, lighting, styling and art direction EXACTLY so the whole set reads as one coherent series. Compose THIS slide's own subject as described above — never copy slide 1's composition or subject.`;
}

/**
 * UN render, con il pavimento di esecuzione del design attaccato.
 *
 * Il pavimento lo iniettava `renderWithQC`, che non esiste piu': senza un posto suo sarebbe uscito
 * dal percorso immagine insieme al critico, e nessuno se ne sarebbe accorto — non fallisce niente,
 * le immagini diventano solo un po' peggiori. Sta qui, in una funzione sola, cosi' i cinque
 * chiamanti non se lo ricopiano e non se lo dimenticano.
 */
export async function renderBrandImage(
  imagePrompt: string,
  renderOpts: RenderImageOpts = {}
): Promise<string | undefined> {
  return renderPostImage(imagePrompt, {
    ...renderOpts,
    craftFloor: renderOpts.craftFloor ?? (await designWallDigestSection())
  });
}

/** Le direttive visive estratte dai post migliori del brand, per il renderer. */
export function extractVisualPlaybook(aiContext: unknown): string {
  const m = String(aiContext ?? '').match(/WHAT WORKS VISUALLY[^\n]*\n[\s\S]*?(?=\n\n|$)/);
  return m ? m[0].trim() : '';
}

/** Cio' che i chiamanti passavano al critico e che ora serve solo a comporre il render. */
type CritiqueOpts = {
  referenceImages?: ImagePart[];
  visualStyle?: string;
  productName?: string;
};

export async function renderCarouselSlide(
  supabase: SupabaseClient,
  userId: string,
  slidePrompt: string,
  slideIndex: number, // 0-based among ALL slides; first call is 1 (slide 2 of N)
  totalSlides: number,
  renderOpts: NonNullable<Parameters<typeof renderPostImage>[1]>,
  slideOneAnchor: ImagePart | undefined,
  critiqueOpts: CritiqueOpts
): Promise<string | undefined> {
  const seriesDirective = carouselSeriesDirective(slideIndex, totalSlides);
  // La slide 1 precede i mood del brand, così domina l'ancoraggio estetico.
  const opts = { ...renderOpts, craftFloor: await designWallDigestSection(), moodImages: [...(slideOneAnchor ? [slideOneAnchor] : []), ...(renderOpts.moodImages ?? [])] };
  try {
    // Un render per slide. Il ritentativo su verdetto del critico e' sparito con il critico: una
    // slide storta si corregge con refine_image guardandola, non ridisegnandola a scatola chiusa.
    const dataUrl = await renderPostImage(slidePrompt + seriesDirective, opts);
    return dataUrl ? await uploadPostImage(supabase, userId, dataUrl, opts.aspectRatio) : undefined;
  } catch (e) {
    console.error(`[renderCarouselSlide] slide ${slideIndex + 1}/${totalSlides} failed: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

// Qualche angolazione dà al modello una presa molto migliore sul prodotto vero di un solo scatto.
export const PRODUCT_REF_IMAGES = 4;

// A brand offering (product/service/project/feature) resolved to the fields the renderer needs.
type Offering = { name: string; images: string[]; kind: string };

// Flatten a brand profile's products into offerings with their photo URLs and kind.
export function brandOfferings(profile: BrandProfile): Offering[] {
  const products = Array.isArray(profile?.products) ? profile.products : [];
  return products
    .map((p: AnyRec) => ({
      name: String(p?.name ?? p?.title ?? '').trim(),
      images: Array.isArray(p?.images) ? p.images.map(String).filter(Boolean) : [],
      kind: String(p?.kind ?? 'product')
    }))
    .filter((o: Offering) => o.name);
}

// Il planner parafrasa di continuo i titoli rumorosi dei cataloghi, e un match esatto mancherebbe:
// un miss significa nessuna foto di riferimento, cioè un prodotto INVENTATO dal generatore.
export function normalizeOfferingName(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Token di categoria che non dicono QUALE prodotto sia: non devono mai contare in un match fuzzy,
// o "Capy60 Mechanical Keyboard Kit" matcha "Parabolica60 Mechanical Keyboard Kit" sulle tre
// parole di riempimento e il renderer allega la foto SBAGLIATA.
const OFFERING_STOPWORDS = new Set([
  'mechanical', 'keyboard', 'keyboards', 'keycap', 'keycaps', 'switch', 'switches', 'kit', 'set',
  'profile', 'cherry', 'doubleshot', 'tripleshot', 'abs', 'pbt', 'linear', 'mx', 'red', 'custom',
  'mode', 'wireless', 'tri', 'hotswap', 'pcb', 'add', 'ons', 'extra', 'extras', 'default', 'choice',
  'stock', 'in', 'gb', 'group', 'buy', 'the', 'and', 'with', 'for', 'version', 'edition', 'pack'
]);

export function distinctiveTokens(name: string): Set<string> {
  return new Set(
    normalizeOfferingName(name)
      .split(' ')
      .filter((w) => w.length > 2 && !OFFERING_STOPWORDS.has(w))
  );
}

// Esatto normalizzato → contenimento → token DISTINTIVI condivisi. undefined quando niente matcha
// con sicurezza: un miss è molto più sicuro di un match sbagliato.
export function resolveOffering(productName: string | undefined, list: Offering[]): Offering | undefined {
  const q = normalizeOfferingName(productName ?? '');
  if (!q) return undefined;
  let hit = list.find((o) => normalizeOfferingName(o.name) === q);
  if (hit) return hit;
  hit = list.find((o) => {
    const n = normalizeOfferingName(o.name);
    return n.length > 2 && (n.includes(q) || q.includes(n));
  });
  if (hit) return hit;
  // Fuzzy solo sui token DISTINTIVI, mai sulle parole di categoria.
  const qt = distinctiveTokens(productName ?? '');
  if (!qt.size) return undefined;
  let best: Offering | undefined;
  let bestScore = 0; // any shared distinctive token is a real signal once filler is excluded
  for (const o of list) {
    const ot = distinctiveTokens(o.name);
    const overlap = [...ot].filter((w) => qt.has(w)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = o;
    }
  }
  return best;
}

// Una UI software si compone dentro un mockup; tutto il resto resta fedele come scatto di prodotto.
export function referenceModeFor(kind: string, siteType: string): 'product' | 'ui' {
  return kind === 'feature' || (siteType === 'saas' && kind === 'product') ? 'ui' : 'product';
}

// Un hero PNG a piena risoluzione può pesare vari MB e sfondare il cap di fetchImagePart, che lo
// scarta in silenzio: niente riferimento, e il generatore inventa il prodotto. Si chiede la
// variante ridotta via ?width=. Riscrive solo gli URL del CDN Shopify.
function refSizedUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes('cdn.shopify.com') && !u.searchParams.has('width')) {
      u.searchParams.set('width', '1600');
    }
    return u.toString();
  } catch {
    return url;
  }
}

// Qualche angolazione come image part; scarta quelle che non si scaricano.
export async function loadProductRefs(urls: string[] | undefined): Promise<ImagePart[] | undefined> {
  if (!urls?.length) return undefined;
  const parts = (await Promise.all(urls.slice(0, PRODUCT_REF_IMAGES).map((u) => fetchImagePart(refSizedUrl(u))))).filter(Boolean) as ImagePart[];
  return parts.length ? parts : undefined;
}

// Qualche angolazione tiene la faccia molto meglio di un solo scatto.
const PERSON_REF_IMAGES = 4;

// Map person name (lowercased) → its (signed, fetchable) image URLs, from a brand profile's people.
export function personImageMap(profile: BrandProfile): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const people = Array.isArray(profile?.people) ? profile.people : [];
  for (const p of people) {
    const name = p?.name;
    const imgs = Array.isArray(p?.images) ? p.images.map(String).filter(Boolean) : [];
    if (name && imgs.length) map.set(String(name).toLowerCase().trim(), imgs);
  }
  return map;
}

// Resolve a post's featured person into reference image parts, if the post names a known person.
export async function personReference(
  post: PreviewPost,
  personImages: Map<string, string[]>
): Promise<ImagePart[] | undefined> {
  const key = post.person?.toLowerCase().trim();
  if (!key) return undefined;
  const urls = personImages.get(key);
  if (!urls?.length) return undefined;
  const parts = (await Promise.all(urls.slice(0, PERSON_REF_IMAGES).map(fetchImagePart))).filter(Boolean) as ImagePart[];
  return parts.length ? parts : undefined;
}

// Con un tetto, o una libreria grande inonda la richiesta e affoga il soggetto.
const MOOD_REF_IMAGES = 3;

// How many competitor thumbnails to show the strategist as the anti-moodboard.


// Appiattite ROUND-ROBIN (la prima miniatura di ogni concorrente, poi la seconda…) così
// l'anti-moodboard mostra il CAMPO, non un concorrente solo.
// ponytail: sono URL CDN scrapati che scadono — uno stantio si risolve in null a valle; archiviarli
// come le miniature del brand se i miss diventano comuni.
export async function loadCompetitorThumbUrls(
  supabase: SupabaseClient,
  brandId: string,
  limit = MAX_COMPETITOR_MOOD_IMAGES
): Promise<string[]> {
  const { data } = await supabase.from('competitors').select('top_posts').eq('brand_id', brandId);
  // La NOSTRA copia archiviata (firmata, non scade) batte l'URL scrapato.
  const allPaths = (data ?? []).flatMap((r) =>
    Array.isArray(r.top_posts) ? (r.top_posts as AnyRec[]).map((tp) => String(tp?.archivedPath ?? '')).filter(Boolean) : []
  );
  const signed = allPaths.length ? await signKnowledgePaths(supabase, allPaths).catch((error) => { swallow('sign knowledge urls', error); return new Map<string, string>(); }) : new Map<string, string>();
  const lists = (data ?? []).map((r) =>
    Array.isArray(r.top_posts)
      ? (r.top_posts as AnyRec[])
          .map((tp) => signed.get(String(tp?.archivedPath ?? '')) ?? String(tp?.thumbnailUrl ?? ''))
          .filter(Boolean)
      : []
  );
  const out: string[] = [];
  for (let i = 0; out.length < limit; i++) {
    let added = false;
    for (const l of lists) {
      if (l[i]) {
        out.push(l[i]);
        added = true;
        if (out.length >= limit) break;
      }
    }
    if (!added) break;
  }
  return out;
}

/** Market brief (refresh if stale) + competitor anti-moodboard thumbs for any planner entrypoint. */
export async function loadPlannerMarketSignals(
  supabase: SupabaseClient,
  brandId: string
): Promise<{ marketBrief: string; competitorThumbUrls: string[] }> {
  const { ensureMarketReferences, formatMarketBrief } = await import('$lib/server/market-references');
  const [marketBrief, competitorThumbUrls] = await Promise.all([
    (async () => {
      try {
        const row = await ensureMarketReferences(supabase, brandId);
        return formatMarketBrief(row);
      } catch (e) {
        console.warn('[planner-market]', e instanceof Error ? e.message : e);
        return '';
      }
    })(),
    loadCompetitorThumbUrls(supabase, brandId).catch((error) => { swallow('load competitor thumbs', error); return [] as string[]; })
  ]);
  return { marketBrief, competitorThumbUrls };
}

/**
 * Il flag vive su ogni post e NON sull'array, così sopravvive alle ricostruzioni dello scheduler in
 * un `produced` nuovo che ripusha gli stessi riferimenti.
 */
export function isProduceApproved(posts: PreviewPost[]): boolean {
  if (!posts?.length) return false;
  // Flag per post; il marchio a livello di array resta per i chiamanti già in volo.
  if (posts.some((p) => !!(p as AnyRec).__produceApproved)) return true;
  return !!(posts as AnyRec).__produceApproved;
}

export function markProduceApproved(posts: PreviewPost[], approved: boolean): PreviewPost[] {
  (posts as AnyRec).__produceApproved = approved;
  for (const p of posts) {
    if (p) (p as AnyRec).__produceApproved = approved;
  }
  return posts;
}

/** Cover + carousel slides for multimodal review (produce reviewer / Director). */
export async function collectBatchReviewImages(
  posts: PreviewPost[]
): Promise<Array<{ inlineData: { mimeType: string; data: string }; label: string }>> {
  const out: Array<{ inlineData: { mimeType: string; data: string }; label: string }> = [];
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const urls: Array<{ url: string; label: string }> = [];
    if (p.imageUrls && p.imageUrls.length > 1) {
      p.imageUrls.forEach((url, j) => {
        if (url) urls.push({ url, label: `POST ${i} slide ${j + 1}` });
      });
    } else if (p.imageUrl) {
      urls.push({ url: p.imageUrl, label: `POST ${i}` });
    }
    for (const u of urls.slice(0, 8)) {
      const part = await fetchImagePart(u.url);
      if (part) out.push({ ...part, label: u.label });
    }
  }
  return out;
}

// Righe `brand_documents` con kind='image'; `file_url` è un path nel bucket privato
// brand-knowledge, lo stesso su cui firma signPaths.
export async function loadBrandMoodImageUrls(supabase: SupabaseClient, brandId: string): Promise<string[]> {
  const { data: rows } = await supabase
    .from('brand_documents')
    .select('file_url')
    .eq('brand_id', brandId)
    .eq('kind', 'image')
    .order('created_at', { ascending: false })
    .limit(MOOD_REF_IMAGES);
  const paths = (rows ?? []).map((r) => String(r.file_url ?? '')).filter(Boolean);
  if (!paths.length) return [];
  const signed = await signPaths(supabase, paths);
  return paths.map((p) => signed.get(p)).filter((u): u is string => !!u);
}

// Senza scatti caricati (tipico appena dopo l'onboarding) si ripiega sulle immagini del SITO: le
// immagini vere guidano l'estetica del render molto più delle ~120 parole di visual_style, e senza
// il ripiego un brand nuovo riceve render slegati dalla sua identità visiva.
export async function attachBrandMoodImages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any,
  supabase: SupabaseClient,
  brandId: string
): Promise<void> {
  if (Array.isArray(profile?.moodImages) && profile.moodImages.length) return;
  const urls = await loadBrandMoodImageUrls(supabase, brandId);
  if (urls.length) {
    profile.moodImages = urls;
    return;
  }
  if (Array.isArray(profile?.images) && profile.images.length) {
    profile.moodImages = profile.images.filter(Boolean).slice(0, MOOD_REF_IMAGES);
  }
}

// Scarta quelle che non si scaricano.
export async function loadMoodRefs(urls: string[] | undefined): Promise<ImagePart[] | undefined> {
  if (!urls?.length) return undefined;
  const parts = (await Promise.all(urls.slice(0, MOOD_REF_IMAGES).map(fetchImagePart))).filter(Boolean) as ImagePart[];
  return parts.length ? parts : undefined;
}

export type BrandVisualContext = Pick<
  RenderImageOpts,
  'visualStyle' | 'visualPlaybook' | 'brandLook' | 'logoImage' | 'moodImages'
>;

export async function loadBrandVisualContext(
  supabase: SupabaseClient,
  brandId: string
): Promise<BrandVisualContext> {
  const { data: kit } = await supabase
    .from('brand_kit')
    .select('visual_style, ai_context, brand_colors, fonts, logos')
    .eq('brand_id', brandId)
    .maybeSingle();

  const fonts = (Array.isArray(kit?.fonts) ? (kit.fonts as AnyRec[]) : [])
    .map((f) => f?.name)
    .filter(Boolean) as string[];

  const [logoImage, moodImages] = await Promise.all([
    loadBrandLogoImagePart(kit?.logos).catch((error) => {
      swallow('load brand logo part', error);
      return null;
    }),
    loadBrandMoodImageUrls(supabase, brandId)
      .then(loadMoodRefs)
      .catch((error) => {
        swallow('load mood image urls', error);
        return undefined;
      })
  ]);

  return {
    visualStyle: (kit?.visual_style as string | null) || undefined,
    visualPlaybook: extractVisualPlaybook(kit?.ai_context) || undefined,
    brandLook: brandVisualDirective(kit?.brand_colors as string[] | null, fonts) || undefined,
    logoImage: logoImage ?? undefined,
    moodImages
  };
}

// Larghezza fissa a 1080, altezza calcolata.
const ASPECT_TARGETS: Record<AspectRatio, { w: number; h: number }> = {
  '1:1':  { w: 1080, h: 1080 },
  '4:5':  { w: 1080, h: 1350 },
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1080, h: 608 }
};

// Ritaglia al centro e ridimensiona; entro il 2% di tolleranza il buffer torna intatto.
async function correctAspectRatio(buf: Buffer<ArrayBufferLike>, target: AspectRatio): Promise<Buffer<ArrayBufferLike>> {
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) return buf;
  const currentRatio = meta.width / meta.height;
  const targetDims = ASPECT_TARGETS[target];
  const targetRatio = targetDims.w / targetDims.h;
  if (Math.abs(currentRatio - targetRatio) / targetRatio < 0.02) return buf;
  const cropW = currentRatio > targetRatio
    ? Math.round(meta.height * targetRatio) // too wide → crop sides
    : meta.width;
  const cropH = currentRatio < targetRatio
    ? Math.round(meta.width / targetRatio)  // too tall → crop top/bottom
    : meta.height;
  const left = Math.round((meta.width - cropW) / 2);
  const top = Math.round((meta.height - cropH) / 2);
  return sharp(buf)
    .extract({ left, top, width: cropW, height: cropH })
    .resize(targetDims.w, targetDims.h, { fit: 'cover' })
    .png()
    .toBuffer();
}

// Con `aspectRatio` l'immagine viene ritagliata al centro prima dell'upload.
export async function uploadPostImage(supabase: SupabaseClient, userId: string, dataUrl: string, aspectRatio?: AspectRatio): Promise<string | undefined> {
  const [header, base64] = dataUrl.split(',');
  if (!base64) return undefined;
  const mimeMatch = header?.match(/data:([^;]+)/);
  const mime = mimeMatch?.[1] ?? 'image/png';
  let bytes: Buffer<ArrayBufferLike> = Buffer.from(base64, 'base64');
  if (aspectRatio) bytes = await correctAspectRatio(bytes, aspectRatio);
  // Output diretto del modello, quindi il termine forte. publishImageBufferAsPostMedia NON lo fa
  // apposta: quel percorso porta anche le foto vere dell'utente, e marcare una fotografia come
  // sintetica è un errore peggiore che non marcarla.
  bytes = await markImage(bytes, mime, DIGITAL_SOURCE_TYPE.synthetic);
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
  const path = `${userId}/onboarding/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('media').upload(path, bytes, {
    contentType: mime,
    upsert: false
  });
  if (error) {
    console.error('[uploadPostImage] storage upload failed:', error.message);
    return undefined;
  }
  return supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
}

/** Publish raw image bytes as a public post media URL (platform aspect crop). Used for Media library reuse. */
export async function publishImageBufferAsPostMedia(
  supabase: SupabaseClient,
  userId: string,
  buf: Buffer,
  mime: string,
  platform?: string | null
): Promise<string | undefined> {
  const aspectRatio = aspectRatioFor(platform);
  let bytes: Buffer<ArrayBufferLike> = Buffer.from(buf);
  bytes = await correctAspectRatio(bytes, aspectRatio);
  const safeMime = mime.startsWith('image/') ? mime : 'image/jpeg';
  const ext = safeMime.includes('png') ? 'png' : safeMime.includes('webp') ? 'webp' : 'jpg';
  const path = `${userId}/library/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('media').upload(path, bytes, {
    contentType: safeMime === 'image/jpg' ? 'image/jpeg' : safeMime,
    upsert: false
  });
  if (error) return undefined;
  return supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
}
