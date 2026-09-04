import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Image generation can now run on a faster route',
  items: [
    'Images can now be generated through OpenRouter, which returns a finished render in about 3 seconds instead of 25 — the same Google model, seven times faster.',
    'Renders on this route are billed at what the provider actually charged for that image, not at an estimate.',
    'The existing route stays available and stays the default, so nothing changes until the faster one is switched on.'
  ]
} satisfies ChangelogEntry;
