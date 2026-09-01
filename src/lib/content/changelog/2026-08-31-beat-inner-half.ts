import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-31',
  title: 'Story carousels keep their story',
  items: [
    'Each panel of a story carousel now carries the line the character is thinking, lettered into the panel — so the story reads from the images, not only from the caption.',
    'A recurring drawn series is no longer quietly turned into a single image when the plan is reviewed: the series keeps the format it promised, and a carousel that arrived without its story gets one written instead of being dropped.'
  ]
} satisfies ChangelogEntry;
