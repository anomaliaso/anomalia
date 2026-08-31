import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-31',
  title: 'Adding a brand no longer fails at the last step',
  items: [
    'Setting up a new brand completes instead of stopping with a database error on the final step — you land straight in the setup chat with your Analyst.',
    'Sending the form twice, or coming back to finish a setup you left halfway, now gives you one brand instead of an error.'
  ]
} satisfies ChangelogEntry;
