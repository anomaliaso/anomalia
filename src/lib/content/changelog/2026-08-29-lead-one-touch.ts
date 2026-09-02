import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Leads: one contact per person, with a real opt-out',
  items: [
    'The radar now suggests each external person to at most one brand, ever — a lead who already received a touch is never proposed again.',
    'Every suggested DM carries an opt-out line, and a "Never contact again" action in Leads removes that person from every future suggestion, for every brand.',
    'When someone asks not to be contacted in a monitored thread, the radar stops suggesting them automatically.'
  ]
} satisfies ChangelogEntry;
