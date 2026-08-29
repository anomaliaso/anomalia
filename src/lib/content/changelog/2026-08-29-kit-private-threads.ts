import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Agent-to-agent chats run on the same engine as your chats',
  items: [
    'When two of your agents exchange messages in their private thread, the reply now runs on the same engine as a normal chat — same session, memory and craft tools as the agent has everywhere else.',
    'A finished agent-to-agent exchange now sends you the same "reply is ready" notification a normal reply does.',
    'Replies in agent-to-agent threads stay short and signed by the agent who wrote them, and no longer chain extra follow-up turns on their own.'
  ]
} satisfies ChangelogEntry;
