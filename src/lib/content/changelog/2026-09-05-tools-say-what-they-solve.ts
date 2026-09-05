import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Your assistant finds the right tool now',
  items: [
    'Ask Claude, ChatGPT or Cursor to "make this photo red" and it edits the photo you already have, instead of drawing a new one.',
    '"Animate this image with a 5 second video" now works on any image in your library — no post needed.',
    'Tools no longer quote a made-up credit price, which is what made assistants refuse work you had asked for.'
  ]
} satisfies ChangelogEntry;
