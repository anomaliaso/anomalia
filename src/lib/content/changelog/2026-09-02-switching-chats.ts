import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-02',
  title: 'Switching between two chats no longer shows the old one',
  items: [
    'Opening another conversation now shows it loading instead of keeping the previous conversation on screen under the new agent’s name — two agents could look like they had written the exact same messages.'
  ]
} satisfies ChangelogEntry;
