import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Self-hosted setup applies every migration on a clean database',
  items: [
    'Row level security switches itself on for every new table in a fresh install, not only in ours.'
  ]
} satisfies ChangelogEntry;
