import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Media video reviews removed',
  items: [
    'Automatic video scoring is gone, everywhere: it started failing on every clip after the model behind it stopped accepting video files.',
    'The Media reviewer settings page, score badges and review panels no longer appear.',
    'Motion videos are delivered on render; the quality gate now trusts the render pipeline and the voice check instead of a separate AI judge.'
  ]
} satisfies ChangelogEntry;
