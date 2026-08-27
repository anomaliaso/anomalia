import { z } from 'zod';

export const AspectSchema = z.enum(['1:1', '4:5', '9:16', '16:9']);
export type Aspect = z.infer<typeof AspectSchema>;

/** Logical canvas width. Height follows aspect. Export at scale:2 → 2160×2700 for 4:5. */
export const CANVAS_BASE = 1080;

export function canvasSize(aspect: Aspect): { width: number; height: number } {
  const w = CANVAS_BASE;
  switch (aspect) {
    case '1:1':
      return { width: w, height: w };
    case '4:5':
      return { width: w, height: Math.round((w * 5) / 4) };
    case '9:16':
      return { width: w, height: Math.round((w * 16) / 9) };
    case '16:9':
      return { width: w, height: Math.round((w * 9) / 16) };
  }
}

const Base = z.object({
  id: z.string(),
  name: z.string().optional(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  rotate: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  locked: z.boolean().default(false)
});

export const LayerSchema = z.discriminatedUnion('type', [
  Base.extend({
    type: z.literal('image'),
    src: z.string(),
    fit: z.enum(['cover', 'contain']).default('cover'),
    prompt: z.string().optional(),
    filters: z
      .object({
        brightness: z.number(),
        contrast: z.number(),
        saturate: z.number(),
        blur: z.number()
      })
      .partial()
      .optional()
  }),
  Base.extend({
    type: z.literal('text'),
    text: z.string(),
    font: z.string(),
    weight: z.number().default(600),
    size: z.number(),
    color: z.string(),
    align: z.enum(['left', 'center', 'right']).default('left'),
    lineHeight: z.number().default(1.15),
    letterSpacing: z.number().default(0),
    maxLines: z.number().optional(),
    autoFit: z.boolean().default(true)
  }),
  Base.extend({
    type: z.literal('shape'),
    shape: z.enum(['rect', 'ellipse', 'line']),
    fill: z.string().optional(),
    stroke: z.string().optional(),
    strokeWidth: z.number().default(0),
    radius: z.number().default(0)
  }),
  Base.extend({
    type: z.literal('svg'),
    svg: z.string()
  }),
  Base.extend({
    type: z.literal('gradient'),
    from: z.string(),
    to: z.string(),
    angle: z.number().default(180)
  })
]);

export const SlideSchema = z.object({
  layers: z.array(LayerSchema),
  background: z.string().default('#ffffff')
});

export const DesignSchema = z.object({
  v: z.literal(1),
  aspect: AspectSchema,
  template: z.string().optional(),
  slides: z.array(SlideSchema).min(1)
});

export type Layer = z.infer<typeof LayerSchema>;
export type TextLayer = Extract<Layer, { type: 'text' }>;
export type Slide = z.infer<typeof SlideSchema>;
export type Design = z.infer<typeof DesignSchema>;

export function parseDesign(input: unknown): Design {
  return DesignSchema.parse(input);
}

/**
 * Shrink `initialSize` until `measure(size)` fits the box.
 * Pure: callers supply measure (DOM/canvas in Remotion, mock in tests).
 */
export function computeAutoFitSize(opts: {
  initialSize: number;
  minSize?: number;
  boxW: number;
  boxH: number;
  measure: (size: number) => { width: number; height: number };
}): number {
  const min = opts.minSize ?? 8;
  let size = Math.max(min, Math.round(opts.initialSize));
  while (size > min) {
    const m = opts.measure(size);
    if (m.width <= opts.boxW + 0.5 && m.height <= opts.boxH + 0.5) return size;
    size -= 1;
  }
  return min;
}
