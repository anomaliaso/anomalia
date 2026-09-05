import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Writes stay in your brand',
  items: [
    'Saving a blog article now fails with a clear error when the article does not belong to the brand you are working in, instead of quietly reporting success.',
    'Editing a brand memory entry only accepts the fields it is meant to change, so a malformed request can no longer move the entry somewhere it does not belong.'
  ]
} satisfies ChangelogEntry;
