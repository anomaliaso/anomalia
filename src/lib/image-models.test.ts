import { describe, it, expect, vi } from 'vitest';
import {
  IMAGE_MODEL_CHOICES,
  NANO_BANANA_PRO_MODEL,
  SEEDREAM_5_PRO_MODEL,
  GPT_IMAGE_2_MODEL,
  GPT_IMAGE_25_SUNBURST_MODEL,
  GPT_IMAGE_25_FLARE_MODEL,
  NANO_BANANA_2_MODEL,
  QWEN3_PRO_MODEL,
  openrouterImagesSize,
  imageModelSpec,
  imageRefineModelFor,
  isKnownImageModelId,
  imageModelFor,
  kieAspectRatio,
  googleImageModel
} from './image-models';

describe('image models', () => {
  it('ogni scelta offerta è riconosciuta', () => {
    for (const choice of IMAGE_MODEL_CHOICES) {
      expect(isKnownImageModelId(choice.id)).toBe(true);
    }
  });

  it('un id sconosciuto non passa', () => {
    expect(isKnownImageModelId('gpt-image-9')).toBe(false);
    expect(isKnownImageModelId('')).toBe(false);
    expect(isKnownImageModelId(undefined)).toBe(false);
  });

  it('la preferenza del brand vince quando è nota', () => {
    expect(imageModelFor({ imageModel: SEEDREAM_5_PRO_MODEL })).toBe(SEEDREAM_5_PRO_MODEL);
  });

  it('senza preferenza il renderer resta libero di scegliere', () => {
    expect(imageModelFor({})).toBeUndefined();
    expect(imageModelFor(null)).toBeUndefined();
    expect(imageModelFor({ imageModel: 'un-modello-che-non-esiste' })).toBeUndefined();
  });

  it('un id Gemini scritto a mano da un call site resta uno spec valido', () => {
    expect(imageModelSpec('gemini-3-pro-image-preview')?.id).toBe(NANO_BANANA_PRO_MODEL);
  });

  it('solo i nano-banana esistono anche su Google', () => {
    expect(imageModelSpec(NANO_BANANA_PRO_MODEL)?.google).toBe('gemini-3-pro-image-preview');
    expect(imageModelSpec(SEEDREAM_5_PRO_MODEL)?.google).toBeNull();
    expect(imageModelSpec(GPT_IMAGE_2_MODEL)?.google).toBeNull();
    expect(imageModelSpec(QWEN3_PRO_MODEL)?.google).toBeNull();
  });

  it('con riferimenti kie vuole un id diverso, dove la famiglia li separa', () => {
    const seedream = imageModelSpec(SEEDREAM_5_PRO_MODEL)!;
    expect(seedream.kie.text).toBe('seedream/5-pro-text-to-image');
    expect(seedream.kie.refs).toBe('seedream/5-pro-image-to-image');
    const nano = imageModelSpec(NANO_BANANA_PRO_MODEL)!;
    expect(nano.kie.text).toBe('nano-banana-pro');
    expect(nano.kie.refs).toBe('nano-banana-pro');
  });

  // 4:5 è il formato di un post Instagram. Seedream e Qwen non lo servono: ripiegare su 1:1
  // cambierebbe di nascosto l'inquadratura di ogni post verticale del brand.
  it('un rapporto che il modello non serve diventa il verticale più vicino, non un quadrato', () => {
    expect(kieAspectRatio(imageModelSpec(SEEDREAM_5_PRO_MODEL)!, '4:5')).toBe('3:4');
    expect(kieAspectRatio(imageModelSpec(QWEN3_PRO_MODEL)!, '4:5')).toBe('3:4');
    expect(kieAspectRatio(imageModelSpec(GPT_IMAGE_2_MODEL)!, '4:5')).toBe('4:5');
    expect(kieAspectRatio(imageModelSpec(NANO_BANANA_PRO_MODEL)!, '4:5')).toBe('4:5');
  });

  it('9:16 e 1:1 li serve chiunque', () => {
    for (const choice of IMAGE_MODEL_CHOICES) {
      const spec = imageModelSpec(choice.id)!;
      expect(kieAspectRatio(spec, '9:16')).toBe('9:16');
      expect(kieAspectRatio(spec, '1:1')).toBe('1:1');
    }
  });

  // Senza chiave kie il render va su Google, dove "seedream/5-pro-…" non è un modello: sarebbe un
  // 400 su OGNI immagine del brand, e proprio nel momento in cui kie non risponde.
  it('un modello che vive solo su kie non arriva mai a Google', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(googleImageModel(SEEDREAM_5_PRO_MODEL, 'gemini-3.1-flash-image')).toBe('gemini-3.1-flash-image');
    expect(googleImageModel(QWEN3_PRO_MODEL, 'gemini-3.1-flash-image')).toBe('gemini-3.1-flash-image');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('su Google i nano-banana passano con il loro id Gemini', () => {
    expect(googleImageModel(NANO_BANANA_PRO_MODEL, 'x')).toBe('gemini-3-pro-image-preview');
    expect(googleImageModel('gemini-3.1-flash-image', 'x')).toBe('gemini-3.1-flash-image');
    // Un id che il catalogo non conosce resta quello che il call site ha chiesto.
    expect(googleImageModel('gemini-4-whatever', 'x')).toBe('gemini-4-whatever');
  });

  it('il tetto dei riferimenti è quello del modello, non uno globale', () => {
    expect(imageModelSpec(QWEN3_PRO_MODEL)!.maxRefs).toBe(3);
    expect(imageModelSpec(GPT_IMAGE_2_MODEL)!.maxRefs).toBe(16);
    expect(imageModelSpec(NANO_BANANA_PRO_MODEL)!.maxRefs).toBe(8);
  });
});

describe('the refine model', () => {
  it('falls back to the generation model when none was chosen', () => {
    // Editing a photo has always used whatever model drew it. A brand that never opens the new
    // picker must keep exactly that, not lose its choice to an empty second slot.
    expect(imageRefineModelFor({ imageModel: SEEDREAM_5_PRO_MODEL })).toBe(SEEDREAM_5_PRO_MODEL);
  });

  it('lets the brand refine with a different model than it generates with', () => {
    expect(
      imageRefineModelFor({ imageModel: SEEDREAM_5_PRO_MODEL, imageRefineModel: GPT_IMAGE_2_MODEL })
    ).toBe(GPT_IMAGE_2_MODEL);
  });

  it('ignores a refine model the catalogue no longer serves', () => {
    expect(imageRefineModelFor({ imageRefineModel: 'seedream-4-legacy' })).toBeUndefined();
  });
});

/**
 * I modelli che vivono SOLO sull'API immagini di OpenRouter.
 *
 * Misurato il 2026-09-12 su `GET /api/v1/images/models` e con render veri: `openai/gpt-image-2.5-*`
 * non esiste su kie né su Google, e il suo endpoint non è `chat/completions` — è `POST /images`,
 * con `input_references` per le modifiche e `aspect_ratio` da un elenco chiuso che NON contiene
 * 4:5, cioè il formato di un post Instagram. Quel buco si copre con `size`, che l'endpoint onora
 * al pixel (1024x1280 chiesto, 1024x1280 tornato) pur non essendo documentato.
 */
describe('i modelli dell’API immagini di OpenRouter', () => {
  it('GPT Image 2.5 Sunburst e Flare sono nel catalogo del brand', () => {
    expect(isKnownImageModelId(GPT_IMAGE_25_SUNBURST_MODEL)).toBe(true);
    expect(isKnownImageModelId(GPT_IMAGE_25_FLARE_MODEL)).toBe(true);
    const ids = IMAGE_MODEL_CHOICES.map((c) => c.id);
    expect(ids).toContain(GPT_IMAGE_25_SUNBURST_MODEL);
    expect(ids).toContain(GPT_IMAGE_25_FLARE_MODEL);
  });

  it('portano l’id con cui OpenRouter li chiama, e gli altri no', () => {
    expect(imageModelSpec(GPT_IMAGE_25_SUNBURST_MODEL)?.openrouterImages).toBe(
      'openai/gpt-image-2.5-sunburst'
    );
    expect(imageModelSpec(NANO_BANANA_2_MODEL)?.openrouterImages).toBeNull();
  });

  it('si riconoscono anche dall’id di OpenRouter, non solo dal nostro', () => {
    expect(imageModelSpec('openai/gpt-image-2.5-flare')?.id).toBe(GPT_IMAGE_25_FLARE_MODEL);
  });

  it('non esistono su kie né su Google: chi ci finisce lo scopre, non lo indovina', () => {
    const spec = imageModelSpec(GPT_IMAGE_25_SUNBURST_MODEL)!;
    expect(spec.google).toBeNull();
    expect(spec.kie).toBeNull();
  });

  it('4:5 lo servono, perché è il formato di un post', () => {
    expect(imageModelSpec(GPT_IMAGE_25_SUNBURST_MODEL)!.aspectRatios).toContain('4:5');
  });
});

describe('openrouterImagesSize', () => {
  it('i rapporti che l’elenco chiuso di OpenRouter ha non passano da size', () => {
    expect(openrouterImagesSize('1:1')).toBeUndefined();
    expect(openrouterImagesSize('9:16')).toBeUndefined();
  });

  it('4:5 e 5:4 non sono in quell’elenco: si chiedono in pixel, o tornerebbe un 400', () => {
    expect(openrouterImagesSize('4:5')).toBe('1024x1280');
    expect(openrouterImagesSize('5:4')).toBe('1280x1024');
  });

  it('un rapporto che non si capisce non inventa una dimensione', () => {
    expect(openrouterImagesSize(undefined)).toBeUndefined();
    expect(openrouterImagesSize('banana')).toBeUndefined();
  });
});
