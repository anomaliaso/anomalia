import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-31',
  title: 'Chat reads in order, and keeps moving after a reload',
  items: [
    'Conversations show in the order they happened again — the reply no longer appears above the message it answered.',
    'Reloading the page while an agent is working now keeps showing the answer as it is written, instead of freezing on "thinking".'
  ]
} satisfies ChangelogEntry;
