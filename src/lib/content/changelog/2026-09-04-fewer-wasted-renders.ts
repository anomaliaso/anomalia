import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Slow renders no longer cost twice',
  items: [
    'When an image takes longer than expected, Anomalia now waits on the render already in progress instead of starting a second one — the same picture was being paid for twice.',
    'A render that runs over now leaves a record, so the credits it used are visible instead of missing.'
  ]
} satisfies ChangelogEntry;
