import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'A finished video job now tells you if the clip never arrived',
  items: [
    'Checking a video job no longer answers "done" when the clip is not in your media library — it says the clip was made but never filed, so an assistant knows not to pay for a second render of a video that already exists.'
  ]
} satisfies ChangelogEntry;
