import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-03',
  title: 'No more answers that vanish',
  items: [
    'When two devices reply to the same question at once, the second one now retries instead of running a turn whose answer was thrown away.'
  ]
} satisfies ChangelogEntry;
