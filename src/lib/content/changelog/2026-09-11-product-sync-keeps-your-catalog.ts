import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-11',
  title: 'Syncing products can no longer empty your catalog',
  items: [
    'A product sync that fails now leaves the catalog you already had exactly where it was, instead of clearing it first and reporting success.',
    'One malformed product on your store no longer stops the other thirty-nine from importing — the ones that could not be saved are listed by name, with the reason.'
  ]
} satisfies ChangelogEntry;
