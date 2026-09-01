import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-01',
  title: 'The same person speaks in every UGC clip',
  items: [
    'When you ask for several UGC videos without picking a model, the whole batch now keeps one face, one look and one wardrobe instead of casting a new person for each clip.',
    'A long batch that finishes in a second pass comes back with the same person it started with.'
  ]
} satisfies ChangelogEntry;
