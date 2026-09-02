import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-31',
  title: 'Checks that a long job never loses your work',
  items: [
    'Automated checks now prove that an interrupted job either resumes or hands back what it had already produced, instead of losing it.'
  ]
} satisfies ChangelogEntry;
