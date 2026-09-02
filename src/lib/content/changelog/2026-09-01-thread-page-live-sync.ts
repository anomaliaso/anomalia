import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-01',
  title: 'A chat keeps up on its own again',
  items: [
    'Long jobs like a video render now always show the background line above the composer — including when the reply they started from was stopped or lost its connection.',
    'When a background job finishes and the agent comes back with the result, the message appears on its own. No reload.',
    'Coming back to a tab you left open now brings the conversation up to date instead of showing you where it was when you walked away.'
  ]
} satisfies ChangelogEntry;
