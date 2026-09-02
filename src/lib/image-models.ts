/**
 * I modelli che possono disegnare per un brand, e COME ciascuno vuole essere chiamato.
 *
 * Su kie ogni modello è un dialetto diverso dello stesso `POST /jobs/createTask`: i riferimenti si
 * chiamano `image_input` su Nano Banana, `image_urls` su Seedream e Qwen, `input_urls` su GPT
 * Image; il rapporto d'aspetto è `aspect_ratio` per tutti tranne Qwen, che lo chiama `image_size`;
 * la dimensione è `resolution` per alcuni e `quality` (basic|high) per Seedream. Metà di queste
 * famiglie separa il modello testo-a-immagine da quello con riferimenti.
 *
 * Le differenze stanno TUTTE qui, in una riga per modello, perché una famiglia nuova sia una riga
 * e non una caccia a cinque `if` sparsi. Le assenze sono la parte che conta: `4:5` — il formato di
 * un post Instagram — non esiste su Seedream né su Qwen, e `google` è null per tutto ciò che kie
 * serve in esclusiva.
 *
 * Fonti: docs.kie.ai, una pagina per modello, lette il 2026-09-02.
 */

import { nearestAspectRatio } from '$lib/aspect-ratio';

export const NANO_BANANA_PRO_MODEL = 'nano-banana-pro';
export const NANO_BANANA_2_MODEL = 'nano-banana-2';
export const NANO_BANANA_2_LITE_MODEL = 'nano-banana-2-lite';
export const SEEDREAM_5_PRO_MODEL = 'seedream-5-pro';
export const GPT_IMAGE_2_MODEL = 'gpt-image-2';
export const QWEN3_PRO_MODEL = 'qwen3-pro';

/** Gli id Gemini che i call site scrivono a mano da prima che questo registro esistesse. */
export const GEMINI_NANO_BANANA_PRO = 'gemini-3-pro-image-preview';
export const GEMINI_NANO_BANANA_2 = 'gemini-3.1-flash-image';
export const GEMINI_NANO_BANANA_2_LITE = 'gemini-3.1-flash-lite-image';

export type ImageModelSpec = {
  id: string;
  label: string;
  /** L'id su Google, quando lo stesso modello esiste anche lì. null = solo kie. */
  google: string | null;
  /** Gli id kie: `text` senza riferimenti, `refs` con. Uguali dove la famiglia non li separa. */
  kie: { text: string; refs: string };
  /** Come si chiama il campo dei riferimenti nel payload kie. */
  refField: 'image_input' | 'image_urls' | 'input_urls';
  /** Quanti riferimenti il modello inoltra davvero. */
  maxRefs: number;
  /** Come si chiama il rapporto d'aspetto. Qwen è l'unico a chiamarlo `image_size`. */
  aspectField: 'aspect_ratio' | 'image_size';
  /** I rapporti che il modello accetta. Fuori da qui il provider risponde 500 dopo un giro di rete. */
  aspectRatios: string[];
  /** Come si chiede la dimensione: `resolution` (1K|2K|4K), `quality` (basic|high), o niente. */
  sizeField: 'resolution' | 'quality' | null;
  /**
   * Rapporti che il modello serve SOLO a 1K. Misurato su kie: `gpt-image-2` a 4:5 e 2K risponde
   * 500 "aspect_ratio is not within the range of allowed options", lo stesso 4:5 a 1K passa. Con
   * KIE_IMAGE_RESOLUTION=2K in produzione sarebbe ogni post Instagram del brand.
   */
  ratios1KOnly?: string[];
  /** `output_format` accettato. Lite non lo prende. */
  outputFormat: 'png' | 'jpeg' | null;
};

const NANO_ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

const SPECS: ImageModelSpec[] = [
  {
    id: NANO_BANANA_2_LITE_MODEL,
    label: 'Nano Banana 2 Lite',
    google: GEMINI_NANO_BANANA_2_LITE,
    kie: { text: 'nano-banana-2-lite', refs: 'nano-banana-2-lite' },
    refField: 'image_urls',
    maxRefs: 10,
    aspectField: 'aspect_ratio',
    aspectRatios: NANO_ASPECTS,
    sizeField: null,
    outputFormat: null
  },
  {
    id: NANO_BANANA_2_MODEL,
    label: 'Nano Banana 2',
    google: GEMINI_NANO_BANANA_2,
    kie: { text: 'nano-banana-2', refs: 'nano-banana-2' },
    refField: 'image_input',
    // kie ne documenta 14; 8 è il tetto che il prodotto ha sempre imposto e che i prompt assumono.
    maxRefs: 8,
    aspectField: 'aspect_ratio',
    aspectRatios: NANO_ASPECTS,
    sizeField: 'resolution',
    outputFormat: 'png'
  },
  {
    id: NANO_BANANA_PRO_MODEL,
    label: 'Nano Banana Pro',
    google: GEMINI_NANO_BANANA_PRO,
    kie: { text: 'nano-banana-pro', refs: 'nano-banana-pro' },
    refField: 'image_input',
    maxRefs: 8,
    aspectField: 'aspect_ratio',
    aspectRatios: NANO_ASPECTS,
    sizeField: 'resolution',
    outputFormat: 'png'
  },
  {
    id: SEEDREAM_5_PRO_MODEL,
    label: 'Seedream 5 Pro',
    google: null,
    kie: { text: 'seedream/5-pro-text-to-image', refs: 'seedream/5-pro-image-to-image' },
    refField: 'image_urls',
    maxRefs: 10,
    aspectField: 'aspect_ratio',
    aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
    sizeField: 'quality',
    outputFormat: 'png'
  },
  {
    id: GPT_IMAGE_2_MODEL,
    label: 'GPT Image 2',
    google: null,
    kie: { text: 'gpt-image-2-text-to-image', refs: 'gpt-image-2-image-to-image' },
    refField: 'input_urls',
    maxRefs: 16,
    aspectField: 'aspect_ratio',
    aspectRatios: ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9'],
    sizeField: 'resolution',
    ratios1KOnly: ['4:5', '5:4'],
    outputFormat: null
  },
  {
    id: QWEN3_PRO_MODEL,
    label: 'Qwen3 Pro',
    google: null,
    kie: { text: 'qwen3/pro-text-to-image', refs: 'qwen3/pro-image-to-image' },
    refField: 'image_urls',
    maxRefs: 3,
    aspectField: 'image_size',
    aspectRatios: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'],
    sizeField: 'resolution',
    outputFormat: 'png'
  }
];

export const IMAGE_MODEL_CHOICES = SPECS.map((s) => ({ id: s.id, label: s.label }));

export function isKnownImageModelId(value: unknown): value is string {
  return !!imageModelSpec(value);
}

/**
 * Lo spec di un modello, da qualunque nome quel modello abbia: il nostro id, l'id Gemini scritto in
 * un vecchio call site, o uno dei due id kie. Riconoscerli tutti è ciò che impedisce a un
 * `seedream/5-pro-image-to-image` di ripresentarsi come modello sconosciuto e finire nel dialetto
 * sbagliato.
 */
export function imageModelSpec(value: unknown): ImageModelSpec | undefined {
  const v = String(value ?? '').trim();
  if (!v) return undefined;
  return SPECS.find((s) => s.id === v || s.google === v || s.kie.text === v || s.kie.refs === v);
}

/**
 * Undefined vuol dire "nessuna preferenza": il renderer continua a decidere per ogni immagine,
 * che è il comportamento che ogni brand aveva prima che il selettore esistesse.
 */
export function imageModelFor(prefs: { imageModel?: unknown } | null | undefined): string | undefined {
  const v = String(prefs?.imageModel ?? '').trim();
  return isKnownImageModelId(v) ? v : undefined;
}

/**
 * Il modello con cui si MODIFICA una foto, che non e' per forza quello con cui la si disegna:
 * riprodurre fedelmente una immagine gia' esistente e inventarne una da zero sono due mestieri, e
 * la famiglia piu' brava al primo non e' sempre la piu' brava al secondo.
 *
 * Senza una scelta propria vale quella della generazione — che e' esattamente cio' che facevano
 * tutti i brand prima che questo secondo selettore esistesse.
 */
export function imageRefineModelFor(
  prefs: { imageModel?: unknown; imageRefineModel?: unknown } | null | undefined
): string | undefined {
  const v = String(prefs?.imageRefineModel ?? '').trim();
  if (v) return isKnownImageModelId(v) ? v : undefined;
  return imageModelFor(prefs);
}

/**
 * L'id da mandare a Google. Un modello che kie serve in esclusiva NON esiste lì: mandarcelo è un
 * 400 su ogni immagine del brand, e succederebbe proprio nel momento peggiore — quando la chiave
 * kie manca o il suo endpoint è giù. Meglio un render col modello di casa e un avviso rumoroso.
 */
export function googleImageModel(model: string | undefined, fallback: string): string {
  const spec = imageModelSpec(model);
  if (!spec) return model ?? fallback;
  if (spec.google) return spec.google;
  console.warn(
    `[AI] ${spec.id} esiste solo su kie e questo render sta andando su Google: uso ${fallback}. ` +
      `La preferenza del brand non è stata applicata.`
  );
  return fallback;
}

/**
 * Il rapporto d'aspetto più vicino fra quelli che il modello serve davvero.
 *
 * Un post Instagram è 4:5, e Seedream e Qwen non lo hanno: ripiegare sul default 1:1 cambierebbe
 * in silenzio l'inquadratura di ogni post verticale del brand, quindi si sceglie il rapporto con
 * la proporzione più vicina — 4:5 → 3:4, non un quadrato.
 */
export function kieAspectRatio(spec: ImageModelSpec, aspectRatio: string | undefined): string {
  return nearestAspectRatio(spec.aspectRatios, String(aspectRatio ?? '').trim() || '1:1', '1:1');
}

