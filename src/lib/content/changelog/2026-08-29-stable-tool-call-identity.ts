import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Identical tool requests can run independently',
  items: [
    'Resumed tool calls keep their original identity, preventing duplicate effects.',
    'Separate requests with identical arguments are tracked and executed independently.'
  ]
} satisfies ChangelogEntry;
