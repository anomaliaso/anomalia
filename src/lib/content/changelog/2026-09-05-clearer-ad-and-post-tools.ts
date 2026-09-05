import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Clearer ad and post tools',
  items: [
    'Agents working on your paid campaigns can now only send the ten actions the campaigns actually accept, and the one that launches a campaign — the one that spends your money — is named among them instead of being left out.',
    'Agents looking for your brand colours in the appearance tool are now pointed at the tool that holds them, and agents changing a post are told that moving its publish time is a different action from moving its calendar day.'
  ]
} satisfies ChangelogEntry;
