import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Agent sandboxes power down the moment work finishes',
  items: [
    'Sandbox machines now shut down as soon as the last job using them ends, instead of idling until their rental window expires — idle time no longer burns through credits.',
    'A conversational turn that never touches its machine no longer pays for it at all: the machine is released the moment the turn ends.',
    'The agent’s graphical desktop (screen preview, remote control, GUI actions) has been removed — agents work on the web exclusively through the fast, scriptable browser tool.'
  ]
} satisfies ChangelogEntry;
