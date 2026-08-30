import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-30',
  title: 'Faster follow-up tool use in chat',
  items: [
    'Sending a follow-up message that uses the sandbox no longer waits for a new machine to boot — the one from your last message carries over for the rest of the conversation.'
  ]
} satisfies ChangelogEntry;
