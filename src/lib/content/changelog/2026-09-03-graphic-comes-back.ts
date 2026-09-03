import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-03',
  title: 'Agents check the graphics they make',
  items: [
    'When an agent composes a graphic it now sees the rendered image and can catch text running off the canvas or blocks overlapping — before you do.',
    'If it could not see the render, it tells you instead of claiming the graphic looks right.'
  ]
} satisfies ChangelogEntry;
