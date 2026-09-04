import { z } from 'zod';
import type { BrandEndpoint } from './index';

/**
 * I mestieri che un brand puo' affidare a modelli diversi. La tabella che li governa vive
 * nell'app (`$lib/media-model-slots`) insieme al dialetto di ogni provider; qui stanno i soli
 * due fatti che l'API deve dire a un agente: come si chiama lo slot, e che lavoro fa.
 *
 * Un test dell'app tiene i due elenchi allineati: un mestiere aggiunto di la' e non di qua
 * sarebbe un tool che non lo sa offrire, in silenzio.
 */
export const MEDIA_MODEL_SLOT_IDS = [
  'imageModel',
  'imageRefineModel',
  'videoModel',
  'videoImageModel',
  'videoRefineModel',
  'videoMotionModel'
] as const;

export type MediaModelSlotId = (typeof MEDIA_MODEL_SLOT_IDS)[number];

export const MEDIA_MODEL_JOBS: Record<MediaModelSlotId, string> = {
  imageModel: 'Draws a post image from a prompt.',
  imageRefineModel: 'Redraws an image that already exists, keeping what it shows.',
  videoModel: 'Makes a clip from words alone, with no starting frame.',
  videoImageModel: 'Animates one still that already exists, usually the rendered cover.',
  videoRefineModel: 'Rewrites a clip that already exists, keeping its movement.',
  videoMotionModel: 'Takes the movement from a guide video and applies it to a subject in a still.'
};

const slot = z.enum(MEDIA_MODEL_SLOT_IDS).describe('Which job the model is chosen for');

const Choice = z.object({ id: z.string(), label: z.string() });

export const GET_MEDIA_MODELS = {
  tool: 'get_media_models',
  title: 'Media models',
  description:
    'Which model draws and which model films for this brand, one job at a time, with the ' +
    'models each job actually accepts. Read it before set_media_model: a model that cannot do ' +
    'a job is refused, and this is where the accepted ids come from. A null model means the ' +
    'brand made no choice and the platform default renders.',
  method: 'GET',
  pathUnderBrand: '/settings/models',
  input: z.object({}).strict(),
  output: z.object({
    brand: z.string(),
    slots: z.array(
      z.object({
        slot: z.enum(MEDIA_MODEL_SLOT_IDS),
        job: z.string(),
        model: z.string().nullable(),
        choices: z.array(Choice)
      })
    )
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const SET_MEDIA_MODEL = {
  tool: 'set_media_model',
  title: 'Choose a media model',
  description:
    'Pin the model that serves one job for this brand — image generation, image refinement, ' +
    'video from text, animating a still, video refinement, motion transfer. Only the models ' +
    'that job accepts are taken: anything else comes back as model_not_for_slot with the list ' +
    'that would have been accepted. Send model: null to drop the choice and go back to the ' +
    'platform default. Calls no model and spends no credits; it takes effect on the next render.',
  method: 'PUT',
  pathUnderBrand: '/settings/models',
  input: z
    .object({
      slot,
      model: z
        .string()
        .min(1)
        .nullable()
        .describe('A model id from get_media_models for this slot, or null to clear the choice')
    })
    .strict(),
  output: z.object({
    ok: z.literal(true),
    slot: z.enum(MEDIA_MODEL_SLOT_IDS),
    model: z.string().nullable()
  }),
  failures: [
    { error: 'model_not_for_slot', status: 400 },
    { error: 'update_failed', status: 500 }
  ],
  destructive: false
} satisfies BrandEndpoint;
