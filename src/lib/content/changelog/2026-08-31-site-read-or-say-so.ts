import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-31',
  title: 'Your site is read properly, or we say we could not read it',
  items: [
    'Sites behind a CDN that blocks automated readers are now read the other way round instead of being turned into a brand made of the error page.',
    'A domain that forwards to your real site is followed there, even when its own HTTPS certificate is broken — it used to come back as "site unreachable".',
    'The brand now stores the address we actually read, so a forwarding domain no longer leaves you with a website link that goes nowhere.'
  ]
} satisfies ChangelogEntry;
