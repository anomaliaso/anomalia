import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Media links you can actually send someone',
  items: [
    'Assets from your library now come with a short permanent link (anomalia.so/a/…) instead of a long storage URL that stopped working after two hours.',
    'Links handed over by Claude, ChatGPT or Cursor no longer break when the tool output shortens them mid-URL.'
  ]
} satisfies ChangelogEntry;
