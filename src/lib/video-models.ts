/** Shared video-model ids safe for client + server (no $env). */

export const GROK_IMAGINE_VIDEO_MODEL = 'grok-imagine-video-1-5-preview';

export const SEEDANCE_25_MODEL = 'bytedance/seedance-2-5';

/**
 * Kie Grok Imagine text ceiling. Prompts longer than this are rejected at createTask
 * ("text length cannot exceed the maximum limit") — declared here so the tools can tell the
 * AI how long a brief may be, and the renderer can clamp before the provider ever sees it.
 */
export const GROK_PROMPT_LIMIT = 4096;

/**
 * Soft cap for a model-authored video brief (create_post.video_prompt / make_video.prompt).
 * Longer briefs are silently trimmed by the renderer, so the tool rejects them up front and
 * the AI learns the limit instead of wasting a turn.
 */
export const VIDEO_BRIEF_MAX_CHARS = 1200;

/** Models a brand (or the media-generator UI) can pick. Ids are the I2V form. */
export const VIDEO_MODEL_CHOICES = [
  { id: GROK_IMAGINE_VIDEO_MODEL, label: 'Grok Imagine' },
  { id: SEEDANCE_25_MODEL, label: 'Seedance 2.5' },
  { id: 'bytedance/seedance-2', label: 'Seedance 2' },
  { id: 'bytedance/seedance-2-fast', label: 'Seedance 2 Fast' },
  { id: 'bytedance/seedance-2-mini', label: 'Seedance 2 Mini' }
] as const;

export type VideoModelChoiceId = (typeof VIDEO_MODEL_CHOICES)[number]['id'];

export function isKnownVideoModelId(value: unknown): value is VideoModelChoiceId {
  const v = String(value ?? '').trim();
  return VIDEO_MODEL_CHOICES.some((c) => c.id === v);
}

export function isSeedance25Model(model: string | null | undefined): boolean {
  return String(model ?? '').trim() === SEEDANCE_25_MODEL;
}

/** Seedance 2 / 2.5 / fast / mini — Kie multimodal refs (incl. reference_video_urls). */
export function isSeedanceFamily(model: string | null | undefined): boolean {
  return /^bytedance\/seedance-2/.test(String(model ?? '').trim());
}

/**
 * Kie Grok Imagine takes image_urls only — not reference videos.
 * Remaking a selected grid video requires Seedance (reference_video_urls).
 */
export function modelSupportsReferenceVideo(model: string | null | undefined): boolean {
  return isSeedanceFamily(model);
}
