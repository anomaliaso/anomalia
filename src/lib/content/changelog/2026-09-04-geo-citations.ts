import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'AI visibility checks read the live web again',
  items: [
    'The AI visibility audit asks whether your brand gets cited in AI answers. It had stopped actually searching the web, so it was answering from the model\'s own memory and returning no sources.',
    'Those checks now search the live web and come back with their citations, as they were meant to.',
    'Results from before this fix are not comparable with results after it — an audit run now may look different for that reason alone.'
  ]
} satisfies ChangelogEntry;
