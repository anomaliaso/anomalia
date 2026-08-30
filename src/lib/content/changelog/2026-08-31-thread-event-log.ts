import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-31',
  title: 'A reply in progress is saved as it is written',
  items: [
    'The text an agent is still writing is now saved as it appears, so a reload mid-reply shows the same partial answer instead of an empty wait.'
  ]
} satisfies ChangelogEntry;
