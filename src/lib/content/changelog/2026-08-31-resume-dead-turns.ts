import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-31',
  title: 'A long job that gets interrupted finishes by itself',
  items: [
    'When a long turn is cut short, the agent now picks it up where it stopped instead of leaving the work half done for you to ask again.'
  ]
} satisfies ChangelogEntry;
