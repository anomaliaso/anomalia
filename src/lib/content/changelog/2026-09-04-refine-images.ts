import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Your agent can change an image instead of redrawing it',
  items: [
    'Ask for "make it red" and the image you already have comes back red — not a different picture drawn from scratch.',
    'The original is kept: refining files a new asset, so a wrong edit never costs you the source.',
    'Your agent can also pick which model draws or refines, for one request at a time, without changing your brand settings.'
  ]
} satisfies ChangelogEntry;
