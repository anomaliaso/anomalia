import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-12',
  title: 'The brand home loads again',
  items: [
    'The home of a brand no longer sits on a loading placeholder forever: it was crashing while drawing itself, which from the outside looked exactly like data that never arrived.',
    'The «connect your agent» box opens on all three ways in, numbered and readable, instead of being squeezed to a third of the first command.',
    'The sidebar drops the duplicate «Overview» row — it went where «Home» goes — and the notification count is a circle again instead of an oversized number.',
    'The growth checklist shows its real counts instead of a placeholder in the label.'
  ]
} satisfies ChangelogEntry;
