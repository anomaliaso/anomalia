import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-03',
  title: 'Your own AI can read the brief before it writes',
  items: [
    'A new tool, get_creation_kit, hands your AI the brief for one post: platform limits, your brand facts and approved voice, the recurring series it belongs to, one template chosen for that goal and format, your own rewrites of past captions, what has worked on your brand, and which calendar minutes are taken.',
    'It is a selection, not a data dump: only the sections that actually have something appear, and the whole brief is capped so it never floods your model with the library.',
    'It reads only — no model call, no credits, nothing written — so a read-only API key can use it before every draft.'
  ]
} satisfies ChangelogEntry;
