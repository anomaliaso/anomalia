import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-01',
  title: 'Voice-over and music can be retried freely',
  items: [
    'Motion videos are no longer limited to two voice-over takes and two music beds per turn: the agent can try a line again, or a different bed, until it sounds right.',
    'A generation that fails no longer counts as a try — a failed take costs nothing and takes nothing away.'
  ]
} satisfies ChangelogEntry;
