export const STUDIO_SECTIONS = [
  'brand',
  'platforms',
  'hashtags',
  'voice-examples',
  'products',
  'competitors',
  'people'
] as const;

export type StudioSection = (typeof STUDIO_SECTIONS)[number];

