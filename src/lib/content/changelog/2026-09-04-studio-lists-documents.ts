import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'The studio lists your documents instead of reciting them',
  items: [
    'Reading your studio no longer returns the full text of every document — it lists them with their size and whether they are searchable, so your agent asks a question instead of swallowing the corpus.',
    '`anomalia studio` now marks the documents that are not searchable yet.'
  ]
} satisfies ChangelogEntry;
