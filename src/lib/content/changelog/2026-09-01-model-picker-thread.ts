import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-01',
  title: 'Picking a model no longer breaks the thread',
  items: [
    'Choosing a model for a chat used to leave that thread unable to answer. The choice is now applied only when the model is actually available, and the chat falls back to its usual model instead of failing.'
  ]
} satisfies ChangelogEntry;
