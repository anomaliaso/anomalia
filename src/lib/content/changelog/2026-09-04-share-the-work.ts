import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Show a client the work without giving them an account',
  items: [
    'A public link can now carry the plan behind the work: the editorial strategy, the cadence, the platform mix, the weeks ahead and the goals of the phase you are in.',
    'One link can now hold everything a client should see — this month, the calendar, the results and the plan — behind tabs, instead of four separate links.',
    'A shared link stays read-only and carries only what a client should read: no settings, no keys, no costs, no internal notes, no team data. Expiring it or revoking it still closes it for good.'
  ]
} satisfies ChangelogEntry;
