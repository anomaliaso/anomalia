import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-01',
  title: 'Onboarding no longer stalls on the research screen',
  items: [
    'When the market study was picked up again after an interruption, the setup screen could freeze on the spinner with the plan already finished behind it. The progress list is now written once per step, and the wizard carries on to your first posts.'
  ]
} satisfies ChangelogEntry;
