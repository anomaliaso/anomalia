import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-03',
  title: 'Live text survives a retry',
  items: [
    'When a turn has to restart itself mid-answer, reopening the chat keeps showing the answer as it is written instead of falling back to a slower refresh.'
  ]
} satisfies ChangelogEntry;
