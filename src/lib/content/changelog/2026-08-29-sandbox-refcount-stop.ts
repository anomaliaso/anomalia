import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Agent sandboxes power down the moment work finishes',
  items: [
    'Sandbox machines now shut down as soon as the last job using them ends, instead of idling until their rental window expires — idle time no longer burns through credits.',
    'Watching an agent’s live desktop keeps its machine awake while the panel is open, and the machine powers down shortly after you close it.'
  ]
} satisfies ChangelogEntry;
