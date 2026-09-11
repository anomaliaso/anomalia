import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-11',
  title: 'Planning with AI now respects your credit limit',
  items: [
    'Proposing a plan, revising it, replanning a week and generating weekly seeds now stop when the credits for the period are gone, and say so, instead of spending past the limit.',
    'A read-only API key can no longer start any of those four, on the route itself as well as at the door.'
  ]
} satisfies ChangelogEntry;
