import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Images arrive faster',
  items: [
    'Generating an image no longer runs an extra review pass before handing it over, so it comes back sooner and costs less.',
    'If a picture is not what you wanted, ask your agent to refine it — it starts from the image you have instead of drawing a new one.'
  ]
} satisfies ChangelogEntry;
