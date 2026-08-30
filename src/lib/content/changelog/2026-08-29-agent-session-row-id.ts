import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Delegated agent work is now recorded',
  items: [
    'When a main agent delegates a task to a specialist, the full run — commands executed, pages visited, final report — is now saved again. A technical failure was silently discarding these traces.'
  ]
} satisfies ChangelogEntry;
