import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-12',
  title: 'New default image model: sharper text, a fraction of the cost',
  items: [
    'Images are now drawn by GPT Image 2.5 Sunburst by default, at about a tenth of what the previous model cost per render and in the same time. A post measured on the same prompt went from $0.034 to $0.006.',
    'GPT Image 2.5 Sunburst and Flare join the model picker for both generating and editing images — Flare is the faster tier at the same price, Sunburst the more precise one.',
    'Instagram’s 4:5 framing is kept exactly, and reference images — your products, your people, a photo to edit — are carried through as before.',
    'If OpenRouter is unreachable, images fall back to Nano Banana on kie instead of failing.'
  ]
} satisfies ChangelogEntry;
