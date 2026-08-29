import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Safer action approvals',
  items: [
    'Read-only work continues without an approval prompt, while consequential actions can now be checked automatically before they run.',
    'If an automatic check fails, the action waits for your approval instead of running on an uncertain verdict.'
  ]
} satisfies ChangelogEntry;
