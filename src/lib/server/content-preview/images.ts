import { swallow } from '$lib/server/swallow';
import { genWithRetry } from './plan-pipeline';
import { type AnyRec, type BrandProfile, type ImagePart, MAX_COMPETITOR_MOOD_IMAGES, type PreviewPost, platformKey } from './seed-model';
import type { GoogleGenAI } from '@google/genai';
import { DIGITAL_SOURCE_TYPE, markImage } from '$lib/server/content-credentials';
import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { env } from '$env/dynamic/private';
import { fetchImagePart } from '$lib/server/brand-context';
import { getBrandContext } from '$lib/server/ai-log';
import { googleGenaiClient, judgeThinkingLevel, NANO_BANANA_2_LITE } from '$lib/server/gemini';
import { GEMINI_NANO_BANANA_2, googleImageModel } from '$lib/image-models';
import { structured } from '$lib/server/research';
import { signKnowledgePaths } from '$lib/server/media-archive';
import { generateImageOnKie } from '$lib/server/kie-jobs';
import { route } from '$lib/server/model-routing';
import { signPaths } from '$lib/server/people';
import { svgToPng } from '$lib/server/brand-analysis';
import { normalizeContentFormat } from '$lib/content-formats';
import { firstLogoUrl } from '$lib/server/blog-site';
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
  // Il default di render è Nano Banana 2 Lite, anche con riferimenti da riprodurre: decisione di
  // prodotto presa nel 2026-08, Lite al posto di Pro su OGNI superficie. Un opts.model esplicito
  // vince comunque — è la strada per riportare un call site su Pro senza deploy.
  const needsFidelity = !!(
    opts.personImages?.length ||
    opts.referenceImages?.length ||
    opts.userRefImages?.length ||
    opts.baseImage
  );
  const imageModel =
    opts.model ??
    (needsFidelity ? NANO_BANANA_2_LITE : env.IMAGE_MODEL_NO_REF || BLOG_IMAGE_MODEL);
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

/** Extract the first inline image from a generateContent response as a data URL. */
export function imageFromResponse(res: {
  candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
}): string | undefined {
  for (const part of res.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) return `data:${part.inlineData.mimeType ?? 'image/png'};base64,${part.inlineData.data}`;
  }
  return undefined;
}

export async function renderPostImage(
  ai: GoogleGenAI,
  imagePrompt: string,
  opts: RenderImageOpts = {}
): Promise<string | undefined> {
  // Le immagini sono ~66% della spesa AI, quindi la quota si applica QUI, al chokepoint: un loop
  // in un flusso qualunque si ferma alla quota invece di bruciare per giorni. L'import dinamico
  // evita il ciclo di moduli crediti↔scheduler↔qui. Senza brand context non c'è gate.
  const gateBrand = getBrandContext();
  if (gateBrand) {
    const { gateCredits } = await import('$lib/server/credits');
    await gateCredits(gateBrand);
  }
  const req = buildImageRequest(imagePrompt, opts);
  const imageModel = req.model;
  // Nano Banana gira su kie: stesso modello, −33%/−40% per immagine (misurato sui crediti
  // addebitati). È l'UNICO punto da cambiare perché ogni render del prodotto passa di qui.
  // `AI_ROUTE_IMAGE=nano-banana@google` riporta tutto su Google senza deploy.
  // Il Batch di blog-month.ts resta su Google apposta: kie non ha una batch API, e lì lo sconto
  // del 50% del batch vale più della differenza di listino.
  if (route('image').endpoint === 'kie') {
    // Due tentativi, non tre: su kie il fallimento arriva già diagnosticato in pochi secondi, e
    // non serve l'insistenza che serve con la risposta vuota di Gemini.
    for (let attempt = 1; attempt <= 2; attempt++) {
      // L'URL di kie vive 24 ore: non deve sopravvivere alla funzione, men che meno finire in una
      // riga del database.
      const viaKie = await generateImageOnKie(req, { context: `image:${imageModel}` });
      if (viaKie) return viaKie;
    }
    throw new Error(`No image returned from kie (${imageModel}) after 2 attempts`);
  }
  // Pixel Google: il client si costruisce QUI, non nei chiamanti (testo/QC non devono toccare Google).
  // Un modello che vive solo su kie non è un modello per Google: `googleImageModel` lo riporta a
  // quello di casa e lo dice, invece di far fallire ogni immagine con un 400.
  req.model = googleImageModel(req.model, NANO_BANANA_2_LITE);
  const googleAi = googleGenaiClient();
  void ai;
  // genWithRetry ritenta gli ERRORI, ma il modello risponde spesso 200 SENZA parte immagine — un
  // fallimento transitorio che lascia il post senza immagine. Qui si ritenta il render intero, e si
  // esce subito solo su un blocco di sicurezza, che non si risolve riprovando.
  const MAX_IMAGE_ATTEMPTS = 3;
  let lastInfo = '';
  for (let attempt = 1; attempt <= MAX_IMAGE_ATTEMPTS; attempt++) {
    const res = await genWithRetry(() => googleAi.models.generateContent(req), 'renderPostImage', { model: req.model });
    const found = imageFromResponse(res);
    if (found) return found;
    const out = res.candidates?.[0]?.content?.parts ?? [];
    // Nessuna immagine: si dice PERCHÉ (blocco di sicurezza, candidato vuoto, risposta testuale).
    const finishReason = res.candidates?.[0]?.finishReason;
    const blockReason = res.promptFeedback?.blockReason;
    const textParts = out.filter((p) => p.text).map((p) => p.text).join(' ').slice(0, 200);
    lastInfo = `finishReason=${finishReason ?? '?'}, blockReason=${blockReason ?? 'none'}${textParts ? `, text="${textParts}"` : ''}`;
    if (blockReason) break; // hard refusal — retrying won't help
    if (attempt < MAX_IMAGE_ATTEMPTS) console.warn(`[renderPostImage] no image (attempt ${attempt}/${MAX_IMAGE_ATTEMPTS}: ${lastInfo}) — retrying`);
  }
  throw new Error(`No image returned after ${MAX_IMAGE_ATTEMPTS} attempts (${lastInfo})`);
}

// Quality-control verdict for a generated image.
type ImageCritique = { pass: boolean; score: number; issues: string[]; fixHint: string; brandStyleMatch?: boolean };

const CRITIQUE_SCHEMA = {
  type: 'object' as const,
  properties: {
    pass: { type: 'boolean' as const, description: 'true only if the image is publish-ready: attractive, faithful to the real product (and person, if any), AND free of the generic AI/stock look.' },
    score: { type: 'integer' as const, description: 'Overall quality 1-10. 6 is the publish bar: below it the image is retried.' },
    issues: { type: 'array' as const, items: { type: 'string' as const }, description: 'Concrete problems: wrong product colour/shape, single item shown when it should be a set, unnatural composition (e.g. product reflected oddly, person/animal pasted in unrealistically), wrong scale/crop, artifacts, generic AI/stock look.' },
    fixHint: { type: 'string' as const, description: 'One concrete instruction to append to the image prompt on the retry to fix the biggest issue. Empty string if pass.' },
    brandStyleMatch: { type: 'boolean' as const, description: 'true if the image faithfully matches the brand visual brief (palette, lighting, composition, mood)' }
  },
  required: ['pass', 'score', 'issues', 'fixHint']
};

// Sotto questo punteggio si ritenta anche se il critico ha promosso: "tecnicamente ok ma
// mediocre" è esattamente l'output generico da uccidere.
const MIN_QC_SCORE = 6;

// Assicurazione a basso costo contro i fallimenti ricorrenti: prodotto sbagliato o slavato, un
// pezzo solo al posto di un set, una persona incollata in un punto impossibile.
async function critiqueImage(
  ai: GoogleGenAI,
  dataUrl: string,
  opts: { imagePrompt: string; productName?: string; productKind?: string; personName?: string; personAttributes?: string; referenceImages?: ImagePart[]; personImages?: ImagePart[]; visualStyle?: string }
): Promise<ImageCritique | null> {
  try {
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    const generated: ImagePart = { inlineData: { mimeType: m[1], data: m[2] } };

    // I prodotti grandi vanno mostrati interi, mai come macro di un angolo.
    const LARGE_KINDS = /monitor|desk|chair|keyboard|controller|light|stand/i;
    const isLarge = LARGE_KINDS.test(opts.productKind ?? '') || LARGE_KINDS.test(opts.productName ?? '');

    const checklist = [
      `1. PRODUCT FIDELITY: does the generated product match the REAL product reference (shape, TRUE colours, materials, finish, branding)? It must NOT be desaturated to greyscale, recoloured, redesigned, or swapped for a similar object.`,
      opts.productName ? `   The product is: "${opts.productName}"${opts.productKind ? ` (category: ${opts.productKind})` : ''}. If the reference shows a SET or multiple units, the image must show the set, not one isolated piece.` : '',
      isLarge ? `   SCALE: this is a LARGE product — it MUST be shown WHOLE and recognisable in a believable environment. FAIL the image if it only shows a tiny macro fragment (one corner/edge) so the product isn't actually identifiable.` : '',
      opts.personName ? `2. PERSON FIDELITY: "${opts.personName}" must look like the attached person REFERENCE photo(s) — same face, gender presentation, approximate age, hair. FAIL if the generated person clearly contradicts the references (e.g. wrong gender presentation vs the photos). Place them NATURALLY in the scene (not pasted into a reflection, not floating, not duplicated).` : '',
      // Gli attributi testuali valgono SOLO senza foto: mai far scavalcare alle parole ciò che le
      // foto mostrano.
      opts.personName && opts.personAttributes && !opts.personImages?.length
        ? `   IDENTITY (no photo refs): the person must clearly present as ${opts.personAttributes}. FAIL if gender presentation or approximate age contradicts this.`
        : '',
      `3. COMPOSITION: is it a believable, attractive product photo? Flag unnatural framing — e.g. the product reflected strangely, a person/animal appearing from nowhere, wrong scale (a macro crop of a large item), a repetitive "object on dark textured stone" stock backdrop, or obvious AI artifacts.`,
      `4. APPEAL: would this stop the scroll and look premium/on-brand?`,
      `5. GENERIC AI/STOCK LOOK: does it read as a generic AI render or interchangeable stock photo — over-saturated HDR glow, waxy skin, 3D-render sheen, sterile posing, garbled text, an image that could belong to any brand's feed? FAIL it if so: "technically correct but generic" is not publish-ready.`,
      // Parole storpiate o inventate: è il fallimento classico del renderer, e un refuso in
      // immagine è il difetto che l'owner nota per primo.
      `6. ON-IMAGE TEXT: READ every piece of text in the image, letter by letter. FAIL if any word is garbled, misspelled, duplicated or invented. If the brief quotes an exact string (text in double quotes), that string must appear letter-perfect — and no other text may appear. If the brief asks for no text, any text is a FAIL.`,
      opts.visualStyle ? `7. BRAND VISUAL STYLE: does the image match the brand's visual brief?\n   Brief:\n   ${opts.visualStyle}\n   Check: palette, lighting, composition, mood, graphic language. Flag any deviation that makes this image feel off-brand.` : ''
    ].filter(Boolean).join('\n');

    const promptText = `You are a strict art director doing QC on an AI-generated social post image. The FIRST attached image is the GENERATED image under review.${opts.referenceImages?.length ? ' The next image(s) are the REAL product reference.' : ''}${opts.personImages?.length ? ' The final image(s) are the reference for the person who should appear.' : ''}

The image was generated from this brief:
"${opts.imagePrompt}"

Judge it on:
${checklist}

Be honest and strict — a misleading product shot is worse than no image. Return JSON.`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const critiqueImages = [generated, ...(opts.referenceImages ?? []), ...(opts.personImages ?? [])];
    const parsed: AnyRec = await structured(ai, promptText, CRITIQUE_SCHEMA, undefined, {
      label: 'critiqueImage',
      images: critiqueImages,
      // Il QC gira sul tier vision di MiMo e non su Gemini: è un punteggio contro una rubrica già
      // scritta nel prompt, e MiMo legge immagini a una frazione del prezzo. Gemini resta il
      // fallback automatico, quindi il QC degrada a più caro, mai ad assente.
      provider: 'xiaomi',
      // Per quel fallback: lasciata libera era la chiamata peggiore del sistema (14x di thinking
      // sull'output). La rubrica è nel prompt, c'è poco da ragionare.
      thinkingLevel: judgeThinkingLevel()
    });
    const score = Number(parsed.score) || 0;
    const brandMatch = parsed.brandStyleMatch as boolean | undefined;
    return {
      // Il pavimento fa ritentare anche "promosso ma mediocre", e uno scarto esplicito dallo stile
      // del brand degrada il pass a false.
      pass: parsed.pass === true && score >= MIN_QC_SCORE && brandMatch !== false,
      score,
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      fixHint: String(parsed.fixHint ?? ''),
      brandStyleMatch: brandMatch
    };
  } catch (e) {
    // Best-effort: un critico che fallisce non blocca la pubblicazione.
    console.error(`[critiqueImage] failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// Candidati paralleli sui post ad alto rischio (persona o prodotto reale in frame). La SELEZIONE
// batte la correzione: un giudice che confronta è più affidabile di uno che valuta in isolamento.
const HIGH_STAKES_CANDIDATES = 2;

/**
 * Il tetto del giro critica → rigenerazione: due rigenerazioni oltre il primo render.
 *
 * Non scende oggi, e i numeri dicono perché non basta l'intuito: su 164 post con un voto, 45 hanno
 * riprovato e 36 sono arrivati a "passa" — il ritentativo serve nell'~80% dei casi in cui scatta.
 * Ma il giudice timbra 7 su 124 post su 164, e 31 dei 36 recuperi atterrano proprio su 7: un
 * anello guidato da un segnale che quasi non varia non converge, si ferma dove finisce il budget.
 * `attempts` e `capped` in `posts.qc` esistono per misurarlo prima di tagliare.
 */
export const MAX_QC_RETRIES = 2;

// Ripesca il blocco "WHAT WORKS VISUALLY" da ai_context per il renderer. '' quando assente.
export function extractVisualPlaybook(aiContext: unknown): string {
  const m = String(aiContext ?? '').match(/WHAT WORKS VISUALLY[^\n]*\n[\s\S]*?(?=\n\n|$)/);
  return m ? m[0].trim() : '';
}

export type QcVerdict = {
  score: number;
  pass: boolean;
  issues: string[];
  retried: boolean;
  /** Quanti render sono stati prodotti in totale (candidati paralleli + ritentativi). */
  attempts: number;
  /** true = il tetto è scattato e si è spedita l'immagine migliore comunque, non "era buona". */
  capped?: boolean;
  candidates?: number;
};
type CritiqueOpts = Omit<Parameters<typeof critiqueImage>[2], 'imagePrompt'>;

// Render → QC → scelta. Alto rischio: N candidati in parallelo, si tiene il migliore (prima il
// pass, poi il punteggio); gli altri un render solo. Se il migliore non passa, si ritenta con hint
// correttivi CUMULATIVI, tenendo sempre l'immagine col punteggio più alto.
export async function renderWithQC(
  ai: GoogleGenAI,
  imagePrompt: string,
  renderOpts: Parameters<typeof renderPostImage>[2],
  critiqueOpts: CritiqueOpts,
  highStakes: boolean
): Promise<{ dataUrl: string | undefined; qc?: QcVerdict }> {
  // Alto rischio → N candidati in parallelo e il critico sceglie; altrimenti un render solo.
  const wanted = highStakes ? HIGH_STAKES_CANDIDATES : 1;
  const opts = { ...renderOpts, craftFloor: await designWallDigestSection() };
  const settled = await Promise.allSettled(
    Array.from({ length: wanted }, () => renderPostImage(ai, imagePrompt, opts))
  );
  const candidates = settled
    .filter((r): r is PromiseFulfilledResult<string | undefined> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((v): v is string => !!v);
  if (!candidates.length) {
    const firstErr = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (firstErr) throw firstErr.reason;
    return { dataUrl: undefined };
  }
  const nCandidates = candidates.length;

  // Un critique null (QC non disponibile) sta sotto qualunque verdetto.
  const critiques = await Promise.all(candidates.map((c) => critiqueImage(ai, c, { ...critiqueOpts, imagePrompt })));
  let bestIdx = 0;
  for (let i = 1; i < candidates.length; i++) {
    const a = critiques[bestIdx];
    const b = critiques[i];
    if (!b) continue;
    if (!a || (b.pass && !a.pass) || (b.pass === a.pass && b.score > a.score)) bestIdx = i;
  }
  const chosen = critiques[bestIdx];
  // QC non disponibile sul candidato scelto → si spedisce (gate best-effort).
  if (!chosen) return { dataUrl: candidates[bestIdx], qc: undefined };

  // Il migliore non passa → hint correttivi CUMULATIVI, tenendo sempre l'immagine migliore.
  let best: { dataUrl: string; critique: ImageCritique } = { dataUrl: candidates[bestIdx], critique: chosen };
  let critique: ImageCritique | null = chosen;
  const hints: string[] = [];
  let retried = false;
  let attempts = nCandidates;
  let attempt = 0;
  for (; attempt < MAX_QC_RETRIES && !best.critique.pass && critique?.fixHint; attempt++) {
    hints.push(critique.fixHint);
    const retryPrompt = `${imagePrompt}\n\nCORRECTIONS (previous attempt(s) failed QC — fix ALL of these):${hints.map((h) => `\n- ${h}`).join('')}`;
    console.warn(`[renderWithQC] QC failed (${best.critique.score}/10, ${nCandidates} candidate(s))${critiqueOpts.productName ? ` for "${critiqueOpts.productName}"` : ''}: ${best.critique.issues.join('; ')} → retry ${attempt + 1}/${MAX_QC_RETRIES}`);
    // Un ritentativo che non torna con un'immagine chiude il ciclo: resta il migliore finora.
    const retry = await renderPostImage(ai, retryPrompt, opts).catch((error) => { swallow('render qc retry', error); return undefined; });
    if (!retry) break;
    attempts += 1;
    retried = true;
    const recheck = await critiqueImage(ai, retry, { ...critiqueOpts, imagePrompt: retryPrompt });
    if (!recheck) {
      // Ritentativo non giudicabile: lo si preferisce (ha affrontato i problemi noti) e si smette.
      best = { dataUrl: retry, critique: { ...best.critique, pass: true } };
      break;
    }
    if (recheck.pass || recheck.score >= best.critique.score) best = { dataUrl: retry, critique: recheck };
    critique = recheck;
  }
  // Tetto scattato: si spedisce il meglio che c'è e lo si SCRIVE — un troncamento muto si legge
  // come "è il meglio che sapeva fare", che è un'altra cosa.
  const capped = attempt >= MAX_QC_RETRIES && !best.critique.pass;
  if (capped) {
    console.warn(
      `[renderWithQC] QC cap reached after ${attempts} render(s) — shipping ${best.critique.score}/10 anyway: ${best.critique.issues.join('; ')}`
    );
  }
  return {
    dataUrl: best.dataUrl,
    qc: {
      score: best.critique.score,
      pass: best.critique.pass,
      issues: best.critique.issues,
      retried,
      attempts,
      ...(capped ? { capped: true } : {}),
      candidates: nCandidates
    }
  };
}

// Una slide di seguito (2..N), ancorata alla slide 1 finita come riferimento di stile, con un QC
// LEGGERO (solo fedeltà prodotto, un ritentativo, niente best-of-N). Tenere leggeri i seguiti è ciò
// che tiene un carosello a ~N render invece di N pipeline di QC complete. Una slide fallita si
// scarta, non blocca il post.
// La regola di serie che tiene N slide un oggetto solo, non N immagini: vive qui, in un posto solo,
// così la sonda creativa misura lo stesso prompt che la produzione manda.
export function carouselSeriesDirective(slideIndex: number, totalSlides: number): string {
  return `\n\nCAROUSEL SLIDE ${slideIndex + 1} of ${totalSlides} — this image is ONE SLIDE of a single carousel post. The FIRST attached style/mood reference is SLIDE 1 of the same carousel: match its medium, palette, lighting, styling and art direction EXACTLY so the whole set reads as one coherent series. Compose THIS slide's own subject as described above — never copy slide 1's composition or subject.`;
}

export async function renderCarouselSlide(
  ai: GoogleGenAI,
  supabase: SupabaseClient,
  userId: string,
  slidePrompt: string,
  slideIndex: number, // 0-based among ALL slides; first call is 1 (slide 2 of N)
  totalSlides: number,
  renderOpts: NonNullable<Parameters<typeof renderPostImage>[2]>,
  slideOneAnchor: ImagePart | undefined,
  critiqueOpts: CritiqueOpts
): Promise<string | undefined> {
  const seriesDirective = carouselSeriesDirective(slideIndex, totalSlides);
  // La slide 1 precede i mood del brand, così domina l'ancoraggio estetico.
  const opts = { ...renderOpts, craftFloor: await designWallDigestSection(), moodImages: [...(slideOneAnchor ? [slideOneAnchor] : []), ...(renderOpts.moodImages ?? [])] };
  try {
    let dataUrl = await renderPostImage(ai, slidePrompt + seriesDirective, opts);
    if (dataUrl && critiqueOpts.referenceImages?.length) {
      const verdict = await critiqueImage(ai, dataUrl, { ...critiqueOpts, imagePrompt: slidePrompt });
      if (verdict && !verdict.pass && verdict.fixHint) {
        const retry = await renderPostImage(ai, `${slidePrompt + seriesDirective}\n\nCORRECTION (previous attempt failed QC): ${verdict.fixHint}`, opts).catch((error) => { swallow('render slide qc retry', error); return undefined; });
        if (retry) dataUrl = retry;
      }
    }
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
