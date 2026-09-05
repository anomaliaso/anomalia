import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Fewer tools, same answers',
  items: [
    'Agents connected to Anomalia now see seven fewer tools: reading the blog article list, the idea bank, the brand memory and the brand look is done straight from the database, and the instructions they get on connecting say exactly how.',
    'Agents are now told to name the columns they want when reading a table — without them a long answer was being cut short with nothing said.',
    'Signing in is no longer something an agent calls: connected apps do it themselves, and locally `anomalia login` in a terminal covers both the command line and the local agent. The old sign-out tool reported success without signing anyone out, and is gone.'
  ]
} satisfies ChangelogEntry;
