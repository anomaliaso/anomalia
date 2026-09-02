import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-02',
  title: 'Background replies stop failing',
  items: [
    'Chat turns picked up in the background no longer fail with an internal error before the agent starts working.'
  ]
} satisfies ChangelogEntry;
