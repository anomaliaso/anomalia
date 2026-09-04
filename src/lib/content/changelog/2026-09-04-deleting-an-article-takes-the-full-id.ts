import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Deleting an article asks for the whole id',
  items: [
    'Removing a blog article from a connected AI client now takes the full article id, not a shortened one — the same rule products, people, notes and competitors already follow. A short id that matched two articles could delete the wrong one, and nothing brings it back.',
    'Writing, optimizing, publishing and unpublishing an article are unchanged, short ids included.'
  ]
} satisfies ChangelogEntry;
