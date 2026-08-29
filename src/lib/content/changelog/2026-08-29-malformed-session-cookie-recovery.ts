import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Corrupted sessions no longer stop the app',
  items: ['A malformed session cookie now falls back to a signed-out state instead of taking down the server.']
} satisfies ChangelogEntry;
