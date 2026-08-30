import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Motion references respect video support',
  items: [
    'Motion reference studies send full clips only to models that support video; other models receive extracted stills with a clear limitation.'
  ]
} satisfies ChangelogEntry;
