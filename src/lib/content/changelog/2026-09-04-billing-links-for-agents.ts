import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Your AI assistant can hand you a link to pay',
  items: [
    'Ask an assistant connected to Anomalia to upgrade or to open your billing, and it gives you a link — you complete it yourself on Stripe. It never pays, never switches your plan and never cancels anything.',
    'Only the account owner gets those links, and asking for one costs no credits: running out is exactly when you need it.'
  ]
} satisfies ChangelogEntry;
