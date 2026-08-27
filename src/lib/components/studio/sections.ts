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

/** Form actions used by each Studio section page. */
export const STUDIO_SECTION_ACTIONS: Record<StudioSection, string[]> = {
  brand: [
    'updateBrandKit',
    'updateColors',
    'updateLogo',
    'updateVisualStyle',
    'updateGraphicStyle',
    'proposeGraphicStyle',
    'regenerateVisualStyle',
    'uploadImage',
    'addMoodFromHistory',
    'addMoodFromUrls',
    'deleteSource'
  ],
  platforms: ['updateTargetPlatforms'],
  hashtags: ['updatePlatformHashtags'],
  'voice-examples': ['updateVoiceExamples'],
  products: ['updateProduct', 'deleteProduct'],
  competitors: ['addCompetitor', 'updateCompetitor', 'deleteCompetitor', 'researchCompetitors'],
  people: ['addPersonReal', 'generatePersonAI', 'deletePerson']
};
