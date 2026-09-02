/** Shared image-model ids safe for client + server (no $env), like video-models.ts. */

export const NANO_BANANA_PRO_MODEL = 'gemini-3-pro-image-preview';
export const NANO_BANANA_2_MODEL = 'gemini-3.1-flash-image';
export const NANO_BANANA_2_LITE_MODEL = 'gemini-3.1-flash-lite-image';

/**
 * Models a brand can pin for its renders. Ids are the Gemini ones because that is what
 * `RenderImageOpts.model` speaks; `kieImageModel()` translates them for kie.
 */
export const IMAGE_MODEL_CHOICES = [
  { id: NANO_BANANA_2_LITE_MODEL, label: 'Nano Banana 2 Lite' },
  { id: NANO_BANANA_2_MODEL, label: 'Nano Banana 2' },
  { id: NANO_BANANA_PRO_MODEL, label: 'Nano Banana Pro' }
] as const;

export type ImageModelChoiceId = (typeof IMAGE_MODEL_CHOICES)[number]['id'];

export function isKnownImageModelId(value: unknown): value is ImageModelChoiceId {
  const v = String(value ?? '').trim();
  return IMAGE_MODEL_CHOICES.some((c) => c.id === v);
}

/**
 * Undefined means "no preference": the renderer keeps deciding per call (fidelity refs, UGC
 * covers), which is the behaviour every brand had before the picker existed.
 */
export function imageModelFor(
  prefs: { imageModel?: unknown } | null | undefined
): ImageModelChoiceId | undefined {
  const v = String(prefs?.imageModel ?? '').trim();
  return isKnownImageModelId(v) ? v : undefined;
}
