import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'A short post id is enough, and the tools say so',
  items: [
    'The reschedule and render tools now state that a post id can be a short prefix — the same shortcut get_post already documented.',
    'Those tools reject a field they do not know instead of dropping it in silence.'
  ]
} satisfies ChangelogEntry;
