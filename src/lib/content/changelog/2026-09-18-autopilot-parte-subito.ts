import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-18',
  title: 'The morning autopilot starts right away',
  items: [
    'Your brands now run their daily autopilot in parallel instead of queueing behind one another, so the work starts when it is due rather than up to half an hour later.',
    'A run no longer depends on a single background machine being awake: if one is unavailable, the day is no longer skipped.'
  ]
} satisfies ChangelogEntry;
