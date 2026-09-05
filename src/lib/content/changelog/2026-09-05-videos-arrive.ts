import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Videos arrive',
  items: [
    'Video generation moved to a faster, more reliable provider: clips that used to fail one time in four now come back.',
    'A clip whose render is still running is picked up where it left off instead of being started again.'
  ]
} satisfies ChangelogEntry;
