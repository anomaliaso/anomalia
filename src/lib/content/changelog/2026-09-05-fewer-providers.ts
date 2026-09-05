import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'AI work now runs on one provider, with one backup',
  items: [
    'Text and images now run on a single provider chosen for reliability rather than price — one of the ones we dropped was failing more than four requests in ten.',
    'Voice-over stays on the provider that has always produced it, because the new one does not do speech synthesis.',
    'Nothing changes in what you ask for or what you get back; slow and failed generations should simply become rarer.'
  ]
} satisfies ChangelogEntry;
