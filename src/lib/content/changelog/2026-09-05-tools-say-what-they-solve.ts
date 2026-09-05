import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Your assistant finds the right tool now',
  items: [
    'Ask Claude, ChatGPT or Cursor to "make this photo red" and it edits the photo you already have, instead of drawing a new one.',
    '"Animate this image with a 5 second video" now works on any image in your library — no post needed.',
    'Every Anomalia tool now opens by saying which problem it solves, in the words you would use, so your assistant stops replying that it cannot do something it can.',
    'Tools no longer quote a made-up credit price, which is what made assistants refuse work you had asked for. They still say which ones spend, and which cost nothing.'
  ]
} satisfies ChangelogEntry;
