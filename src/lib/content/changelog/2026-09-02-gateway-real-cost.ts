import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-02',
  title: 'Credits now follow the real bill',
  items: [
    'Chat and agent turns are charged at what the model provider actually billed for them, instead of a price list that had to be updated by hand for every model.',
    'Turns on models that were missing from that list used to cost no credits at all. They now count, so what you see spent is what was really spent.'
  ]
} satisfies ChangelogEntry;
