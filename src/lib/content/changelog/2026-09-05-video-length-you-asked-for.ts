import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Videos are the length you asked for',
  items: [
    'Short clips are no longer rounded up to ten seconds: ask for five and you get five, on any model that supports it — and clips are billed per second.',
    'If a model cannot do the length you asked for, you are told the nearest it accepts instead of being charged for a longer one.'
  ]
} satisfies ChangelogEntry;
