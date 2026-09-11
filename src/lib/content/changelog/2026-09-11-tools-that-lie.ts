import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-11',
  title: 'When something fails, we now say so',
  items: [
    'A post render that produces no image now fails with the reason instead of reporting success, and tells you the credits were already spent so a retry costs again.',
    'Approving an editorial plan now confirms only once the plan is really the active one — before, a failed switch still came back as approved while the brand kept following the old plan.'
  ]
} satisfies ChangelogEntry;
