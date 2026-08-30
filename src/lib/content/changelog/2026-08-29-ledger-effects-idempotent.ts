import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Interrupted turns no longer publish or schedule the same post twice',
  items: [
    'If a turn is interrupted after it creates or schedules a post, resuming it no longer re-runs the same action — the post is published or scheduled exactly once.',
    'Work left indeterminate by a crashed turn is treated as already attempted, never silently redone.'
  ]
} satisfies ChangelogEntry;
