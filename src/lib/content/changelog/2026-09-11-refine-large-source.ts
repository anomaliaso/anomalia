import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-11',
  title: 'Refining a large photo now works',
  items: [
    'Refining a photo heavier than a model can take now works: the picture is scaled down on the way in, and the original stays in your library untouched.',
    'When a source really is too heavy, the answer says so and names its size — instead of "not found", which had agents redrawing the picture from scratch.'
  ]
} satisfies ChangelogEntry;
