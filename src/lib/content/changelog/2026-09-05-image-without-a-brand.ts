import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Ask for an image of a cat and get one',
  items: [
    'Image generation no longer needs a brand: ask for a picture and it is drawn, with nothing to pick first.',
    'A picture drawn without a brand is handed straight back as a link and filed in no library, so nobody\'s media gets cluttered.',
    'Name a brand and it works as before: the image lands in that library, ready to attach to a post.',
    'Credits for a brand-free image come from your organisation, and the answer says which one.',
    'Every image now reports what it actually cost instead of quoting an estimate.'
  ]
} satisfies ChangelogEntry;
