import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Deleting now asks for the whole id',
  items: [
    'Removing a product, a person, a note or a competitor from a connected AI client now takes the full id, not a shortened one. A short id that matched two rows could delete the wrong one, and nothing brings it back.',
    'Everything else still takes the short form: reading a post, correcting a product, rescheduling — those are as forgiving as before.'
  ]
} satisfies ChangelogEntry;
