import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Video clips with long briefs render instead of failing silently',
  items: [
    'A clip no longer fails silently when its creative brief is longer than the video model accepts — the brief is trimmed to fit and the clip renders.',
    'The video tools now reject an over-long brief up front and tell the assistant the length limit, so it can shorten it before spending a step.'
  ]
} satisfies ChangelogEntry;
